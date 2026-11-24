// humanizer-content.js
// Content script for humanizeai.pro (runs in the side panel's iframe and in normal tabs/windows).
// It watches the humanizer's output box and, once the text stops changing, sends it to the
// extension so the side panel can fill the Typer automatically.
//
// The only thing it ever does on the site: when you press "Humanize" in the side panel, it puts
// your text into the site's input box and presses the site's own "Humanize AI" button once.
// It never clicks anything else.

(() => {
  const POLL_MS = 500;
  const SETTLE_MS = 2000; // output must be unchanged this long (it streams in) before it's sent

  // humanizeai.pro uses generated class names, so match on the stable parts.
  function readOutput() {
    const box = document.getElementById('rich-textarea');
    if (box && typeof box.value === 'string' && box.value.trim()) return box.value;
    const container = document.querySelector('[class*="OutputContainer_outputContainer"]');
    const wrapper = container && container.querySelector('[class*="EditableOutput_editableOutputWrapper"]');
    const text = wrapper ? wrapper.innerText.replace(/​/g, '') : '';
    return text.trim() ? text : '';
  }

  let lastSeen = readOutput();   // whatever is there on load counts as "old"
  let lastSent = lastSeen;
  let changedAt = 0;

  function send(text) {
    try {
      chrome.runtime.sendMessage({ type: 'humanizer-output', text }).catch(() => {
        // Side panel closed: nobody listening. Nothing to do.
      });
    } catch {
      // Extension was reloaded; this old content script can no longer talk to it.
      clearInterval(timer);
    }
  }

  // ---------- "Humanize" button in the side panel ----------

  function readInput() {
    const box = document.querySelector('textarea[class*="InputContainer_inputContainer"]')
      || document.querySelector('textarea[placeholder*="Paste your text" i]');
    return box ? box.value : '';
  }

  function findHumanizeButton() {
    return [...document.querySelectorAll('button')]
      .find((b) => /^\s*humanize(\s+ai)?\s*$/i.test(b.textContent || ''));
  }

  // Only the side panel (this extension's own page, which embeds this frame) may ask.
  window.addEventListener('message', (e) => {
    let extOrigin;
    try {
      extOrigin = `chrome-extension://${chrome.runtime.id}`;
    } catch {
      return; // extension reloaded
    }
    if (e.origin !== extOrigin || !e.data || e.data.type !== 'typer:humanize') return;
    const reply = (result) => {
      if (e.source) e.source.postMessage({ type: 'typer:humanize-result', reqId: e.data.reqId, ...result }, e.origin);
    };
    const text = typeof e.data.text === 'string' ? e.data.text : null;
    if (text !== null && !text.trim()) return reply({ ok: false, reason: 'empty' });

    // Put the text in, then wait (up to ~4 s) for the site to accept it and enable its button.
    // The site can re-render while it loads and drop the text, so put it back if that happens.
    const started = Date.now();
    const attempt = () => {
      if (text !== null && readInput() !== text && !setInput(text)) return reply({ ok: false, reason: 'no-input' });
      const button = findHumanizeButton();
      const ready = button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
      if (ready && readInput().trim()) {
        // Treat whatever output is showing now as old, so only the NEW result gets sent.
        lastSeen = readOutput();
        lastSent = '';
        changedAt = 0;
        awaitingResult = true;
        button.click();
        return reply({ ok: true });
      }
      if (Date.now() - started < 4000) return setTimeout(attempt, 250);
      if (!readInput().trim()) return reply({ ok: false, reason: 'empty' });
      return reply({ ok: false, reason: button ? 'busy' : 'no-button' });
    };
    setTimeout(attempt, 150);
  });

  // The humanized text read straight from the site's /api/process answer (frame-storage-fix.js).
  // This is the main path: inside the panel the site often never draws the result on screen.
  let awaitingResult = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'typer:api-result' || typeof e.data.text !== 'string') return;
    if (!awaitingResult) return;
    awaitingResult = false;
    lastSent = e.data.text; // don't send it a second time from the on-screen reader
    send(e.data.text);
  });

  /** Puts text into the site's input box the way a paste would, so the site notices the change. */
  function setInput(text) {
    const box = document.querySelector('textarea[class*="InputContainer_inputContainer"]')
      || document.querySelector('textarea[placeholder*="Paste your text" i]');
    if (!box) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    // No box.focus(): focusing inside the embedded site makes Chrome scroll the side panel down to it.
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const timer = setInterval(() => {
    const now = readOutput();
    if (now !== lastSeen) {
      lastSeen = now;
      changedAt = Date.now();
      return;
    }
    if (now && now !== lastSent && changedAt && Date.now() - changedAt >= SETTLE_MS) {
      lastSent = now;
      awaitingResult = false;
      send(now);
    }
  }, POLL_MS);
})();
