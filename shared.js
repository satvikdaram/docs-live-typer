// shared.js
// Constants, Google Docs URL checks and the error catalog.
// Imported by the service worker (background.js) and by the popup / side panel UI.

export const PORT_NAME = 'typer-ui';
export const HUMANIZER_URL = 'https://www.humanizeai.pro/';

// A run is "active" while it is in one of these states.
export const ACTIVE_STATUSES = ['countdown', 'typing', 'paused'];

/**
 * Recognises a Google Docs document URL.
 * Returns { docId, editable } or null when the URL is not a Google Doc.
 * "editable" is false for /view, /preview, /pub and similar read-only pages.
 */
export function parseDocUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(\/[^?#]*)?$/);
  if (!m) return null;
  const rest = (m[2] || '').toLowerCase();
  const editable = rest === '' || rest === '/' || rest.startsWith('/edit');
  return { docId: m[1], editable };
}

// Every error the user can see. "fix" is the plain-English next step.
export const ERRORS = {
  EMPTY_TEXT: {
    title: 'There is no text to type.',
    fix: 'Paste some text into the box, then press Start.',
  },
  NO_TAB: {
    title: 'Could not find the current tab.',
    fix: 'Click the Google Doc tab once, then press Start again.',
  },
  NOT_DOC: {
    title: 'This tab is not a Google Doc.',
    fix: 'Open a document on docs.google.com/document, click into the page, then press Start.',
  },
  VIEW_ONLY: {
    title: 'This doc is open in view-only mode.',
    fix: 'Open the doc in edit mode (the address should end in /edit) and make sure you have edit access.',
  },
  ALREADY_ATTACHED: {
    title: 'Another debugger is already attached to this tab.',
    fix: 'Close DevTools on the Google Doc tab (and turn off any other extension that debugs pages), then try again.',
  },
  ATTACH_FAILED: {
    title: 'Chrome would not let the extension control this tab.',
    fix: 'Reload the Google Doc tab and try again.',
  },
  CANCELED: {
    title: 'Typing paused because the debugging bar was cancelled.',
    fix: 'Press Resume to continue from where it stopped. Leave the "started debugging this browser" bar open while typing.',
  },
  DETACHED: {
    title: 'The extension lost control of the tab.',
    fix: 'This usually means DevTools was opened on the doc. Close DevTools, click back into the doc, and press Resume.',
  },
  TAB_CLOSED: {
    title: 'The Google Doc tab was closed, so typing stopped.',
    fix: 'Open the doc again. Delete the part that was already typed from the text box, then press Start.',
  },
  NAVIGATED: {
    title: 'The tab left the Google Doc, so typing stopped.',
    fix: 'Go back to the document. Delete the part that was already typed from the text box, then press Start.',
  },
  SEND_FAILED: {
    title: 'A keystroke could not be sent, so typing paused.',
    fix: 'Click into the doc and press Resume. If it keeps happening, reload the doc tab.',
  },
  NO_WORKER: {
    title: 'Could not reach the extension in the background.',
    fix: 'Close and reopen this window. If that does not help, reload the extension at chrome://extensions.',
  },
};

export function makeError(code, detail = '') {
  const e = ERRORS[code] || ERRORS.ATTACH_FAILED;
  return { code, title: e.title, fix: e.fix, detail: String(detail || '') };
}
