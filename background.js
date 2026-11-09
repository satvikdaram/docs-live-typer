// background.js — service worker.
// Owns the typing run, so closing the popup or side panel does not stop it.
//
// Flow: UI sends "start" -> attach chrome.debugger to the Docs tab -> countdown ->
// type one character at a time with Input.insertText / Input.dispatchKeyEvent ->
// detach when done, stopped, or when the tab closes / navigates away.

import { loadSettings, normalizeSettings, SETTINGS_KEY } from './settings.js';
import { PORT_NAME, ACTIVE_STATUSES, parseDocUrl, makeError } from './shared.js';
import * as T from './timing.js';
import { newLog, LOG_KEY } from './timing-log.js';

const PROTOCOL_VERSION = '1.3';
const HEARTBEAT_ALARM = 'typer-heartbeat';
const TAB_CHECK_EVERY = 12;   // re-check the tab is still the same Google Doc every N characters
const BROADCAST_MS = 150;     // max UI update rate
const STOP_GRACE_MS = 3000;   // let an in-progress typo correction finish before detaching

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
};

let settings = normalizeSettings(null);
let run = null;            // { id, tabId, docId, index, total, status, error, startedAt, chars, countdownLeft }
let lastError = null;      // error from a start attempt that never became a run
let attachedTabId = null;
let loopToken = 0;
let activeLoopToken = -1;
let loopPromise = null;
let starting = false;
let resuming = false;
let estimate = null;       // Float64Array from T.remainingTimeTable
let pauseWaiters = [];
let wakeSleep = null;
let lastBroadcast = 0;
let broadcastTimer = null;
const ports = new Set();

const ready = restore().catch((err) => console.error('restore failed', err));

// Clicking the toolbar icon opens the side panel (there is no popup).
// Chrome remembers this setting, but setting it on every worker start keeps it true after updates.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));

// One-time update: the countdown now defaults to off. Switch existing installs over once;
// after that, whatever you set under Settings -> Countdown is kept.
chrome.runtime.onInstalled.addListener(async () => {
  const { countdownOffMigrated } = await chrome.storage.local.get('countdownOffMigrated');
  if (countdownOffMigrated) return;
  const current = await loadSettings();
  await chrome.storage.local.set({
    [SETTINGS_KEY]: normalizeSettings({ ...current, countdown: 0 }),
    countdownOffMigrated: true,
  });
});

// ---------------------------------------------------------------------------
// Event listeners (registered synchronously so a restarted worker gets them)
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    ports.delete(port);
  });
  port.onMessage.addListener((msg) => {
    ready.then(() => handleMessage(msg)).catch((err) => console.error(err));
  });
  ready.then(() => post(port, { type: 'state', state: snapshot() }));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-pause') return;
  await ready;
  if (!run) return;
  if (run.status === 'typing') pauseRun(null, true);
  else if (run.status === 'paused') resumeRun();
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId == null || source.tabId !== attachedTabId) return;
  attachedTabId = null;
  ready.then(async () => {
    if (!isActive() || run.tabId !== source.tabId) return;
    if (reason === 'canceled_by_user') {
      pauseRun(makeError('CANCELED'));
      return;
    }
    const tabErr = await checkTab();
    if (tabErr && tabErr.code !== 'VIEW_ONLY') {
      await stopRun(tabErr);
      return;
    }
    pauseRun(makeError('DETACHED', reason));
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === attachedTabId) attachedTabId = null;
  ready.then(() => {
    if (isActive() && run.tabId === tabId) stopRun(makeError('TAB_CLOSED'));
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  ready.then(() => {
    if (!isActive() || run.tabId !== tabId) return;
    const doc = parseDocUrl(changeInfo.url);
    if (!doc || doc.docId !== run.docId) stopRun(makeError('NAVIGATED'));
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  await ready;
  // The alarm itself wakes the worker; this extra API call resets its idle timer.
  chrome.runtime.getPlatformInfo().catch(() => {});
  if (!isActive()) {
    chrome.alarms.clear(HEARTBEAT_ALARM);
    return;
  }
  if (run.status === 'typing' && !loopIsRunning()) continueAfterRestart();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  // Settings changes apply to a run that is already going.
  settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
  if (run && run.chars) {
    estimate = T.remainingTimeTable(run.chars, settings);
    broadcast();
  }
});

// ---------------------------------------------------------------------------
// Messages from the popup / side panel
// ---------------------------------------------------------------------------

async function handleMessage(msg) {
  switch (msg && msg.type) {
    case 'start': return startRun(msg);
    case 'pause': return pauseRun(null, true);
    case 'resume': return resumeRun();
    case 'stop': return stopRun(null);
    case 'getState': return broadcast(true);
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function isActive() {
  return !!run && ACTIVE_STATUSES.includes(run.status);
}

function loopIsRunning() {
  return !!loopPromise && activeLoopToken === loopToken;
}

async function startRun(msg) {
  if (isActive() || starting) {
    broadcast(true);
    return;
  }
  starting = true;
  try {
    lastError = null;
    const text = String(msg.text || '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return failStart(makeError('EMPTY_TEXT'));

    let tab;
    try {
      tab = await chrome.tabs.get(msg.tabId);
    } catch {
      return failStart(makeError('NO_TAB'));
    }
    const doc = parseDocUrl(tab.url);
    if (!doc) return failStart(makeError('NOT_DOC'));
    if (!doc.editable) return failStart(makeError('VIEW_ONLY'));

    settings = await loadSettings();

    // Attach before the countdown, so the debugging bar appears (and the page
    // layout settles) before you click into the doc.
    try {
      await ensureAttached(tab.id);
    } catch (err) {
      return failStart(err);
    }

    const chars = Array.from(text);
    const id = crypto.randomUUID();
    run = {
      id,
      tabId: tab.id,
      docId: doc.docId,
      index: 0,
      total: chars.length,
      status: settings.countdown > 0 ? 'countdown' : 'typing',
      error: null,
      startedAt: Date.now(),
      pausedAt: 0,
      log: newLog(chars.length), // timing log for this run
      chars,
      countdownLeft: settings.countdown,
    };
    estimate = T.remainingTimeTable(run.chars, settings);
    await chrome.storage.session.set({ runText: { id, text } });
    persistMeta();
    ensureHeartbeat();
    startLoop();
    broadcast(true);
  } finally {
    starting = false;
  }
}

function failStart(error) {
  run = null;
  lastError = error;
  persistMeta();
  broadcast(true);
}

/** Pauses an active run. fromUser=true is ignored during the countdown. */
function pauseRun(error = null, fromUser = false) {
  if (!run) return;
  if (run.status === 'paused') {
    if (error && !run.error) {
      run.error = error;
      persistMeta();
      broadcast(true);
    }
    return;
  }
  if (!isActive() || (fromUser && run.status === 'countdown')) return;
  run.status = 'paused';
  run.error = error;
  run.pausedAt = Date.now();
  interruptSleep();
  persistMeta();
  broadcast(true);
}

async function resumeRun() {
  if (!run || run.status !== 'paused' || resuming) return;
  resuming = true;
  try {
    const tabErr = await checkTab();
    if (tabErr) {
      if (tabErr.code === 'VIEW_ONLY') {
        run.error = tabErr;
        broadcast(true);
      } else {
        await stopRun(tabErr);
      }
      return;
    }
    const needsAttach = attachedTabId !== run.tabId;
    try {
      await ensureAttached(run.tabId);
    } catch (err) {
      run.error = err;
      persistMeta();
      broadcast(true);
      return;
    }
    if (needsAttach) await delay(700); // let the debugging bar appear first
    if (!run || run.status !== 'paused') return;
    addPausedTime();
    run.status = 'typing';
    run.error = null;
    persistMeta();
    ensureHeartbeat();
    releaseWaiters();
    startLoop();
    broadcast(true);
  } finally {
    resuming = false;
  }
}

/** Stop requested from outside the loop (button, tab closed, navigation). */
async function stopRun(error = null) {
  if (!isActive()) return;
  const p = loopPromise;
  loopToken++;
  interruptSleep();
  releaseWaiters();
  if (p) await Promise.race([p, delay(STOP_GRACE_MS)]);
  if (!isActive()) return; // the loop already finished or stopped the run
  await finishRun('stopped', error);
}

async function finishRun(status, error) {
  if (!run) return;
  loopToken++;
  interruptSleep();
  releaseWaiters();
  const wasActive = isActive();
  addPausedTime();
  run.status = status;
  run.error = error || null;
  run.countdownLeft = 0;
  if (wasActive) saveLog(status);
  await detach();
  chrome.alarms.clear(HEARTBEAT_ALARM);
  chrome.storage.session.remove('runText').catch(() => {});
  persistMeta();
  broadcast(true);
}

// ---------------------------------------------------------------------------
// Timing log (one per run)
// ---------------------------------------------------------------------------

function currentRow() {
  return run && run.log ? run.log : null;
}

function addPausedTime() {
  if (!run || !run.pausedAt) return;
  const row = currentRow();
  if (row && row.startedAt) row.pausedMs += Date.now() - run.pausedAt;
  run.pausedAt = 0;
}

function saveLog(status) {
  const row = currentRow();
  if (row && row.startedAt && !row.endedAt) {
    row.endedAt = Date.now();
    row.done = status === 'done';
  }
  const log = { finishedAt: Date.now(), status, wpm: settings.wpm, run: run.log };
  chrome.storage.local.set({ [LOG_KEY]: log }).catch(() => {});
}

/** The worker was restarted while typing: reconnect and carry on from the saved index. */
async function continueAfterRestart() {
  if (!run || run.status !== 'typing' || resuming || loopIsRunning()) return;
  resuming = true;
  try {
    const tabErr = await checkTab();
    if (tabErr) {
      if (tabErr.code === 'VIEW_ONLY') pauseRun(tabErr);
      else await finishRun('stopped', tabErr);
      return;
    }
    try {
      await ensureAttached(run.tabId);
    } catch (err) {
      pauseRun(err);
      return;
    }
    ensureHeartbeat();
    startLoop();
    broadcast(true);
  } finally {
    resuming = false;
  }
}

function startLoop() {
  if (loopIsRunning()) return;
  const token = ++loopToken;
  activeLoopToken = token;
  const p = typingLoop(token)
    .catch((err) => {
      console.error('typing loop failed', err);
      if (token === loopToken) pauseRun(makeError('SEND_FAILED', err && err.message));
    })
    .finally(() => {
      if (loopPromise === p) loopPromise = null;
    });
  loopPromise = p;
}

// ---------------------------------------------------------------------------
// The typing loop
// ---------------------------------------------------------------------------

async function typingLoop(token) {
  const rand = Math.random;
  const tabId = run.tabId;
  const live = () => token === loopToken && isActive();

  // Countdown (gives you time to click into the doc)
  while (live() && run.status === 'countdown') {
    if (run.countdownLeft <= 0) {
      run.status = 'typing';
      persistMeta();
      broadcast(true);
      break;
    }
    broadcast(true);
    await sleep(1000);
    if (!live()) return;
    if (run.status === 'countdown') run.countdownLeft -= 1;
  }

  let burst = T.newBurst(rand);
  let sinceCheck = TAB_CHECK_EVERY; // check before the first character
  let skipTypoAt = -1;
  let shortDelayNext = false;

  while (live()) {
    if (run.status === 'paused') {
      await waitForResume();
      shortDelayNext = true;
      continue;
    }

    const chars = run.chars;
    const i = run.index;
    if (i >= chars.length) {
      await finishRun('done', null);
      return;
    }

    // Make sure the tab is still the same, editable Google Doc.
    if (sinceCheck >= TAB_CHECK_EVERY) {
      sinceCheck = 0;
      const tabErr = await checkTab();
      if (!live()) return;
      if (tabErr) {
        if (tabErr.code === 'VIEW_ONLY') pauseRun(tabErr);
        else await finishRun('stopped', tabErr);
        continue;
      }
    }
    sinceCheck++;

    const ctx = { prev2: chars[i - 2] || '', prev: chars[i - 1] || '', ch: chars[i], index: i, settings, burst };
    let wait;
    if (shortDelayNext) {
      wait = T.keystrokeDelay(ctx, rand);
      shortDelayNext = false;
    } else {
      const step = T.nextDelay(ctx, rand);
      burst = step.burst;
      wait = step.delayMs;
    }
    await sleep(wait);
    if (!live() || run.status !== 'typing') continue;

    const row = currentRow();
    if (row && !row.startedAt) row.startedAt = Date.now();
    try {
      const plan = i !== skipTypoAt ? T.planTypo(chars, i, settings, rand) : null;
      if (plan) {
        // Type the wrong key (and maybe a couple more), backspace, then the
        // next loop pass types chars[i] correctly.
        await performTypo(tabId, chars, i, plan, rand);
        if (row) row.typos++;
        skipTypoAt = i;
        shortDelayNext = true;
        continue;
      }
      const t0 = performance.now();
      await typeChar(tabId, chars[i]);
      if (row && chars[i] !== '\n' && chars[i] !== '\t') {
        const lat = performance.now() - t0; // how long Chrome/Docs took to accept the keystroke
        row.latSum += lat;
        row.latCount++;
        row.latMax = Math.max(row.latMax, lat);
      }
    } catch (err) {
      if (!live()) return;
      if (row) row.sendErrors++;
      pauseRun(makeError('SEND_FAILED', err && err.message));
      continue;
    }

    run.index = i + 1;
    persistMeta();
    broadcast();
  }
}

/** Runs to completion even if pause/stop is pressed, so the doc is never left with a typo. */
async function performTypo(tabId, chars, i, plan, rand) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: plan.wrong });
  for (let k = 1; k <= plan.lag; k++) {
    const ctx = { prev2: chars[i + k - 2] || '', prev: chars[i + k - 1] || '', ch: chars[i + k], index: i + k, settings };
    await delay(T.keystrokeDelay(ctx, rand));
    await typeChar(tabId, chars[i + k]);
  }
  await delay(T.typoNoticePause(rand));
  for (let b = 0; b <= plan.lag; b++) {
    await pressKey(tabId, 'Backspace');
    await delay(T.backspaceDelay(settings, rand));
  }
}

async function typeChar(tabId, ch) {
  if (ch === '\n') return pressKey(tabId, 'Enter');
  if (ch === '\t') return pressKey(tabId, 'Tab');
  return chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: ch });
}

async function pressKey(tabId, name) {
  const { text, ...key } = KEYS[name];
  const down = text
    ? { type: 'keyDown', ...key, text, unmodifiedText: text }
    : { type: 'rawKeyDown', ...key };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', down);
  await delay(T.keyHoldMs(Math.random));
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

// ---------------------------------------------------------------------------
// Debugger + tab helpers
// ---------------------------------------------------------------------------

async function ensureAttached(tabId) {
  if (attachedTabId === tabId) return;
  if (attachedTabId != null) await detach();
  // Clears a stale session left over if the worker restarted while attached.
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // not attached: expected
  }
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (err) {
    throw attachError(err);
  }
  attachedTabId = tabId;
  // Makes the page behave as if it still has focus when you switch tabs.
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch {
    // optional; typing still works without it
  }
}

async function detach() {
  const tabId = attachedTabId;
  attachedTabId = null;
  if (tabId == null) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // already detached
  }
}

function attachError(err) {
  const msg = String((err && err.message) || err);
  if (/another debugger/i.test(msg)) return makeError('ALREADY_ATTACHED', msg);
  if (/no tab with/i.test(msg)) return makeError('TAB_CLOSED', msg);
  if (/cannot access|cannot attach|chrome:\/\/|chrome-extension:\/\//i.test(msg)) return makeError('NOT_DOC', msg);
  return makeError('ATTACH_FAILED', msg);
}

/** Returns null if the run's tab is still the same editable Google Doc, else an error. */
async function checkTab() {
  if (!run) return makeError('NO_TAB');
  let tab;
  try {
    tab = await chrome.tabs.get(run.tabId);
  } catch {
    return makeError('TAB_CLOSED');
  }
  const doc = parseDocUrl(tab.url);
  if (!doc || doc.docId !== run.docId) return makeError('NAVIGATED');
  if (!doc.editable) return makeError('VIEW_ONLY');
  return null;
}

// ---------------------------------------------------------------------------
// Timers, persistence, keep-alive, UI updates
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Like delay(), but pause/stop can cut it short. */
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (wakeSleep === done) wakeSleep = null;
      resolve();
    }
    wakeSleep = done;
  });
}

function interruptSleep() {
  if (wakeSleep) wakeSleep();
}

function waitForResume() {
  return new Promise((resolve) => pauseWaiters.push(resolve));
}

function releaseWaiters() {
  const waiters = pauseWaiters;
  pauseWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function ensureHeartbeat() {
  // 30 s is the shortest alarm period (Chrome 120+; older versions round up to 1 min).
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
}

function persistMeta() {
  if (!run) {
    chrome.storage.session.remove(['runMeta', 'runText']).catch(() => {});
    return;
  }
  const { chars, countdownLeft, ...meta } = run;
  chrome.storage.session.set({ runMeta: meta }).catch(() => {});
}

async function restore() {
  settings = await loadSettings();
  const { runMeta, runText } = await chrome.storage.session.get(['runMeta', 'runText']);
  if (!runMeta) return;
  const chars = runText && runText.id === runMeta.id ? Array.from(runText.text) : null;
  const wasActive = ACTIVE_STATUSES.includes(runMeta.status);
  if (wasActive && !chars) {
    await chrome.storage.session.remove(['runMeta', 'runText']);
    return;
  }
  run = { ...runMeta, chars, countdownLeft: 0 };
  if (chars) estimate = T.remainingTimeTable(chars, settings);
  if (run.status === 'typing' || run.status === 'countdown') {
    run.status = 'typing';
    // Don't await: this needs `ready`-independent work and must not block restore.
    setTimeout(() => continueAfterRestart(), 0);
  }
}

function snapshot() {
  if (!run) {
    return { status: 'idle', typed: 0, total: 0, etaMs: 0, countdownLeft: 0, error: lastError };
  }
  let etaMs = estimate && run.chars ? estimate[Math.min(run.index, run.chars.length)] : 0;
  if (run.status === 'countdown') etaMs += run.countdownLeft * 1000;
  return {
    status: run.status,
    typed: run.index,
    total: run.total,
    etaMs,
    countdownLeft: run.countdownLeft || 0,
    error: run.error || null,
  };
}

function broadcast(now = false) {
  if (ports.size === 0) return;
  const t = Date.now();
  if (now || t - lastBroadcast >= BROADCAST_MS) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
    lastBroadcast = t;
    const msg = { type: 'state', state: snapshot() };
    for (const port of ports) post(port, msg);
  } else if (!broadcastTimer) {
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      broadcast(true);
    }, BROADCAST_MS - (t - lastBroadcast));
  }
}

/** Posting to a closed popup/panel must never throw "Receiving end does not exist". */
function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    ports.delete(port);
  }
}
