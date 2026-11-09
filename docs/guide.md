# User guide

Everything Docs Live Typer can do, one feature at a time. New here? Start with [Quick start](../README.md#quick-start).

- [Typing into a doc](#typing-into-a-doc)
- [Speed and settings](#speed-and-settings)
- [Pause, resume and stop](#pause-resume-and-stop)
- [Humanize](#humanize)
- [Timing log](#timing-log)

---

## Typing into a doc

1. Open a Google Doc in edit mode (the address ends in `/edit`). [docs.new](https://docs.new) makes a blank one.
2. Click the extension icon. The side panel opens on the right.
3. Paste your text into the box at the top.
4. Click in the doc where you want the text, then press **Start**. Typing begins right away.

Want a moment to click into the doc after pressing Start? Turn on a countdown under **Settings → Start**.

Text goes wherever the doc's cursor is. Line breaks in your text become real paragraphs.

While typing, Chrome shows a bar that says the extension **"started debugging this browser"**. That's normal: it's how the extension sends real keystrokes. Leave it open. Clicking **Cancel** pauses typing.

Typing runs in the background, so it keeps going if you close the panel or switch to another tab.

The status dot at the top tells you where things stand:

| Status | Meaning |
|---|---|
| **Ready** | The current tab is a Google Doc. You can start. |
| **Not a Google Doc** | Switch to a doc tab first. |
| **Starting in 3** | Only if you turned on a countdown. Click into the doc now. |
| **Typing** / **Paused** | A run is going. |

## Speed and settings

Pick **Slow** (35 WPM), **Normal** (60) or **Fast** (90). For anything else, open **Settings → Custom speed** (10–200 WPM).

Everything else is under **Settings**, grouped:

| Group | Setting | What it does |
|---|---|---|
| Speed | Custom speed | Any WPM from 10 to 200 |
| | Randomness | How much each keystroke's timing varies |
| Pauses | After commas / sentences / line breaks | Extra pause lengths |
| Behavior | Typing bursts | A few quick words, then a short pause |
| | Fatigue | Slows down a little over long text |
| | Typos | Hits a nearby key now and then, then backspaces and fixes it |
| Start | Countdown | Off by default. 1–10 seconds to click into the doc after pressing Start |

**Reset to defaults** puts everything back. Settings are saved automatically.

## Pause, resume and stop

- **Pause / Resume:** the big button, or press **Alt+Shift+P** (Option+Shift+P on a Mac) from any tab.
- **Stop:** ends the run. What's already typed stays in the doc.
- Change the shortcut at `chrome://extensions/shortcuts`.

If a typo is being fixed when you press Pause or Stop, the fix finishes first, so the doc is never left with a mistake.

## Humanize

**Humanize** sits next to **Start**:

1. Paste your text into the box.
2. Press **Humanize**.

The extension puts your text into [humanizeai.pro](https://www.humanizeai.pro/), which stays loaded just below the bottom of the panel, and presses the site's own *Humanize AI* button. When the result is ready it **replaces the text in the box**, and the panel stays at the top. With **Start typing after humanizing** on, typing starts right away. Otherwise check the text and press **Start** yourself.

| Control | What it does |
|---|---|
| **Humanize** | Rewrites the box's text with humanizeai.pro |
| **Start typing after humanizing** | When on, typing starts as soon as the humanized text arrives |
| **Site ↓** | Scrolls down to humanizeai.pro. **Back up ↑** returns to the top |

**First time:** press **Site ↓** and answer the site's cookie popup once.

If something goes wrong, the message under the buttons says what happened. Press **Site ↓** to see what the site itself shows.

**Window** (next to the site) opens humanizeai.pro in its own small window, for example to sign in. **Humanize** only works with the copy in the panel.

The extension doesn't call any hidden API. It uses the normal website, the same way you would.

## Timing log

After every run, finished or stopped, a **Download timing log** link appears under Start. It saves a CSV with one row describing the run:

| Column | Meaning |
|---|---|
| `characters` | Characters in the text |
| `started_at` | When the first keystroke was sent |
| `duration_s` | Total time |
| `paused_s` | Time spent paused |
| `typing_s` | Time actually typing |
| `chars_per_min` | Real typing speed |
| `typos_fixed` | Typos made and corrected |
| `send_errors` | Keystrokes Chrome refused (these pause the run) |
| `avg_keystroke_latency_ms` / `max_keystroke_latency_ms` | How long Chrome took to accept each keystroke. This climbs when Docs gets slow |
| `finished` | `no` if the run was stopped partway |
| `wpm_setting` | The speed setting used |

Only the most recent run's log is kept, so download it before starting the next run.
