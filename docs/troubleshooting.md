# Troubleshooting

When something goes wrong, the red box in the Typer says what happened and how to fix it. This page covers the common cases in more detail.

- [The "started debugging this browser" bar](#the-started-debugging-this-browser-bar)
- [Another debugger is already attached](#another-debugger-is-already-attached)
- [Typing stopped or paused](#typing-stopped-or-paused)
- [Text looks oddly formatted](#text-looks-oddly-formatted)
- [The shortcut does nothing](#the-shortcut-does-nothing)
- [The Humanizer tab is blank](#the-humanizer-tab-is-blank)
- [The Humanizer is stuck on a cookie popup](#the-humanizer-is-stuck-on-a-cookie-popup)
- [The Humanize button shows an error](#the-humanize-button-shows-an-error)
- [Could not reach the extension in the background](#could-not-reach-the-extension-in-the-background)

---

## The "started debugging this browser" bar

This is normal. Chrome shows it whenever an extension uses its debugger API, which is how this extension sends real keystrokes. It goes away when typing finishes or you press Stop.

If you click **Cancel** on the bar, typing **pauses**. Press **Resume** to carry on from the same spot.

**Hiding it.** An extension can't hide the bar. You can, by starting Chrome with a flag. Quit Chrome completely first (**Cmd+Q**), then run:

```bash
open -a "Google Chrome" --args --silent-debugger-extension-api
```

This lasts until you quit Chrome. While it's on, the bar is hidden for **every** extension that uses the debugger, so you won't be warned if another extension starts debugging a tab.

## Another debugger is already attached

DevTools is open on the doc tab, or another extension is debugging it. Close DevTools, or turn the other extension off, then press **Start** or **Resume** again.

## Typing stopped or paused

- **The tab was closed or went to another page.** The run stops. To continue, delete the part that's already typed from the Typer's text box, then press Start again.
- **Text is going to the wrong place.** Typing goes wherever the doc's cursor is. Click where you want the text, then press **Resume**.
- **"A keystroke could not be sent."** Click into the doc and press **Resume**. If it keeps happening, reload the doc tab.
- **View-only doc.** Open it in edit mode (the address should end in `/edit`).

## Text looks oddly formatted

Google Docs auto-formats as you type. Lines starting with `- ` or `1. ` turn into lists, and `--` and straight quotes get replaced. To turn this off, open **Tools → Preferences** in Docs and uncheck:

- Automatically detect lists
- Use smart quotes
- Automatic substitution

## The shortcut does nothing

- Open `chrome://extensions/shortcuts` and check that **Pause or resume typing** has a key. If it's blank, another extension already uses Alt+Shift+P, so pick a different key.
- The shortcut only pauses or resumes a run that's already going. It doesn't start one.
- Shortcuts don't work on `chrome://` pages or the Chrome Web Store.

## The Humanizer tab is blank

The site is at the bottom of the Humanizer tab. If you hid it, click **Show humanizeai.pro** first.

- Press **Reload**.
- Make sure the extension is enabled and loaded without errors at `chrome://extensions`.
- Use **Window**, which always works because nothing is embedded.

Chrome reports a frame as "loaded" even when the site refused to load in it. So the "didn't load" overlay only appears if nothing at all loads within 12 seconds. The **Window** button is always there.

## The Humanizer is stuck on a cookie popup

Inside the panel the site is embedded, and Chrome blocks cookies for embedded sites. The site saves your answer to its cookie popup in a cookie, so without a fix the popup could never close.

The extension's `frame-storage-fix.js` handles this automatically, so answering the popup once should be enough. If it still won't close:

1. Reload the extension at `chrome://extensions`, then close and reopen the side panel.
2. Still stuck? Open `chrome://settings/cookies`, add `[*.]humanizeai.pro` under **Allowed to use third-party cookies**, then press **Reload** in the panel.

Signing in to the site inside the panel may not work for the same reason. Use **Window** to sign in.

## The Humanize button shows an error

| Message | Fix |
|---|---|
| *Paste some text into the box first* | The Humanizer tab's text box is empty |
| *Couldn't find the site's text box* | Check the site at the bottom of the panel loaded; press Reload |
| *Couldn't press the site's Humanize button* | Answer the site's cookie popup at the bottom of the panel |
| *The humanizer is still working* | Wait for the current result |
| *Couldn't reach the humanizer in the panel* | Press Reload, wait for the site to load, try again |
| *No result after 2 minutes* | Look at the site view for an error message, a word limit or a usage limit |

## Could not reach the extension in the background

Reload the extension at `chrome://extensions`, then close and reopen the side panel.
