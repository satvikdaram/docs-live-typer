// sidepanel.js — the side panel: one screen (text box, Humanize, Start, settings),
// with humanizeai.pro loaded just below the visible area.
import { mountTyper } from './typer-ui.js';
import { HUMANIZER_URL } from './shared.js';

const FRAME_TIMEOUT_MS = 12000;
const HUMANIZE_TIMEOUT_MS = 120000;
const REPLY_TIMEOUT_MS = 3000;
const AUTO_START_KEY = 'autoStart';

const HUMANIZE_ERRORS = {
  empty: 'Paste some text into the box first.',
  'no-input': "Couldn't find the site's text box. Press Site ↓ and check humanizeai.pro loaded.",
  'no-button': "Couldn't press the site's Humanize button. Press Site ↓ and answer its cookie popup.",
  busy: 'The humanizer is still working on the last request.',
  unreachable: "Couldn't reach humanizeai.pro. Press Site ↓, then Reload, and try again.",
  timeout: 'No result after 2 minutes. Press Site ↓ to see what humanizeai.pro says.',
};

const view = document.getElementById('view-main');
const typer = mountTyper(document.getElementById('typer'), { onHumanize: humanize });

// ---------- keep the panel at the top ----------
// The embedded site can grab focus while it works, which would scroll the panel down to it.
// While humanizing (and briefly after), undo any scroll you didn't make yourself.

let humanizing = false;
let lockUntil = 0;
let userScrollAt = 0;
const markUserScroll = () => { userScrollAt = Date.now(); };
for (const evt of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
  view.addEventListener(evt, markUserScroll, { passive: true });
}
view.addEventListener('scroll', () => {
  const locked = humanizing || Date.now() < lockUntil;
  if (locked && Date.now() - userScrollAt > 800 && view.scrollTop !== 0) view.scrollTop = 0;
});

// ---------- humanizeai.pro frame ----------

const frame = document.getElementById('humanizer-frame');
const loading = document.getElementById('frame-loading');
const fallback = document.getElementById('frame-fallback');
const siteState = document.getElementById('site-state');
const siteDetails = document.getElementById('site-details');
let loaded = false;
let frameTimer = null;

function loadFrame() {
  loaded = false;
  fallback.hidden = true;
  loading.hidden = false;
  siteState.textContent = 'Loading…';
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => {
    if (!loaded) {
      loading.hidden = true;
      fallback.hidden = false;
      siteState.textContent = 'Not loaded';
    }
  }, FRAME_TIMEOUT_MS);
  // Re-assigning src forces a fresh load, even for the same URL.
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = HUMANIZER_URL; }, 0);
}

frame.addEventListener('load', () => {
  if (frame.src === 'about:blank' || frame.src === '') return;
  loaded = true;
  clearTimeout(frameTimer);
  loading.hidden = true;
  siteState.textContent = 'Ready';
});

function openHumanizerWindow() {
  chrome.windows.create({ url: HUMANIZER_URL, type: 'popup', width: 450, height: 700 })
    .catch((err) => console.error('Could not open window', err));
}

function scrollToSite() {
  markUserScroll();
  siteDetails.scrollIntoView({ block: 'start' });
}

function scrollToTop() {
  markUserScroll();
  view.scrollTop = 0;
}

document.querySelector('[data-site-jump]').addEventListener('click', scrollToSite);
document.getElementById('site-top').addEventListener('click', scrollToTop);
document.getElementById('frame-reload').addEventListener('click', loadFrame);
document.getElementById('fallback-retry').addEventListener('click', loadFrame);
document.getElementById('frame-popout').addEventListener('click', openHumanizerWindow);
document.getElementById('fallback-open').addEventListener('click', openHumanizerWindow);

loadFrame();

// ---------- Humanize ----------
// Puts the text box's text into humanizeai.pro, presses its button, and puts the result
// back into the text box. With "Start typing after humanizing" on, typing then starts.

const autoStart = document.querySelector('[data-auto-start]');
let reqCounter = 0;
let humanizeTimer = null;
let replyTimer = null;

function finishHumanize(message = '') {
  humanizing = false;
  lockUntil = Date.now() + 1500;
  clearTimeout(humanizeTimer);
  clearTimeout(replyTimer);
  typer.setHumanizeState({ busy: false, label: 'Humanize', message });
}

function humanize(text) {
  if (humanizing) return;
  if (typer.isBusy()) {
    typer.setHumanizeState({ message: 'Stop typing before humanizing.' });
    return;
  }
  if (!frame.contentWindow || !loaded) {
    typer.setHumanizeState({ message: HUMANIZE_ERRORS.unreachable });
    return;
  }
  humanizing = true;
  view.scrollTop = 0;
  typer.setHumanizeState({ busy: true, label: 'Working…', message: '' });
  const reqId = ++reqCounter;
  // The frame may redirect between www. and the bare domain, so the target origin isn't pinned.
  // The content script checks the message came from this extension.
  frame.contentWindow.postMessage({ type: 'typer:humanize', reqId, text }, '*');
  replyTimer = setTimeout(() => finishHumanize(HUMANIZE_ERRORS.unreachable), REPLY_TIMEOUT_MS);
}

// The content script's answer: did it manage to press the site's button?
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || !/^https:\/\/(www\.)?humanizeai\.pro$/.test(e.origin)) return;
  const data = e.data;
  if (!data || data.type !== 'typer:humanize-result' || data.reqId !== reqCounter || !humanizing) return;
  clearTimeout(replyTimer);
  if (!data.ok) {
    finishHumanize(HUMANIZE_ERRORS[data.reason] || HUMANIZE_ERRORS.unreachable);
    return;
  }
  typer.setHumanizeState({
    busy: true,
    label: 'Humanizing…',
    message: autoStart.checked ? 'Typing starts when the result is ready.' : 'The result will replace the text above.',
  });
  humanizeTimer = setTimeout(() => finishHumanize(HUMANIZE_ERRORS.timeout), HUMANIZE_TIMEOUT_MS);
});

// The result, read from the site by humanizer-content.js once it stops changing.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'humanizer-output' || typeof msg.text !== 'string' || !msg.text.trim()) return;
  if (!humanizing) return; // only use results you asked for
  const words = (msg.text.trim().match(/\S+/g) || []).length;
  finishHumanize(`Humanized · ${words.toLocaleString('en-US')} words`);
  typer.setDraft(msg.text);
  view.scrollTop = 0;
  if (autoStart.checked) typer.start();
  else typer.focusText();
});

autoStart.addEventListener('change', () => {
  chrome.storage.local.set({ [AUTO_START_KEY]: autoStart.checked }).catch(() => {});
});
chrome.storage.local.get(AUTO_START_KEY).then((stored) => {
  autoStart.checked = stored[AUTO_START_KEY] !== false; // on unless you turned it off
}).catch(() => { autoStart.checked = true; });
