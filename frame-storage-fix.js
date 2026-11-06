// frame-storage-fix.js
// Runs in humanizeai.pro's own JavaScript world (manifest "world": "MAIN"), before the page's
// scripts, and ONLY when the site is embedded in a frame (the side panel). Normal tabs are untouched.
//
// Why: inside the side panel, humanizeai.pro is a third-party frame, and Chrome blocks its
// cookies there. The site stores your cookie-popup answer in a cookie, so the write silently
// fails and the popup never closes ("Accept all" and "Decline" appear to do nothing).
//
// Fix: cookies the page sets from JavaScript get the attributes Chrome allows for embedded
// frames: "SameSite=None; Secure; Partitioned" (CHIPS). Partitioned cookies are kept separately
// for this embedding only, so they never mix with the site's cookies in a normal tab.

(() => {
  if (window.top === window) return; // only in frames

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (desc && desc.get && desc.set) {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get.call(this);
      },
      set(value) {
        let v = String(value);
        if (!/;\s*partitioned\b/i.test(v)) {
          v = v
            .replace(/;\s*samesite=[^;]*/gi, '')
            .replace(/;\s*secure\b/gi, '')
            + '; SameSite=None; Secure; Partitioned';
        }
        desc.set.call(this, v);
      },
    });
  }

  // If Chrome also blocks storage in the frame, give the page a working in-memory stand-in
  // instead of letting every localStorage call throw.
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[name];
      s.getItem('__probe__');
    } catch {
      const data = new Map();
      const shim = {
        get length() { return data.size; },
        key: (i) => [...data.keys()][i] ?? null,
        getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
        setItem: (k, v) => { data.set(String(k), String(v)); },
        removeItem: (k) => { data.delete(String(k)); },
        clear: () => { data.clear(); },
      };
      try {
        Object.defineProperty(window, name, { configurable: true, get: () => shim });
      } catch {
        // can't replace it; leave as is
      }
    }
  }
})();
