# User guide

Everything Docs Live Typer can do, one feature at a time. New here? Start with [Quick start](../README.md#quick-start).

- [Typing into a doc](#typing-into-a-doc)
- [Speed and settings](#speed-and-settings)
- [Pause, resume and stop](#pause-resume-and-stop)
- [Filling a table](#filling-a-table)
- [The Humanizer tab](#the-humanizer-tab)
- [Timing log](#timing-log)

---

## Typing into a doc

1. Open a Google Doc in edit mode (the address ends in `/edit`). [docs.new](https://docs.new) makes a blank one.
2. Click the extension icon. The side panel opens on the right.
3. Go to the **Typer** tab and paste your text.
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

## Filling a table

Put a line containing only `---` between blocks. Each block goes into the next table cell.

```
Name
---
Role
---
Ada Lovelace
---
Wrote the first published algorithm.
```

The Typer shows **Table mode · 4 cells**. Then:

1. Insert a table in the doc (**Insert → Table**) and click into the **first cell**.
2. Press **Start**.

How it behaves:

- After each block it presses **Tab** to move to the next cell (left to right, then down a row).
- No Tab after the last block, so Docs won't add an extra row.
- An **empty block** skips a cell.
- Line breaks inside a block stay inside that cell.
- Progress shows **Cell 2 of 4**.

## The Humanizer tab

The panel's first tab is a text box with a **Humanize** button:

1. Paste your text into the box.
2. Press **Humanize**.

The extension puts your text into [humanizeai.pro](https://www.humanizeai.pro/), which stays loaded just below the bottom of the panel, and presses the site's own *Humanize AI* button. When the result is ready it goes to the Typer. With **Start typing automatically** on, typing starts right away. Each press handles one block of text.

| Control | What it does |
|---|---|
| **Humanize** | Sends the box's text through humanizeai.pro, then to the Typer |
| **Add as cell** | Adds the box's text, as it is, as the next table cell. You stay on this tab |
| **Send to Typer** | Replaces the Typer's text with the box's text, as it is |
| **Start typing automatically** | When on, text sent to the Typer starts typing |
| **Site ↓** | Scrolls down to humanizeai.pro, which sits just below the visible area. Scroll back up to return |

**First time:** click **Site ↓** and answer the site's cookie popup once. If something goes wrong, the panel scrolls down to the site for you so you can see what it says.

**Window** opens the site in its own small window, for example to sign in. The **Humanize** button only works with the copy inside the panel.

The extension doesn't call any hidden API. It uses the normal website, the same way you would.

## Timing log

After every run, finished or stopped, a **Download timing log** link appears under Start. It saves a CSV with one row per cell (a normal run is one row):

| Column | Meaning |
|---|---|
| `cell` | Cell number (1 for a normal run) |
| `characters` | Characters in that cell |
| `started_at` | When the cell's first keystroke was sent |
| `duration_s` | Total time on the cell |
| `paused_s` | Time spent paused |
| `typing_s` | Time actually typing |
| `chars_per_min` | Real typing speed for the cell |
| `typos_fixed` | Typos made and corrected |
| `send_errors` | Keystrokes Chrome refused (these pause the run) |
| `avg_keystroke_latency_ms` / `max_keystroke_latency_ms` | How long Chrome took to accept each keystroke. This climbs when Docs gets slow |
| `finished` | `no` if the run stopped partway through that cell |

Only the most recent run's log is kept, so download it before starting the next run.
