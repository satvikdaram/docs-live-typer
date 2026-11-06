// settings.js
// User settings: defaults, allowed ranges, and load/save helpers (chrome.storage.local).

export const SETTINGS_KEY = 'settings';
export const DRAFT_KEY = 'draft';
export const NOTICE_KEY = 'debugNoticeDismissed';
export const PANEL_TAB_KEY = 'panelTab';

export const SPEED_PRESETS = [
  { label: 'Slow', wpm: 35 },
  { label: 'Normal', wpm: 60 },
  { label: 'Fast', wpm: 90 },
];

export const DEFAULT_SETTINGS = Object.freeze({
  wpm: 60,
  randomness: 50,     // 0-100 %, how much each keystroke varies
  commaPause: 250,    // ms, median extra pause after , ; :
  sentencePause: 650, // ms, median extra pause after . ? !
  newlinePause: 1100, // ms, median extra pause after a line break
  bursts: true,
  fatigue: false,
  typos: false,
  typoRate: 2,        // % of letters that get a typo
  countdown: 0,       // seconds before typing starts (0 = start right away)
});

// Slider limits: [min, max, step]
export const RANGES = Object.freeze({
  wpm: [10, 200, 1],
  randomness: [0, 100, 5],
  commaPause: [0, 1000, 25],
  sentencePause: [0, 2500, 50],
  newlinePause: [0, 4000, 100],
  typoRate: [0.5, 8, 0.5],
  countdown: [0, 10, 1],
});

const BOOLEAN_KEYS = ['bursts', 'fatigue', 'typos'];

/** Fills in missing values and clamps everything to its allowed range. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const n = Number(src[key]);
    if (Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, n));
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  return out;
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings) {
  const clean = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: clean });
  return clean;
}

export async function resetSettings() {
  return saveSettings(DEFAULT_SETTINGS);
}
