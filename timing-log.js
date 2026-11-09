// timing-log.js
// The per-run timing log: what gets recorded while typing, and the CSV you can download.
// Pure functions (no chrome.* calls).

export const LOG_KEY = 'lastLog'; // chrome.storage.local key for the last run's timing log

/** A fresh log for a run of `chars` characters. */
export function newLog(chars) {
  return {
    chars, startedAt: 0, endedAt: 0, pausedMs: 0,
    typos: 0, sendErrors: 0, latSum: 0, latCount: 0, latMax: 0, done: false,
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** saved = { finishedAt, status, wpm, run: <log> } -> CSV text */
export function logToCsv(saved) {
  const r = saved.run || {};
  const total = r.startedAt && r.endedAt ? r.endedAt - r.startedAt : 0;
  const typing = Math.max(0, total - (r.pausedMs || 0));
  const header = [
    'characters', 'started_at', 'duration_s', 'paused_s', 'typing_s', 'chars_per_min',
    'typos_fixed', 'send_errors', 'avg_keystroke_latency_ms', 'max_keystroke_latency_ms', 'finished', 'wpm_setting',
  ];
  const row = [
    r.chars,
    r.startedAt ? new Date(r.startedAt).toISOString() : '',
    (total / 1000).toFixed(1),
    ((r.pausedMs || 0) / 1000).toFixed(1),
    (typing / 1000).toFixed(1),
    typing > 0 ? Math.round((r.chars / typing) * 60000) : '',
    r.typos,
    r.sendErrors,
    r.latCount ? (r.latSum / r.latCount).toFixed(1) : '',
    r.latCount ? r.latMax.toFixed(1) : '',
    r.done ? 'yes' : 'no',
    saved.wpm,
  ];
  return `${header.join(',')}\n${row.map(csvCell).join(',')}\n`;
}
