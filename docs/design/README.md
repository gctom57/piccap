# PicCap TV UI refresh — design handoff

Redesign of the PicCap frontend (`frontend/index.html`, `frontend/css/app.css`)
for LG webOS TVs, viewed from the couch and driven by the remote.

The source of truth is the Claude Design canvas
<https://claude.ai/code/artifact/829ac4c6-aab0-4260-b0b5-cff4de1df2bf>.
The `*.dc.html` files next to this README are the four artboards exported from
it, with `canvas.json` as the index. They are **mockups, not app code**: they
use Google Fonts, CSS grid and `gap`, none of which the app may use (see
Constraints). Open them in a desktop browser to see the intent; implement
with the rules below.

| Artboard | Shows |
|---|---|
| `Main.dc.html` | Status page: capture state, ambient preview, live metrics, Stop / Restart |
| `Settings.dc.html` | Settings page: Receiver column, Capture + Options column, footer actions |
| `Logs.dc.html` | Logs page: Export / Refresh / Clear, source filters, log list |
| `Components.dc.html` | Buttons, toggles, inputs, selects, nav items, chips, with their focus states |

## Constraints (unchanged from the current app)

- Oldest target is Chrome 38 (webOS 3.x): **flexbox only — no CSS grid, no
  `gap`, no custom properties.** Use margins for spacing and the existing
  theme-block pattern for colours.
- Everything is sized for a fixed 1920 × 1080 screen; keep the 64–72 px safe
  margins (overscan).
- Fonts are bundled, never fetched. The mockups use Sora (UI) and JetBrains
  Mono (values, logs). Both are OFL and available as `@fontsource/sora` and
  `@fontsource/jetbrains-mono`; copy the latin woff2 files next to the
  existing Inter files, or keep Inter for the UI and only add the mono face.
  The app also lists `'LG Smart UI'` as a fallback — keep it.
- Keep every element id, `onclick` handler and `data-state` value that
  `frontend/js/servicecalls.js`, `ui.js` and `test/ui.test.js` rely on. This
  is a restyle plus small markup moves, not a rewrite. Run `npm run
  build-frontend && npm test` before committing.
- Keep the first-start wizard, the Advanced settings panel, the health card
  and the live preview canvas; the mockups only show the main states.

## Tokens

| Token | Midnight (default) | Use |
|---|---|---|
| ground | `#0C0E12` | page background (no gradient wash) |
| rail | `#101319` | sidebar and status bar, 1 px `#1B2029` edge |
| surface | `#12151B` / `#151921` | cards, tiles, log box; 1 px `#1B2029`–`#1E242E` border |
| control | `#1C212B` | inputs, selects, secondary buttons; 1 px `#2A313D` border |
| control-raised | `#2A3140` | switch track (off) |
| text | `#F2F3F5` | primary text |
| text-2 | `#DCE0E6` | row labels, status bar text |
| text-muted | `#8A93A1` | subtitles, section labels, captions |
| text-faint | `#6F7886` | mono labels such as `LAST EVENT` |
| accent | `#F2B544` | primary buttons (ink `#1A1405`), switch on, focus ring, active nav icon |
| ok | `#5CE0A1` on `#0F2A1F` (border `#1E4A36`) | capturing, reachable, tile `ok` |
| warn | `#F2B544` on `#2A2208` (border `#4A3B12`) | starting, waiting, tile `warn`, unsaved changes |
| danger | `#FF8B83` on `#3A1A18` (border `#5A2A28`) | errors, Reboot TV, Restart service |
| info | `#8FB8F5` on `#16243A` | INFO log level |

The three theme swatches stay. Map them to grounds, keeping the same accent:
`theme-blue` → Midnight (above), `theme-dark` → Graphite (ground `#121214`,
rail `#18181B`, surface `#1D1D21`), `theme-black` → Pure black (ground `#000`,
rail `#000`, surface `#0A0A0A`, slightly dimmer text as today). Rename the
swatch labels to Midnight / Graphite / Black; the `lightMode` keys in
`localStorage` can stay `blue` / `dark` / `black`.

## Type

Sora for UI (500 / 600 / 700), JetBrains Mono for anything a user compares
or copies: IPs, ports, resolutions, fps, uptime, versions, log lines.

| Role | Size / weight |
|---|---|
| Page title (`h1`) | 56 px / 700, letter-spacing −0.02em |
| Page subtitle | 22 px / 500, text-muted |
| Section label (`card h2`, tile `.label`) | 17–18 px / 700, uppercase, letter-spacing 0.14em, text-muted |
| Nav item | 26 px / 600 (700 when active) |
| Row label | 25 px / 500 |
| Input / select value | 25 px / 500 mono (selects with text options: 23 px Sora) |
| Button | 26 px / 700 primary, 600 secondary; small buttons 22–23 px |
| Metric value | 46 px mono (fps, resolution), 38 px mono (backends, receiver) |
| Metric caption | 21 px, text-muted |
| Status bar | 20 px; `LAST EVENT` 15 px mono, letter-spacing 0.16em |

Nothing a viewer must read goes under 18 px.

## Layout

**Sidebar** (320 px, rail colour, right edge line): logo tile 56 px with a
soft accent glow, name 30 px + `v0.5.3 · Hyperion` 16 px mono; four nav
items 76 px tall, radius 18, 6 px apart; theme label + three 48 px swatches
at the bottom. Active item: background `#1B2130`, white text, accent-coloured
icon. No left border bars.

**Content**: padding `64px 72px 0 64px`; header = title + subtitle on the
left, a status chip on the right where the page has one.

**Status** (`#service`): header chip `● Capturing` (ok colours, 64 px pill)
with `since 16:26 · 2 h 14 min` under it in mono. Body is a 50 / 50 split
with 48 px between:
- left: the preview, 16:9, radius 24, with a thin LED strip drawn around the
  inner frame (the existing `#previewCanvas` goes inside; the strip can reuse
  the current rainbow animation only while `data-state="running"`), caption
  under it;
- right: metric tiles in two columns — Frame rate, Resolution, Video
  backend, UI backend, then Receiver spanning both columns with a
  `● Reachable` chip. Map to the existing `#txtInfoFPS`, `#txtInfoVideo`,
  `#txtInfoUI`, `#txtInfoReceiver`, and `data-state` ok / warn / off.
Actions: `Stop capture` primary, `Restart service` secondary. The existing
Start / Stop / Reload trio can stay as is if preferred — the mockup shows the
running state, where Start is disabled. The health card keeps its place
below when the service reports health data.

**Settings** (`#settings`): two columns, 40 px apart. Left: Receiver card
(Local socket, Address, Port, Priority, then a row with the test result on
the left and `Test connection` on the right). Right: Capture card
(Resolution, Max FPS, Video backend, UI backend) above an Options card whose
three switches become tiles in a row (label + switch + one-line hint:
*Start capturing when the TV turns on*, *Wait for the panel refresh before
grabbing*, *Send NV12 frames instead of RGB*). Rows are 72 px tall with 1 px
hairlines; controls are 300 × 54 px, radius 12, right-aligned. An
`Unsaved changes` chip (warn colours) shows in the header once a field
differs from the loaded settings. Footer: Save (primary), Reset, Advanced ›,
spacer, Reboot TV (danger, outline only).

**Logs** (`#logs`): header actions on the right — `Export logs` primary with
a download icon, `Refresh`, `Clear`. A filter row under the header
(All / Service / Capture / Network pills, selected one in accent) and a
`Warnings only` switch on the right. The current PicCap / hyperion-webos
segmented control and `Setup logging` / `Load last 200` must stay
reachable: either keep the segmented control in the filter row, or fold the
two sources into the filters (`PicCap`, `Service`). Log lines are 54 px:
time (mono, muted), level chip (INFO / WARN / ERROR), source, message in
mono; the box keeps its fixed height and scrolls.

**Status bar**: 72 px, top hairline, `LAST EVENT` mono label + message,
time on the right.

## Components and focus (see `Components.dc.html`)

- One focus style for every control: `box-shadow: 0 0 0 4px <accent>,
  0 0 0 10px rgba(242,181,68,0.32)`; no `transform: scale`. Apply it to
  `.btn`, `.nav-item`, `.swatch`, `.segmented button`, `input`, `select`,
  `input.switch` on `:focus`. The Magic Remote pointer hover may share it.
- Buttons 72 px tall (60 px small), radius 18 (15 small), padding 0 36 px.
  Primary: accent fill, dark ink, no border. Secondary: control fill, 1 px
  border. Danger: transparent, 1 px `#5A2A28` border, `#FF8B83` text.
  Disabled: surface fill, `#5B6470` text, opacity 1 (not 0.4) so it stays
  readable at a distance.
- Switch: 72 × 40 track, 32 px knob; off track `#2A3140` + knob `#C9D0DB`,
  on track accent + knob `#1A1405`.
- Select chevron: `#8A93A1`, 22 px, 14 px from the right edge.
- Chips: 44–52 px pills, 10 px dot, bold 19–22 px text, tinted background
  and border from the ok / warn / danger / neutral pairs above.
- Minimum target 44 px in both axes; nothing relies on hover alone.
