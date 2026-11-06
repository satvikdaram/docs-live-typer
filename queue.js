// queue.js
// Table mode: text split into cells by a line containing only "---".
// The typer types each cell, presses Tab to move to the next table cell, and so on.
// Also builds the per-cell timing log CSV. Pure functions (no chrome.* calls).

export const CELL_SEP = '';     // private-use character that stands for "move to next cell"
export const LOG_KEY = 'lastLog';     // chrome.storage.local key for the last run's timing log

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/;

/** Splits text into cells. One cell (no "---" lines) means normal, non-table typing. */
export function splitCells(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const cells = [[]];
  for (const line of lines) {
    if (SEPARATOR_LINE.test(line)) cells.push([]);
    else cells[cells.length - 1].push(line);
  }
  if (cells.length === 1) return [cells[0].join('\n')];
  // In table mode, blank lines around a cell's text are just spacing in the box.
  return cells.map((c) => c.join('\n').replace(/^\n+|\n+$/g, ''));
}

/**
 * Turns text into the character stream the typer walks through.
 * chars: array of characters, with CELL_SEP between cells
 * cellCount: number of cells (1 = normal typing)
 */
export function buildQueue(text) {
  const cells = splitCells(text);
  const chars = [];
  cells.forEach((cell, i) => {
    if (i > 0) chars.push(CELL_SEP);
    for (const ch of Array.from(cell)) chars.push(ch);
  });
  return { chars, cellCount: cells.length };
}

/** For timing math, "next cell" behaves like a line break. */
export function timingChars(chars) {
  return chars.map((c) => (c === CELL_SEP ? '\n' : c));
}

// ---------- timing log ----------

export function newLogRow(cell, chars) {
  return {
    cell, chars, startedAt: 0, endedAt: 0, pausedMs: 0,
    typos: 0, sendErrors: 0, latSum: 0, latCount: 0, latMax: 0, done: false,
  };
}

/** Characters per cell (separators not counted), for log rows. */
export function cellLengths(chars) {
  const out = [0];
  for (const c of chars) {
    if (c === CELL_SEP) out.push(0);
    else out[out.length - 1]++;
  }
  return out;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** log = { finishedAt, status, wpm, rows: [...] } -> CSV text */
export function logToCsv(log) {
  const header = [
    'cell', 'characters', 'started_at', 'duration_s', 'paused_s', 'typing_s',
    'chars_per_min', 'typos_fixed', 'send_errors', 'avg_keystroke_latency_ms',
    'max_keystroke_latency_ms', 'finished',
  ];
  const lines = [header.join(',')];
  for (const r of log.rows || []) {
    const total = r.startedAt && r.endedAt ? r.endedAt - r.startedAt : 0;
    const typing = Math.max(0, total - r.pausedMs);
    lines.push([
      r.cell,
      r.chars,
      r.startedAt ? new Date(r.startedAt).toISOString() : '',
      (total / 1000).toFixed(1),
      (r.pausedMs / 1000).toFixed(1),
      (typing / 1000).toFixed(1),
      typing > 0 ? Math.round((r.chars / typing) * 60000) : '',
      r.typos,
      r.sendErrors,
      r.latCount ? (r.latSum / r.latCount).toFixed(1) : '',
      r.latCount ? r.latMax.toFixed(1) : '',
      r.done ? 'yes' : 'no',
    ].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(`# run finished ${new Date(log.finishedAt || Date.now()).toISOString()}, status ${log.status}, ${log.wpm} WPM setting`);
  return lines.join('\n');
}
