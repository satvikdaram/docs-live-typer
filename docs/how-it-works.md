# How it works

A tour of the code for anyone who wants to read or change it. Plain HTML, CSS and JavaScript (ES modules). No frameworks, no build step, no remote code.

## Files

```
docs-live-typer/
├── manifest.json          Manifest V3
├── background.js          Service worker: runs the typing loop, owns chrome.debugger
├── timing.js              Typing rhythm math (pure functions)
├── queue.js               Table mode (--- splits) and the timing-log CSV
├── settings.js            Defaults, slider ranges, storage helpers
├── shared.js              Google Docs URL check, error messages, constants
├── sidepanel.html/.js     The side panel: Humanizer and Typer tabs
├── typer-ui.js            The Typer tab's controls
├── styles.css             All styles, automatic light and dark mode
├── humanizer-content.js   Content script on humanizeai.pro: fills the input and presses Humanize on request, reads the output
├── frame-storage-fix.js   Lets humanizeai.pro keep cookies while embedded in the panel
├── rules.json             Header rule so humanizeai.pro can load inside the panel
├── icons/                 16, 48 and 128 px icons
├── tools/make_icons.py    Draws the icons
└── docs/                  This documentation
```

## Why the debugger API?

Google Docs draws its own editor and ignores synthetic JavaScript key events (`isTrusted: false`). Setting text directly doesn't work either. So the extension attaches `chrome.debugger` to the doc tab (protocol 1.3) and sends input through the Chrome DevTools Protocol:

- `Input.insertText` for normal characters
- `Input.dispatchKeyEvent` (keyDown + keyUp) for **Enter**, **Tab** and **Backspace**

It also turns on `Emulation.setFocusEmulationEnabled`, so the doc keeps acting focused when you switch tabs.

## The typing loop

The loop lives in the **service worker**, not the panel, so closing the panel doesn't stop it.

1. **Start:** check that the tab is an editable Google Doc, attach the debugger, then count down.
2. **Each character:**
   - `timing.js` returns a delay, and the worker waits.
   - It sends the keystroke.
   - It saves progress to `chrome.storage.session`.
3. **Every 12 characters:** re-check that the tab is still the same doc. Tab close, navigation and debugger detach are also handled the moment they happen.
4. **Typos:** a typo is a short, uninterruptible sequence: wrong key → maybe 1–2 more letters → pause → backspaces. Then the correct character is typed normally.
5. **Done or stopped:** detach the debugger and save the timing log to `chrome.storage.local`.

**Staying alive.**
- Chrome keeps a service worker running while it has an active debugger session, and every extension API call resets its idle timer.
- A 30-second `chrome.alarms` heartbeat also runs during a run.
- If the worker restarts anyway, it reads the saved position, reattaches and continues. It clears any stale debugger session first.

**Talking to the panel.** The panel opens a long-lived port (`chrome.runtime.connect`). The worker only posts to ports that are still open, so a closed panel never causes "Receiving end does not exist". The panel reconnects automatically if the worker restarts.

## Table mode

`queue.js` splits the text at lines containing only `---` and joins the blocks with a private-use character (`U+E000`) that the loop sends as a Tab key. For timing, that character counts as a line break. No separator follows the last block, so Docs never adds an extra row.

## The Humanizer panel

The Humanizer tab shows your own text box. The real site stays loaded in a collapsed frame below it (CSS hides it without unloading it). No private API is called: the extension drives the normal website. humanizeai.pro normally refuses to load inside other pages, so three small pieces make it work:

| Piece | What it does |
|---|---|
| `rules.json` | Removes `X-Frame-Options` and `Content-Security-Policy` response headers, **only** for `humanizeai.pro` and **only** for `sub_frame` requests. Normal tabs aren't touched |
| `frame-storage-fix.js` | Runs in the page's own JavaScript world, only when embedded. Adds `SameSite=None; Secure; Partitioned` to cookies the page sets, so its cookie-popup answer can be saved. Partitioned cookies are kept separate from the site's normal cookies |
| `humanizer-content.js` | When the panel's **Humanize** button sends a `postMessage` (checked to come from this extension), it puts the text into the site's input box and presses the site's own Humanize button once. It then polls the output box, and when the result has stopped changing for 2 s, sends it to the panel |

## Permissions

| Permission | Why |
|---|---|
| `debugger` | Send real keystrokes to the Google Doc tab |
| `sidePanel` | Show the panel, and open it from the toolbar icon |
| `storage` | Settings, draft text, timing log (`local`); current run progress (`session`) |
| `tabs` | Read the active tab's URL to tell whether it's a Google Doc; notice when it closes or navigates |
| `alarms` | Keep-alive heartbeat during a run |
| `declarativeNetRequestWithHostAccess` | Run the one header rule in `rules.json` |
| `https://docs.google.com/*` | Google Docs tabs |
| `https://www.humanizeai.pro/*`, `https://humanizeai.pro/*` | The header rule and the content scripts |

The pause shortcut is declared under the manifest's `commands` key. `commands` is not a permission.

## Requirements

- **Chrome 116+**: the side panel needs 114, and opening it from the icon needs 116.
- On Chrome 120+, the heartbeat alarm can run every 30 s. Older versions round it up to 1 minute, which still works.

## Testing

The engine was tested against a fake Chrome and a fake Google Doc. The checks covered:

- exact final text, including typo fixes, emoji, tabs and CRLF
- pause, resume and stop
- cancelling the debugging bar
- DevTools already attached
- tab closed or navigated away
- a service-worker restart mid-run
- table mode and the timing log

Basic typing, including typo fixes and the pause shortcut, was also checked by hand on a real Google Doc.
