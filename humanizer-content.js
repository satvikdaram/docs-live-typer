// humanizer-content.js
// Content script for humanizeai.pro (runs in the side panel's iframe and in normal tabs/windows).
// It watches the humanizer's output box and, once the text stops changing, sends it to the
// extension so the side panel can fill the Typer automatically.
//
// The only thing it ever does on the site: when you press "Humanize" in the side panel, it presses
// the site's own "Humanize AI" button once. It never types into the site or clicks anything else.

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
    if (!readInput().trim()) return reply({ ok: false, reason: 'empty' });
    const button = findHumanizeButton();
    if (!button) return reply({ ok: false, reason: 'no-button' });
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return reply({ ok: false, reason: 'busy' });

    // Treat whatever output is showing now as old, so only the NEW result gets sent.
    lastSeen = readOutput();
    lastSent = '';
    changedAt = 0;
    button.click();
    reply({ ok: true });
  });

  const timer = setInterval(() => {
    const now = readOutput();
    if (now !== lastSeen) {
      lastSeen = now;
      changedAt = Date.now();
      return;
    }
    if (now && now !== lastSent && changedAt && Date.now() - changedAt >= SETTLE_MS) {
      lastSent = now;
      send(now);
    }
  }, POLL_MS);
})();
