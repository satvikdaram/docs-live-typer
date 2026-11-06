# Changelog

## Unreleased

- **New look:** a dark navy theme with soft blue and indigo glows, glass cards with gradient blue edges, gradient buttons, sliders, switches and progress, and a gradient title. All text passes WCAG AA contrast. Icons on the panel tabs, a status pill, sliders that fill to the thumb.
- **New icon:** an indigo-to-blue squircle with typed lines and a text cursor, with a simplified 16 px version.
- **Humanizer tab redesign:** paste text into the panel's own box and press **Humanize**. The site, shown at the bottom of the panel, gets your text and the result goes to the Typer. **Hide** collapses the site for a bigger text box.

## 1.1.0

- **Side panel only:** clicking the toolbar icon now opens the side panel (the old popup is gone).
- **Table mode:** separate blocks with `---` and each one is typed into the next table cell.
- **Timing log:** download a CSV per run with speed, pauses, typos and keystroke latency for each cell.
- **Humanize button** in the side panel: presses the site's button and sends the result to the Typer.
- **Add as cell:** build up table cells one block at a time from the Humanizer tab.
- **Cookie popup fix:** humanizeai.pro can remember your cookie choice while embedded in the panel.
- **Simpler layout:** text, speed, Start; everything else lives in a grouped Settings section.
- The Humanizer tab no longer scrolls, and its send bar stays pinned at the bottom.

## 1.0.0

- First version: live typing into Google Docs through the Chrome debugger API, with natural timing (log-normal delays, letter pairs, bursts, punctuation pauses, fatigue, optional typos).
- Pause, resume and stop; Alt+Shift+P shortcut; countdown; settings saved.
- Survives service-worker restarts; handles closed tabs, navigation, DevTools and a cancelled debugging bar.
- Side panel with humanizeai.pro and Send to Typer.
- Automatic light and dark mode.
