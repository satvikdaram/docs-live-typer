// timing.js
// All typing-rhythm math lives here. Pure functions only: no chrome.*, no DOM, no timers.
// Anything random takes a `rand` argument (a function returning a number in [0, 1)),
// so you can pass a seeded generator when experimenting.
//
// Tuning: the numbers in TIMING are the knobs. See the README section
// "Tuning timing.js" for which ones to change.

export const TIMING = {
  CHARS_PER_WORD: 5,          // standard WPM definition: 1 word = 5 characters

  // Single keystroke limits
  MIN_KEY_MS: 35,             // no keystroke is ever faster than this
  MAX_KEY_FACTOR: 3.5,        // ...or slower than 3.5x its expected delay
  MAX_TOTAL_MS: 6000,         // hard ceiling for keystroke + any pause (no long freezes)
  MAX_SIGMA: 0.8,             // log-normal spread when "Randomness" is 100%

  // Per-character speed factors (below 1 = faster, above 1 = slower)
  FAST_BIGRAMS: ['th', 'he', 'in', 'er', 'an', 're', 'on', 'en', 'at', 'nd', 'ou', 'es', 'ha', 'st', 'ed', 'to', 'it', 'is'],
  BIGRAM_FACTOR: 0.8,         // second letter of a common pair
  ING_FACTOR: 0.7,            // the "g" at the end of "ing"
  DOUBLE_LETTER_FACTOR: 0.85, // "ll", "ee", ...
  SHIFT_FACTOR: 1.3,          // capitals and symbols that need Shift
  SPACE_FACTOR: 0.9,

  // Bursts: a few words quickly, then a tiny pause
  BURST_WORDS_MIN: 2,
  BURST_WORDS_MAX: 5,
  BURST_SPEEDUP: 0.88,
  BURST_PAUSE_MIN_MS: 120,
  BURST_PAUSE_MAX_MS: 420,

  // Punctuation and line-break pauses (medians come from the settings sliders)
  PAUSE_SIGMA: 0.35,          // how much those pauses vary
  MAX_PAUSE_MS: 5000,
  BLANK_LINE_FACTOR: 0.4,     // second Enter in a row pauses less

  // Fatigue
  FATIGUE_MAX: 0.2,           // at most 20% slower
  FATIGUE_SCALE_CHARS: 4000,  // reaches ~63% of the max after this many characters

  // Typos
  TYPO_IMMEDIATE_CHANCE: 0.6, // otherwise noticed 1-2 characters later
  TYPO_MAX_LAG: 2,
  TYPO_NOTICE_MS: 380,        // median "wait, that's wrong" pause before backspacing
  BACKSPACE_FACTOR: 0.6,      // backspaces are faster than normal keys
  BACKSPACE_MIN_MS: 70,
  KEY_HOLD_MIN_MS: 30,        // keyDown -> keyUp time for Enter, Tab, Backspace
  KEY_HOLD_MAX_MS: 90,
};

const FAST_BIGRAM_SET = new Set(TIMING.FAST_BIGRAMS);
const SHIFT_SYMBOLS = '~!@#$%^&*()_+{}|:"<>?';
const SENTENCE_END = '.?!';
const CLAUSE_END = ',;:';
const CLOSERS = '"\')]”’';

// QWERTY neighbours, used for typos
export const QWERTY_NEIGHBORS = {
  q: 'wa', w: 'qeas', e: 'wrsd', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'ipkl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

// ---------- basic helpers ----------

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function uniform(rand, min, max) {
  return min + rand() * (max - min);
}

export function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Standard normal sample (Box-Muller). */
export function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal sample whose median is `median`. */
export function logNormal(median, sigma, rand) {
  if (median <= 0) return 0;
  return median * Math.exp(sigma * gaussian(rand));
}

// ---------- speed ----------

/** Base delay per character in ms: WPM x 5 characters per word. */
export function baseDelayMs(wpm) {
  const w = clamp(Number(wpm) || 60, 1, 400);
  return 60000 / (w * TIMING.CHARS_PER_WORD);
}

/** Maps the 0-100 "Randomness" slider to a log-normal sigma. */
export function sigmaFor(randomness) {
  return (clamp(Number(randomness) || 0, 0, 100) / 100) * TIMING.MAX_SIGMA;
}

export function needsShift(ch) {
  return (ch >= 'A' && ch <= 'Z') || SHIFT_SYMBOLS.includes(ch);
}

/** Speed multiplier for one character given the two before it. */
export function charFactor(prev2, prev, ch) {
  let f = 1;
  const c = ch.toLowerCase();
  const p = (prev || '').toLowerCase();
  if ((prev2 + prev + ch).toLowerCase() === 'ing') f *= TIMING.ING_FACTOR;
  else if (FAST_BIGRAM_SET.has(p + c)) f *= TIMING.BIGRAM_FACTOR;
  else if (p === c && /[a-z]/.test(c)) f *= TIMING.DOUBLE_LETTER_FACTOR;
  if (ch === ' ') f *= TIMING.SPACE_FACTOR;
  if (needsShift(ch)) f *= TIMING.SHIFT_FACTOR;
  return f;
}

/** 1.0 at the start, creeping up to 1 + FATIGUE_MAX over long passages. */
export function fatigueFactor(index, enabled) {
  if (!enabled) return 1;
  return 1 + TIMING.FATIGUE_MAX * (1 - Math.exp(-index / TIMING.FATIGUE_SCALE_CHARS));
}

function keyMedian(ctx) {
  const s = ctx.settings;
  return baseDelayMs(s.wpm)
    * charFactor(ctx.prev2 || '', ctx.prev || '', ctx.ch)
    * fatigueFactor(ctx.index || 0, s.fatigue)
    * (s.bursts ? TIMING.BURST_SPEEDUP : 1);
}

/**
 * Time between the previous keystroke and this one, without punctuation pauses.
 * ctx = { prev2, prev, ch, index, settings }
 */
export function keystrokeDelay(ctx, rand) {
  const median = keyMedian(ctx);
  const d = logNormal(median, sigmaFor(ctx.settings.randomness), rand);
  const upper = Math.max(TIMING.MIN_KEY_MS, median * TIMING.MAX_KEY_FACTOR);
  return clamp(d, TIMING.MIN_KEY_MS, upper);
}

// ---------- pauses ----------

/**
 * Median extra pause before typing `ch`, based on what came just before.
 * Commas/sentences pause before the following space; line breaks pause
 * before the first character of the new line.
 */
export function punctuationMedian(prev2, prev, ch, s) {
  if (prev === '\n') return ch === '\n' ? s.newlinePause * TIMING.BLANK_LINE_FACTOR : s.newlinePause;
  if (ch !== ' ' || !prev) return 0;
  let mark = prev;
  if (CLOSERS.includes(prev)) mark = prev2; // e.g.  ."  or  ),
  if (!mark) return 0;
  if (SENTENCE_END.includes(mark)) return s.sentencePause;
  if (CLAUSE_END.includes(mark)) return s.commaPause;
  return 0;
}

export function punctuationPause(prev2, prev, ch, s, rand) {
  const median = punctuationMedian(prev2, prev, ch, s);
  if (median <= 0) return 0;
  return clamp(logNormal(median, TIMING.PAUSE_SIGMA, rand), 0, TIMING.MAX_PAUSE_MS);
}

// ---------- bursts ----------

export function newBurst(rand) {
  return { wordsLeft: randInt(rand, TIMING.BURST_WORDS_MIN, TIMING.BURST_WORDS_MAX) };
}

function isWordStart(prev, ch) {
  return prev === ' ' && ch !== ' ';
}

/** Counts words; when a burst runs out, returns a short pause and starts a new burst. */
export function stepBurst(burst, prev, ch, rand) {
  if (!isWordStart(prev, ch)) return { burst, pauseMs: 0 };
  const wordsLeft = burst.wordsLeft - 1;
  if (wordsLeft > 0) return { burst: { wordsLeft }, pauseMs: 0 };
  return {
    burst: newBurst(rand),
    pauseMs: uniform(rand, TIMING.BURST_PAUSE_MIN_MS, TIMING.BURST_PAUSE_MAX_MS),
  };
}

/**
 * Full delay before typing ctx.ch: keystroke + punctuation pause or burst pause.
 * ctx = { prev2, prev, ch, index, settings, burst }
 * Returns { delayMs, burst } (burst is the updated burst state to pass next time).
 */
export function nextDelay(ctx, rand) {
  const s = ctx.settings;
  const keyMs = keystrokeDelay(ctx, rand);
  let pauseMs = punctuationPause(ctx.prev2 || '', ctx.prev || '', ctx.ch, s, rand);
  let burst = ctx.burst || newBurst(rand);
  if (s.bursts) {
    const step = stepBurst(burst, ctx.prev || '', ctx.ch, rand);
    burst = step.burst;
    if (pauseMs === 0) pauseMs = step.pauseMs;
  }
  return { delayMs: Math.min(keyMs + pauseMs, TIMING.MAX_TOTAL_MS), burst };
}

// ---------- typos ----------

/** A neighbouring QWERTY key with the same case, or null for non-letters. */
export function neighborKey(ch, rand) {
  const lower = ch.toLowerCase();
  const options = QWERTY_NEIGHBORS[lower];
  if (!options) return null;
  const pick = options[Math.floor(rand() * options.length)];
  return ch === lower ? pick : pick.toUpperCase();
}

/**
 * Decides whether to make a typo at chars[index].
 * Returns null, or { wrong, lag } where lag = how many correct characters get
 * typed after the mistake before it is noticed (0 = noticed right away).
 * Lag only runs over letters, so Docs autocorrect (triggered by a space) can't interfere.
 */
export function planTypo(chars, index, s, rand) {
  if (!s.typos) return null;
  const ch = chars[index];
  if (!/^[A-Za-z]$/.test(ch)) return null;
  if (rand() >= s.typoRate / 100) return null;
  const wrong = neighborKey(ch, rand);
  if (!wrong) return null;
  let lag = 0;
  if (rand() >= TIMING.TYPO_IMMEDIATE_CHANCE) {
    const wanted = 1 + Math.floor(rand() * TIMING.TYPO_MAX_LAG);
    while (lag < wanted && index + lag + 1 < chars.length && /^[A-Za-z]$/.test(chars[index + lag + 1])) lag++;
  }
  return { wrong, lag };
}

export function typoNoticePause(rand) {
  return clamp(logNormal(TIMING.TYPO_NOTICE_MS, 0.35, rand), 150, 1500);
}

export function backspaceDelay(s, rand) {
  const median = baseDelayMs(s.wpm) * TIMING.BACKSPACE_FACTOR;
  return clamp(logNormal(median, 0.25, rand), TIMING.BACKSPACE_MIN_MS, Math.max(TIMING.BACKSPACE_MIN_MS, median * 3));
}

export function keyHoldMs(rand) {
  return uniform(rand, TIMING.KEY_HOLD_MIN_MS, TIMING.KEY_HOLD_MAX_MS);
}

// ---------- time estimates (for "~4 min left") ----------

/** Expected (average) time spent on chars[index], including pauses and typo fixes. */
export function expectedCharMs(prev2, prev, ch, index, s) {
  const sigma = sigmaFor(s.randomness);
  let ms = keyMedian({ prev2, prev, ch, index, settings: s }) * Math.exp((sigma * sigma) / 2);
  const pMedian = punctuationMedian(prev2, prev, ch, s);
  if (pMedian > 0) {
    ms += pMedian * Math.exp((TIMING.PAUSE_SIGMA ** 2) / 2);
  } else if (s.bursts && isWordStart(prev, ch)) {
    const avgWords = (TIMING.BURST_WORDS_MIN + TIMING.BURST_WORDS_MAX) / 2;
    const avgPause = (TIMING.BURST_PAUSE_MIN_MS + TIMING.BURST_PAUSE_MAX_MS) / 2;
    ms += avgPause / avgWords;
  }
  if (s.typos && /^[A-Za-z]$/.test(ch)) {
    const base = baseDelayMs(s.wpm);
    const avgLag = (1 - TIMING.TYPO_IMMEDIATE_CHANCE) * (1 + TIMING.TYPO_MAX_LAG) / 2;
    const fix = TIMING.TYPO_NOTICE_MS + (avgLag + 1) * base * TIMING.BACKSPACE_FACTOR + avgLag * base * 2 + base;
    ms += (s.typoRate / 100) * fix;
  }
  return ms;
}

/** table[i] = expected ms to type chars[i..end]. */
export function remainingTimeTable(chars, s) {
  const n = chars.length;
  const table = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) {
    table[i] = table[i + 1] + expectedCharMs(chars[i - 2] || '', chars[i - 1] || '', chars[i], i, s);
  }
  return table;
}
