// typer-ui.js
// The side panel's main screen: one text box, Humanize and Start, speed, progress, Settings.
// mountTyper(element, { onHumanize }) builds the markup and wires it to the service worker.
// Humanizing itself is done by sidepanel.js (it talks to the embedded humanizeai.pro);
// this file only shows the button and calls onHumanize(text).

import {
  DEFAULT_SETTINGS, RANGES, SPEED_PRESETS, SETTINGS_KEY, DRAFT_KEY, NOTICE_KEY,
  normalizeSettings, saveSettings, resetSettings,
} from './settings.js';
import { PORT_NAME, ACTIVE_STATUSES, parseDocUrl, makeError } from './shared.js';
import { logToCsv, LOG_KEY } from './timing-log.js';

const SLIDERS = {
  wpm: { label: 'Custom speed', format: (v) => `${v} WPM` },
  randomness: { label: 'Randomness', format: (v) => `${v}%` },
  commaPause: { label: 'After commas', format: formatMs },
  sentencePause: { label: 'After sentences', format: formatMs },
  newlinePause: { label: 'After line breaks', format: formatMs },
  typoRate: { label: 'Typo frequency', format: (v) => `${v}% of letters` },
  countdown: { label: 'Countdown', format: (v) => (v === 0 ? 'Off' : `${v} s`) },
};

const TOGGLES = {
  bursts: { label: 'Typing bursts', hint: 'A few quick words, then a short pause' },
  fatigue: { label: 'Fatigue', hint: 'Slows down a little on long text' },
  typos: { label: 'Typos', hint: 'Hits a nearby key, then fixes it' },
};

let mountCount = 0;

export function mountTyper(root, { onHumanize = null } = {}) {
  const p = `typer${++mountCount}`;
  root.innerHTML = buildTemplate(p);

  const $ = (name) => root.querySelector(`[data-ref="${name}"]`);
  const el = {
    status: $('status'),
    statusText: $('statusText'),
    text: $('text'),
    counts: $('counts'),
    humanize: $('humanize'),
    humanizeStatus: $('humanizeStatus'),
    autoRow: $('autoRow'),
    speedValue: $('speedValue'),
    presets: [...root.querySelectorAll('[data-wpm]')],
    reset: $('reset'),
    error: $('error'),
    errorTitle: $('errorTitle'),
    errorFix: $('errorFix'),
    primary: $('primary'),
    stop: $('stop'),
    shortcut: $('shortcut'),
    notice: $('notice'),
    noticeDismiss: $('noticeDismiss'),
    progress: $('progress'),
    progressBar: $('progressBar'),
    progressFill: $('progressFill'),
    progressCount: $('progressCount'),
    progressEta: $('progressEta'),
    logRow: $('logRow'),
    logSummary: $('logSummary'),
    logDownload: $('logDownload'),
  };
  const settingInputs = [...root.querySelectorAll('[data-setting]')];
  const outputs = Object.fromEntries([...root.querySelectorAll('[data-out]')].map((o) => [o.dataset.out, o]));

  let settings = { ...DEFAULT_SETTINGS };
  let runState = { status: 'idle', typed: 0, total: 0, etaMs: 0, countdownLeft: 0, error: null };
  let activeTab = { checked: false, isDoc: false };
  let localError = null;
  let noticeDismissed = true;
  let lastLog = null;
  let port = null;
  let closed = false;
  let saveTimer = null;
  let draftTimer = null;
  let draftTouched = false;
  let shortcutLabel = '';
  let humanizeBusy = false;

  // ---------- connection to the service worker ----------

  function connect() {
    if (closed) return;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (err) {
      port = null;
      localError = makeError('NO_WORKER', err && err.message);
      render();
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'state') {
        runState = msg.state;
        render();
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // the worker restarted; reconnect quietly
      port = null;
      if (!closed) setTimeout(connect, 500);
    });
  }

  function send(msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!port) connect();
      if (!port) break;
      try {
        port.postMessage(msg);
        return;
      } catch {
        port = null;
      }
    }
    localError = makeError('NO_WORKER');
    render();
  }

  // ---------- active tab ----------

  async function getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  }

  async function refreshActiveTab() {
    const tab = await getActiveTab();
    const doc = tab ? parseDocUrl(tab.url) : null;
    activeTab = { checked: true, isDoc: !!doc };
    if (doc && localError && ['NOT_DOC', 'NO_TAB', 'VIEW_ONLY'].includes(localError.code)) {
      if (doc.editable || localError.code !== 'VIEW_ONLY') localError = null;
    }
    render();
  }

  // ---------- settings ----------

  function renderSettings() {
    for (const input of settingInputs) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!settings[key];
      else {
        input.value = String(settings[key]);
        const min = Number(input.min);
        const max = Number(input.max);
        input.style.setProperty('--fill', `${((settings[key] - min) / (max - min)) * 100}%`);
      }
      if (outputs[key] && SLIDERS[key]) outputs[key].textContent = SLIDERS[key].format(settings[key]);
    }
    let matched = false;
    for (const btn of el.presets) {
      const on = Number(btn.dataset.wpm) === settings.wpm;
      matched = matched || on;
      btn.setAttribute('aria-pressed', String(on));
    }
    el.speedValue.textContent = matched ? `${settings.wpm} WPM` : `Custom · ${settings.wpm} WPM`;
    const typoField = root.querySelector('[data-field="typoRate"]');
    typoField.hidden = !settings.typos;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 200);
  }

  async function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await saveSettings(settings);
    } catch {
      // storage is local and tiny; ignore
    }
  }

  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    chrome.storage.local.set({ [DRAFT_KEY]: el.text.value }).catch(() => {});
  }

  // ---------- rendering ----------

  function updateCounts() {
    const v = el.text.value;
    const chars = Array.from(v).length;
    const words = (v.trim().match(/\S+/g) || []).length;
    el.counts.textContent = `${fmt(chars)} ${chars === 1 ? 'character' : 'characters'} · ${fmt(words)} ${words === 1 ? 'word' : 'words'}`;
  }

  function render() {
    const st = runState;
    const active = ACTIVE_STATUSES.includes(st.status);

    // Status dot + text
    let key;
    let label;
    if (st.status === 'countdown') { key = 'countdown'; label = `Starting in ${st.countdownLeft}`; }
    else if (st.status === 'typing') { key = 'typing'; label = 'Typing'; }
    else if (st.status === 'paused') { key = 'paused'; label = 'Paused'; }
    else if (activeTab.checked && !activeTab.isDoc) { key = 'nodoc'; label = 'Not a Google Doc'; }
    else { key = 'ready'; label = 'Ready'; }
    el.status.dataset.state = key;
    el.statusText.textContent = label;

    // Text box is locked while typing or humanizing
    el.text.disabled = active || humanizeBusy;

    // Humanize sits next to Start, and steps aside while typing
    el.humanize.hidden = active || !onHumanize;
    el.humanize.disabled = humanizeBusy;
    el.autoRow.hidden = active || !onHumanize;

    // Buttons
    el.stop.hidden = !active;
    el.primary.disabled = st.status === 'countdown';
    if (!active) el.primary.textContent = 'Start';
    else if (st.status === 'countdown') el.primary.textContent = `Starting in ${st.countdownLeft}…`;
    else if (st.status === 'typing') el.primary.textContent = 'Pause';
    else el.primary.textContent = 'Resume';

    el.shortcut.hidden = !(st.status === 'typing' || st.status === 'paused') || !shortcutLabel;
    el.shortcut.textContent = `${shortcutLabel} pauses or resumes`;

    // One-time note about Chrome's debugging bar, only while it's actually showing
    el.notice.hidden = noticeDismissed || !active;

    // Error box
    const err = localError || st.error;
    el.error.hidden = !err;
    if (err) {
      el.errorTitle.textContent = err.title;
      el.errorFix.textContent = err.fix;
    }

    // Progress
    const showProgress = st.status !== 'idle' && st.total > 0;
    el.progress.hidden = !showProgress;
    if (showProgress) {
      const pct = Math.min(100, (st.typed / st.total) * 100);
      el.progressFill.style.width = `${pct}%`;
      el.progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
      el.progressCount.textContent = `${fmt(st.typed)} / ${fmt(st.total)} characters`;
      el.progressEta.textContent = etaLabel(st);
    }

    // Timing log of the last finished run
    el.logRow.hidden = active || !lastLog;
    if (lastLog) el.logSummary.textContent = logSummary(lastLog);
  }

  // ---------- actions ----------

  async function start() {
    localError = null;
    const text = el.text.value;
    if (!text.trim()) {
      localError = makeError('EMPTY_TEXT');
      render();
      el.text.focus();
      return;
    }
    const tab = await getActiveTab();
    if (!tab) {
      localError = makeError('NO_TAB');
      render();
      return;
    }
    const doc = parseDocUrl(tab.url);
    if (!doc || !doc.editable) {
      localError = makeError(doc ? 'VIEW_ONLY' : 'NOT_DOC');
      render();
      return;
    }
    await flushSave(); // the worker reads settings from storage when it starts
    saveDraft();
    render();
    send({ type: 'start', tabId: tab.id, text });
  }

  function downloadLog() {
    if (!lastLog) return;
    const blob = new Blob([logToCsv(lastLog)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date(lastLog.finishedAt || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `typer-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  el.primary.addEventListener('click', () => {
    const s = runState.status;
    if (s === 'typing') send({ type: 'pause' });
    else if (s === 'paused') send({ type: 'resume' });
    else if (s !== 'countdown') start();
  });

  el.stop.addEventListener('click', () => send({ type: 'stop' }));
  el.logDownload.addEventListener('click', downloadLog);
  el.humanize.addEventListener('click', () => {
    if (humanizeBusy || !onHumanize) return;
    const text = el.text.value;
    if (!text.trim()) {
      localError = makeError('EMPTY_TEXT');
      render();
      el.text.focus();
      return;
    }
    localError = null;
    onHumanize(text);
  });

  el.text.addEventListener('input', () => {
    draftTouched = true;
    if (localError && localError.code === 'EMPTY_TEXT') localError = null;
    updateCounts();
    render();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 250);
  });

  for (const input of settingInputs) {
    const key = input.dataset.setting;
    const eventName = input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      settings = normalizeSettings(settings);
      renderSettings();
      queueSave();
    });
  }

  for (const btn of el.presets) {
    btn.addEventListener('click', () => {
      settings.wpm = Number(btn.dataset.wpm);
      renderSettings();
      queueSave();
    });
  }

  el.reset.addEventListener('click', async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    settings = await resetSettings();
    renderSettings();
  });

  el.noticeDismiss.addEventListener('click', () => {
    noticeDismissed = true;
    chrome.storage.local.set({ [NOTICE_KEY]: true }).catch(() => {});
    render();
    el.primary.focus();
  });

  // Keep popup and side panel in sync with each other.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY] && !saveTimer) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      renderSettings();
    }
    if (changes[DRAFT_KEY] && document.activeElement !== el.text) {
      const v = changes[DRAFT_KEY].newValue || '';
      if (v !== el.text.value) {
        el.text.value = v;
        updateCounts();
        render();
      }
    }
    if (changes[NOTICE_KEY]) {
      noticeDismissed = !!changes[NOTICE_KEY].newValue;
      render();
    }
    if (changes[LOG_KEY]) {
      lastLog = validLog(changes[LOG_KEY].newValue);
      render();
    }
  });

  chrome.tabs.onActivated.addListener(() => refreshActiveTab());
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url || info.status === 'complete') refreshActiveTab();
  });

  const flushAll = () => {
    if (draftTimer) saveDraft();
    if (saveTimer) flushSave();
  };
  window.addEventListener('pagehide', () => {
    closed = true;
    flushAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });

  // ---------- init ----------

  (async () => {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, DRAFT_KEY, NOTICE_KEY, LOG_KEY]);
    settings = normalizeSettings(stored[SETTINGS_KEY]);
    if (!draftTouched) el.text.value = stored[DRAFT_KEY] || '';
    noticeDismissed = !!stored[NOTICE_KEY];
    lastLog = validLog(stored[LOG_KEY]);
    renderSettings();
    updateCounts();
    render();
    try {
      const commands = await chrome.commands.getAll();
      const cmd = commands.find((c) => c.name === 'toggle-pause');
      shortcutLabel = (cmd && cmd.shortcut) || '';
    } catch {
      shortcutLabel = '';
    }
    refreshActiveTab();
  })();

  renderSettings();
  updateCounts();
  render();
  connect();

  return {
    /** Puts text into the typer's box (used by "Send to Typer"). */
    setDraft(text) {
      draftTouched = true;
      el.text.value = text;
      if (localError && localError.code === 'EMPTY_TEXT') localError = null;
      updateCounts();
      saveDraft();
      render();
    },
    /**
     * Shows humanize progress. busy disables the button and locks the text box;
     * label is the button text; message is the line under the buttons ('' hides it).
     */
    setHumanizeState({ busy = false, label = 'Humanize', message = '' } = {}) {
      humanizeBusy = busy;
      el.humanize.querySelector('[data-ref="humanizeLabel"]').textContent = label;
      el.humanizeStatus.textContent = message;
      el.humanizeStatus.hidden = !message;
      render();
    },
    focusText() {
      if (!el.text.disabled) {
        el.text.focus();
        el.text.setSelectionRange(0, 0);
        el.text.scrollTop = 0;
      } else {
        el.primary.focus();
      }
    },
    /** True while a run is counting down, typing or paused. */
    isBusy() {
      return ACTIVE_STATUSES.includes(runState.status);
    },
    /** Same as pressing Start (does nothing while a run is active). */
    start() {
      if (ACTIVE_STATUSES.includes(runState.status)) return false;
      start();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function buildTemplate(p) {
  const presetButtons = SPEED_PRESETS.map((preset) => `
      <button type="button" class="segment" data-wpm="${preset.wpm}" aria-pressed="false">${preset.label}</button>`).join('');

  return `
  <header class="typer-header">
    <div class="brand">
      <img class="logo" src="icons/icon48.png" alt="" width="24" height="24">
      <h1 class="title">Docs Live Typer</h1>
    </div>
    <div class="status" data-ref="status" data-state="ready" role="status" aria-live="polite">
      <span class="status-dot" aria-hidden="true"></span>
      <span data-ref="statusText">Ready</span>
    </div>
  </header>

  <div class="stack">
    <label class="sr-only" for="${p}-text">Text to type</label>
    <textarea id="${p}-text" class="textarea" data-ref="text" placeholder="Paste text to type…" spellcheck="false"></textarea>
    <div class="meta-row">
      <span data-ref="counts">0 characters · 0 words</span>
    </div>
  </div>

  <div class="stack">
    <div class="row-between">
      <span class="label" id="${p}-speed">Speed</span>
      <span class="value" data-ref="speedValue">60 WPM</span>
    </div>
    <div class="segmented" role="group" aria-labelledby="${p}-speed">${presetButtons}
    </div>
  </div>

  <div class="stack">
    <div class="actions">
      <button type="button" class="btn btn-secondary btn-humanize" data-ref="humanize" title="Rewrites the text in the box with humanizeai.pro">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.75l1.4 3.6 3.6 1.4-3.6 1.4L8 11.75l-1.4-3.6-3.6-1.4 3.6-1.4L8 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z" fill="currentColor"/></svg>
        <span data-ref="humanizeLabel">Humanize</span>
      </button>
      <button type="button" class="btn btn-primary" data-ref="primary">Start</button>
      <button type="button" class="btn btn-secondary" data-ref="stop" hidden>Stop</button>
    </div>
    <p class="hint humanize-status" data-ref="humanizeStatus" aria-live="polite" hidden></p>
    <div class="auto-row" data-ref="autoRow">
      <label class="inline-toggle" title="When the humanized text is ready, start typing it">
        <input type="checkbox" role="switch" class="switch" id="${p}-auto" data-auto-start> Start typing after humanizing
      </label>
      <button type="button" class="link-button link-quiet" id="${p}-site-jump" data-site-jump title="Scroll down to humanizeai.pro">Site ↓</button>
    </div>
  </div>

  <div class="error" data-ref="error" role="alert" hidden>
    <p class="error-title" data-ref="errorTitle"></p>
    <p class="error-fix" data-ref="errorFix"></p>
  </div>

  <section class="progress" data-ref="progress" hidden>
    <div class="progress-track" data-ref="progressBar" role="progressbar" aria-label="Typing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="progress-fill" data-ref="progressFill"></div>
    </div>
    <div class="meta-row">
      <span data-ref="progressCount"></span>
      <span data-ref="progressEta"></span>
    </div>
    <p class="hint" data-ref="shortcut" hidden></p>
  </section>

  <div class="notice" data-ref="notice" hidden>
    <p>Chrome's "debugging this browser" bar is expected. Clicking Cancel on it pauses typing.</p>
    <button type="button" class="link-button" data-ref="noticeDismiss">Got it</button>
  </div>

  <div class="log-row" data-ref="logRow" hidden>
    <span class="hint" data-ref="logSummary"></span>
    <button type="button" class="link-button" data-ref="logDownload">Download timing log</button>
  </div>

  <details class="card advanced">
    <summary class="advanced-summary">
      <span>Settings</span>
      <svg class="chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </summary>
    <div class="advanced-body">
      <div class="group">
        <p class="group-title">Speed</p>
        ${slider(p, 'wpm')}
        ${slider(p, 'randomness')}
      </div>
      <div class="group">
        <p class="group-title">Pauses</p>
        ${slider(p, 'commaPause')}
        ${slider(p, 'sentencePause')}
        ${slider(p, 'newlinePause')}
      </div>
      <div class="group">
        <p class="group-title">Behavior</p>
        ${toggle(p, 'bursts')}
        ${toggle(p, 'fatigue')}
        ${toggle(p, 'typos')}
        ${slider(p, 'typoRate')}
      </div>
      <div class="group">
        <p class="group-title">Start</p>
        ${slider(p, 'countdown')}
      </div>
      <div>
        <button type="button" class="btn btn-secondary btn-sm" data-ref="reset">Reset to defaults</button>
      </div>
    </div>
  </details>`;
}

function slider(p, key) {
  const [min, max, step] = RANGES[key];
  const id = `${p}-${key}`;
  return `
        <div class="field" data-field="${key}">
          <div class="row-between">
            <label class="label" for="${id}">${SLIDERS[key].label}</label>
            <output class="value" for="${id}" data-out="${key}"></output>
          </div>
          <input type="range" id="${id}" data-setting="${key}" min="${min}" max="${max}" step="${step}">
        </div>`;
}

function toggle(p, key) {
  const id = `${p}-${key}`;
  return `
        <div class="toggle-row">
          <div>
            <label class="toggle-label" for="${id}">${TOGGLES[key].label}</label>
            <p class="hint" id="${id}-hint">${TOGGLES[key].hint}</p>
          </div>
          <input type="checkbox" role="switch" class="switch" id="${id}" data-setting="${key}" aria-describedby="${id}-hint">
        </div>`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function formatMs(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)} s`;
  return `${v} ms`;
}

function etaLabel(st) {
  switch (st.status) {
    case 'countdown': return 'Starting…';
    case 'paused': return 'Paused';
    case 'done': return 'Done';
    case 'stopped': return 'Stopped';
    case 'typing': return formatEta(st.etaMs);
    default: return '';
  }
}

function validLog(log) {
  return log && log.run ? log : null;
}

function logSummary(log) {
  const r = log.run || {};
  const secs = r.startedAt && r.endedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : 0;
  const time = secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} s`;
  return `Last run · ${time} · ${log.status}`;
}

export function formatEta(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return 'A few seconds left';
  if (s < 60) return `~${Math.ceil(s / 5) * 5} s left`;
  const m = s / 60;
  if (m < 60) return `~${Math.max(1, Math.round(m))} min left`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `~${h} h ${mm} min left` : `~${h} h left`;
}
