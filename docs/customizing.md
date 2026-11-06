# Customizing the typing rhythm

Most people only need the **Settings** section in the panel. This page is for changing the defaults and the underlying timing model in code.

## Where things live

| File | What to change there |
|---|---|
| `settings.js` | `DEFAULT_SETTINGS` (starting values), `RANGES` (slider min/max/step), `SPEED_PRESETS` (Slow/Normal/Fast) |
| `timing.js` | The `TIMING` object at the top: every number behind the rhythm |

After editing, click the reload arrow on the extension at `chrome://extensions`.

## How the rhythm is built

For every character, `timing.js` works out a delay:

1. **Base delay** from the WPM: `60000 / (WPM × 5)` ms. One "word" is 5 characters.
2. **Per-character adjustments:**
   - Common letter pairs (`th`, `he`, `in`, `er`, `an`, …) are faster.
   - The `g` in `ing` is faster still.
   - Capitals and Shift symbols are slower.
3. **Log-normal randomness** around that value. The spread comes from the Randomness slider. The result is clamped, so it's never instant and never frozen.
4. **Extra pauses:**
   - After commas, sentence endings and line breaks (from the sliders).
   - A short pause at the end of each typing burst.
5. **Fatigue** (optional): up to 20% slower over long passages.

## Recipes

**Too robotic (too even):**
- Raise the **Randomness** slider, or raise `MAX_SIGMA` (0.8 → 1.0) to give it more range.
- Stronger letter-pair effects: `BIGRAM_FACTOR` 0.8 → 0.7, `ING_FACTOR` 0.7 → 0.6, `SHIFT_FACTOR` 1.3 → 1.5.
- More noticeable bursts: `BURST_SPEEDUP` 0.88 → 0.8, `BURST_PAUSE_MAX_MS` 420 → 700.
- Pauses that vary more: `PAUSE_SIGMA` 0.35 → 0.5.

**Too slow:**
- Raise the WPM, then shorten the three pause sliders.
- `MAX_KEY_FACTOR` 3.5 → 2.5 (occasional slow keys are less slow).
- `MAX_TOTAL_MS` 6000 → lower (caps the longest single pause).
- Lower `BURST_PAUSE_MIN_MS` / `BURST_PAUSE_MAX_MS`, or turn bursts off.
- With typos on: lower `TYPO_NOTICE_MS` (380) and `BACKSPACE_FACTOR` (0.6).

**Too fast or jittery:** raise `MIN_KEY_MS` (35).

## Typo knobs

| Setting | Default | Meaning |
|---|---|---|
| `TYPO_IMMEDIATE_CHANCE` | 0.6 | Chance a typo is noticed right away. Otherwise it's noticed 1–2 letters later |
| `TYPO_MAX_LAG` | 2 | Most letters typed before the typo is noticed |
| `TYPO_NOTICE_MS` | 380 | Pause before backspacing |

Typos only replace letters, and "noticed late" never crosses a space. That keeps Docs' autocorrect from interfering.

## Icons

The icons are drawn by `tools/make_icons.py` (standard-library Python). Change the colors or shapes at the top of the file, then run:

```bash
python3 tools/make_icons.py
```
