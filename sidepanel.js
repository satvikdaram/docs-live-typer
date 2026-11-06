// sidepanel.js — side panel with two tabs: Humanizer (iframe) and Typer.
import { mountTyper } from './typer-ui.js';
import { HUMANIZER_URL } from './shared.js';
import { PANEL_TAB_KEY } from './settings.js';

const FRAME_TIMEOUT_MS = 12000;

const typer = mountTyper(document.getElementById('typer'), { surface: 'panel' });

// ---------- tabs ----------

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(name, { focus = false } = {}) {
  for (const tab of tabs) {
    const selected = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  chrome.storage.local.set({ [PANEL_TAB_KEY]: name }).catch(() => {});
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab.dataset.view));
  tab.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      selectTab(next.dataset.view, { focus: true });
    }
  });
}

chrome.storage.local.get(PANEL_TAB_KEY).then((stored) => {
  if (stored[PANEL_TAB_KEY] === 'typer') selectTab('typer');
}).catch(() => {});

// ---------- humanizer iframe ----------

const frame = document.getElementById('humanizer-frame');
const loading = document.getElementById('frame-loading');
const fallback = document.getElementById('frame-fallback');
let loaded = false;
let timeout = null;

function loadFrame() {
  loaded = false;
  fallback.hidden = true;
  loading.hidden = false;
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    if (!loaded) {
      loading.hidden = true;
      fallback.hidden = false;
    }
  }, FRAME_TIMEOUT_MS);
  // Re-assigning src forces a fresh load, even for the same URL.
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = HUMANIZER_URL; }, 0);
}

frame.addEventListener('load', () => {
  if (frame.src === 'about:blank' || frame.src === '') return;
  loaded = true;
  clearTimeout(timeout);
  loading.hidden = true;
});

function openHumanizerWindow() {
  chrome.windows.create({ url: HUMANIZER_URL, type: 'popup', width: 450, height: 700 })
    .catch((err) => console.error('Could not open window', err));
}

document.getElementById('frame-reload').addEventListener('click', loadFrame);
document.getElementById('fallback-retry').addEventListener('click', loadFrame);
document.getElementById('frame-popout').addEventListener('click', openHumanizerWindow);
document.getElementById('fallback-open').addEventListener('click', openHumanizerWindow);

loadFrame();

// ---------- Send to Typer ----------

const AUTO_START_KEY = 'autoStart';

const sendText = document.getElementById('send-text');
const sendBtn = document.getElementById('send-btn');
const sendAppend = document.getElementById('send-append');
const sendError = document.getElementById('send-error');
const sendStatus = document.getElementById('send-status');
const autoStart = document.getElementById('auto-start');

function setStatus(msg) {
  sendStatus.textContent = msg;
  sendStatus.hidden = !msg;
}

/**
 * Moves the text into the Typer.
 * append: add it as the next table cell instead of replacing the Typer's text (never auto-starts).
 * Otherwise it replaces the text, and starts typing when Auto-start is on.
 */
function sendToTyper({ append = false } = {}) {
  const text = sendText.value;
  if (!text.trim()) {
    sendError.hidden = false;
    sendText.focus();
    return false;
  }
  if (typer.isBusy()) {
    setStatus('Typer is busy. Stop it first.');
    return false;
  }
  sendError.hidden = true;
  if (append) typer.appendCell(text);
  else typer.setDraft(text);
  sendText.value = '';
  setStatus(append ? 'Added as the next cell' : '');
  if (append) return true; // stay here so you can humanize the next block
  selectTab('typer');
  if (autoStart.checked) typer.start();
  else typer.focusText();
  return true;
}

sendBtn.addEventListener('click', () => sendToTyper());
sendAppend.addEventListener('click', () => sendToTyper({ append: true }));
sendText.addEventListener('input', () => { sendError.hidden = true; });
sendText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendToTyper({ append: e.shiftKey });
  }
});

// Output read from humanizeai.pro by humanizer-content.js (in the iframe or a popup window).
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'humanizer-output' || typeof msg.text !== 'string' || !msg.text.trim()) return;
  if (document.activeElement === sendText && sendText.value.trim()) return; // don't overwrite your edits
  sendText.value = msg.text;
  sendError.hidden = true;
  const words = (msg.text.trim().match(/\S+/g) || []).length;
  setStatus(`Got ${words.toLocaleString('en-US')} words from the humanizer`);
  const fromButton = humanizing;
  resetHumanizeButton();
  if (fromButton || autoStart.checked) {
    // After pressing Humanize, the result always goes to the Typer (typing starts if Auto-start is on).
    if (typer.isBusy()) setStatus('New output arrived, but the Typer is busy');
    else sendToTyper();
  }
});

// ---------- Humanize button (presses the site's own button inside the frame) ----------

const humanizeBtn = document.getElementById('humanize-btn');
const HUMANIZE_TIMEOUT_MS = 120000;
const REPLY_TIMEOUT_MS = 3000;
let humanizing = false;
let humanizeTimer = null;
let replyTimer = null;
let reqCounter = 0;

function resetHumanizeButton() {
  humanizing = false;
  clearTimeout(humanizeTimer);
  clearTimeout(replyTimer);
  humanizeBtn.disabled = false;
  humanizeBtn.textContent = 'Humanize';
}

const HUMANIZE_ERRORS = {
  empty: 'Paste your text into the humanizer above first.',
  'no-button': "Couldn't find the site's Humanize button. Press Reload, or answer the cookie popup first.",
  busy: 'The humanizer is still working on the last request.',
  unreachable: "Couldn't reach the humanizer in the panel. Press Reload and try again.",
  timeout: 'No result after 2 minutes. Check the humanizer above for a message.',
};

humanizeBtn.addEventListener('click', () => {
  if (humanizing) return;
  if (typer.isBusy()) {
    setStatus('Typer is busy. Stop it first.');
    return;
  }
  if (!frame.contentWindow || !loaded) {
    setStatus(HUMANIZE_ERRORS.unreachable);
    return;
  }
  humanizing = true;
  humanizeBtn.disabled = true;
  humanizeBtn.textContent = 'Working…';
  setStatus('');
  const reqId = ++reqCounter;
  // The frame may redirect between www. and the bare domain, so don't pin the origin here;
  // the message only carries a request id, and the content script checks it came from us.
  frame.contentWindow.postMessage({ type: 'typer:humanize', reqId }, '*');
  replyTimer = setTimeout(() => {
    resetHumanizeButton();
    setStatus(HUMANIZE_ERRORS.unreachable);
  }, REPLY_TIMEOUT_MS);
});

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || !/^https:\/\/(www\.)?humanizeai\.pro$/.test(e.origin)) return;
  const data = e.data;
  if (!data || data.type !== 'typer:humanize-result' || data.reqId !== reqCounter) return;
  clearTimeout(replyTimer);
  if (!data.ok) {
    resetHumanizeButton();
    setStatus(HUMANIZE_ERRORS[data.reason] || HUMANIZE_ERRORS.unreachable);
    return;
  }
  humanizeBtn.textContent = 'Humanizing…';
  setStatus(autoStart.checked ? 'Typing starts when the result is ready.' : 'The result goes to the Typer when it is ready.');
  humanizeTimer = setTimeout(() => {
    resetHumanizeButton();
    setStatus(HUMANIZE_ERRORS.timeout);
  }, HUMANIZE_TIMEOUT_MS);
});

autoStart.addEventListener('change', () => {
  chrome.storage.local.set({ [AUTO_START_KEY]: autoStart.checked }).catch(() => {});
});
chrome.storage.local.get(AUTO_START_KEY).then((stored) => {
  autoStart.checked = stored[AUTO_START_KEY] !== false; // on unless you turned it off
}).catch(() => { autoStart.checked = true; });
