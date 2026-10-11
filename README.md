# More Gestures

Opera-style mouse gestures for Omarchy (Hyprland + Quickshell shell): hold the right
button, drag a line, release. See `PLAN.md` for the full plan.

Also: three- and four-finger trackpad gestures, corner taps, a ring menu with up to three
rings, a menu bar icon and a settings window.

*Deutsch:* Opera-artige Mausgesten für Omarchy, dazu Trackpad-Gesten mit drei und vier
Fingern, Ecken-Tippen, ein Kreismenü mit bis zu drei Ringen, ein Menüleisten-Symbol und
ein Einstellungsfenster.

## Settings (`Settings.qml`)

Open with `omarchy-shell shell toggle more-gestures`, `qs ipc -p /usr/share/omarchy/shell
call more-gestures settings`, a left click on the menu bar icon, or the launcher entry
"More Gestures" (General › "Show in app launcher", or `bin/install-app-entry`; `--remove`
takes it away). Every change is saved at once, as in More Time and More Weather (no Save
button), to `~/.local/state/omarchy/settings/more-gestures.json`, and applied live: a new
trigger button restarts the daemon, everything else applies at once.

General › "Back up and restore" exports all settings to one JSON file (default
`~/Downloads/more-gestures-settings.json`) and imports one; the import asks once more
("Replace settings?") and first saves the current settings to
`~/.local/state/omarchy/settings/more-gestures-settings-backup.json`. Importing that backup
undoes the import.

The interface language is set under General › Language: Automatic (the system locale),
English or Deutsch, like in More Time and More Weather; it covers the settings, the ring,
the indicator, the menu bar tooltip and the notifications.

Pages, laid out like the settings of More Time and More Weather (Tab / Shift+Tab switch
them, Esc closes, PageUp/PageDown and the arrows scroll; the wheel scrolls a fixed step per
notch and touchpads 2.5 × their delta, the same speed as there):

| Page | What is there |
|---|---|
| General | language, gestures on/off, indicator and animations, menu bar icon, app launcher entry, exclusions, back up and restore |
| Mouse | trigger button, threshold, hold time, rocker, wheel, and the mouse gestures |
| Trackpad | 3 / 4 fingers, segment length, corner taps, and the trackpad gestures (the Hyprland swipe among them) |
| Ring menu | on/off, double click time, keyboard shortcut, the three rings with slots and keys |
| What's new | this `CHANGELOG.md`, read from the plugin folder (nothing is fetched) |

The gesture list shows on the Mouse and on the Trackpad page: shared shapes (device
"All") on both, since mouse and three fingers speak one gesture language, plus the rows
only that device has (wheel and rocker on Mouse; 3/4 fingers, pinches and corner taps
on Trackpad).

Per profile, the list shows only entries that differ from the defaults plus the defaults
of that profile. "Remove" on a built-in gesture stores `none` for it (switched off),
"Reset" restores the built-in action. Key combinations can be recorded (press them) or
typed (`Ctrl+Shift+T`, `Strg+Umschalt+T`); up to 4 are sent one after another.

New gestures: build the shape with the arrow buttons, or press **Record** and make the
gesture (mouse line, trigger + wheel, rocker, 3 or 4 fingers, corner tap). The service
hands the next gesture to the editor instead of running it (IPC `recordGesture` /
`stopRecording`, result in `$XDG_RUNTIME_DIR/more-gestures-recorded.json`); Esc or 15 s
without a gesture stop. A line drawn with the mouse or three fingers keeps the device
"All" if chosen; anything else takes its device. If the gesture is already bound, the
editor says with what.

## Menu bar icon

The inverted mouse symbol sits in the bar (right section), faded while gestures are off.
Left click opens the settings, middle click switches gestures on/off (saved), right
click shows a status notification; set each button (or hide the icon) under "Menu bar"
in the settings. Over IPC: `omarchy-shell more-gestures toggleSaved | openRing | notifyStatus`.

## Ring menu

Double click the trigger and keep the second press held: a clock face of slots appears
around the pointer. Default ring 1: Exposé at 12 o'clock, workspaces 1-5 at 1-5,
wallpaper at 6, workspaces 6-9 and 0 (= 10) at 7-11. Move towards a slot and release to
run it; release in the middle to cancel. Released without leaving the middle, the ring
stays open: click a slot (left or right button), or anywhere else to close it.
A workspace slot always shows that workspace's windows: it closes an open Exposé and
brings back windows the wallpaper layer had hidden, also on the workspace you are on.

Other ways in, both open the ring to stay:
- the trackpad: double tap with 4 fingers;
- the keyboard: **Super+Alt+R** by default (settings: "Open the ring with", empty = none).
  The plugin binds it in its generated Hyprland file (see Trackpad), with the description
  "More Gestures: ring menu".

**Up to three rings.** Ring 1 is always there; rings 2 and 3 are switched on in the
settings and sit further out (drag further to reach them: the distance picks the ring,
the direction the slot). Slots per ring: 8, 12 or 16 for ring 1, 8, 12, 16 or 24 for
rings 2 and 3. All rings start at 12 o'clock, so with equal counts a slot sits straight
outside the one before it. Soft dividing lines between the rings and their slots can be
switched off ("Dividing lines").
By default ring 2 moves the window under the pointer (where the ring was opened) to a
workspace without following it: each slot sits straight outside its workspace on ring 1
and shows an arrow into a small monitor with the number. Ring 3 holds close window (q),
fullscreen (f), floating (s), window to workspace left/right (a/d), scratchpad (n),
terminal (t), Files (o), app launcher (l) and Hyprexpo (x). Every slot can hold any
action, workspaces included; outer
rings show short names, the full name of the slot under the pointer appears in the
middle. Rings that do not fit the screen are drawn smaller.

**Keys** while the ring is open: Esc closes; every slot can have one key (letter or
digit, upper case = Shift+letter), shown in the slot's corner unless the label already
says it. Defaults: 1-0 workspaces, e Exposé, w wallpaper, ring 3 as above; ring 2 has no keys
(1-0 belong to ring 1), set them in the settings if you like. A key used
twice keeps its first slot (inner ring first).

Workspaces 1-5 always look normal, 6-0 are faded unless a window is on them; the current
one is outlined. The mouse way in is opt-in ("Ring menu" in the settings): the daemon holds
the first click back for the double click time, so every ordinary click of the trigger
arrives that much later.

Settings file: `ring = { enabled, doubleMs, hotkey: {mods, key} | null, rings: [{ enabled,
count, slots, keys }, …] }`. The single-ring form (`slots`, `keys`) of older versions is
read as ring 1.

## Trackpad

Touchpads are read, never grabbed: libinput and Hyprland keep every event, so scrolling,
tapping and Hyprland's own gestures keep working. With 3 or 4 fingers the daemon
recognises lines and shapes (segment length in mm) and pinch in/out; a gesture ends when
the fingers lift. Bindings use `tp3:` / `tp4:` per gesture and fall back to the shared
`*:` entries.

Hyprland's workspace swipe follows the fingers, which a gesture recogniser cannot do, so
it stays native. It is a gesture like the others: "← → swipe" with 3 or 4 fingers
(`tp3:swipe` / `tp4:swipe`, Desktop profile), whose effect is either "Swipe workspaces
(Hyprland)" or nothing (default: 4 fingers swipe, 3 fingers nothing). While it swipes,
left and right with those fingers are Hyprland's. The plugin writes the `hl.gesture` lines for it into
`~/.local/state/omarchy/settings/more-gestures-hypr.lua` (only when they change, then
`hyprctl reload`). Load that file from `~/.config/hypr/input.lua`:

```lua
local more_gestures = os.getenv("HOME") .. "/.local/state/omarchy/settings/more-gestures-hypr.lua"
local more_gestures_file = io.open(more_gestures, "r")
if more_gestures_file then
  more_gestures_file:close()
  dofile(more_gestures)
end
```

Remove other `hl.gesture` lines for the finger counts the plugin reads, or both act.

Four fingers up/down are layers by default; the opposite swipe undoes the last step:

| Open now | 4 fingers down | 4 fingers up |
|---|---|---|
| nothing | wallpaper | Exposé |
| Exposé | close Exposé | app launcher |
| app launcher | close launcher | – |
| wallpaper | Files (floating, centred) | windows back |
| wallpaper + Files | – | close Files |
For the "Exposé" action install the `expose.window-overview` plugin.

### Corner taps (opt-in)

With "Corner taps (experimental)" on, the touchpad is grabbed like the mouse and forwarded
through a uinput clone. Only touches that start in a corner with a bound tap gesture are
held back (up to the tap time, 180 ms) and counted; double tap top-left/top-right/
bottom-left/bottom-right = workspaces 1-4, triple tap = 5-8 (`tap:tl2` …). Counts without
an action are replayed, so a single tap in a corner still clicks, a moment later.
Our own clones are never grabbed (they are recognised by name).

## Overlay (`GestureOverlay.qml`)

Created by `Service.qml`; lives only while a gesture runs.

- On `start` it asks `hyprctl cursorpos -j` (read-only) for the pointer, picks the screen
  containing it (fallback: focused monitor) and maps two full-screen layer-shell surfaces
  (layer Overlay, namespace `more-gestures`, no keyboard, no exclusive zone):
  - an **input surface**, transparent, with `MouseArea { hoverEnabled }`. The daemon holds the
    trigger press back, so no application has seen a button-down and there is no implicit
    pointer grab: the surface receives the exact pointer positions. They become the line
    (accent colour, ≥ 3 px, round caps and joins);
  - a **visual surface** with an empty input region that draws line and indicator.
- Indicator at the start point: a ring, below it a card with the recognized segments as arrows
  (`full` only), the segment under way growing with `progress` events, and the name of the
  action that releasing now would run (for `keys` actions without a label the combination,
  e.g. `Ctrl+Shift+T` / `Strg+Umschalt+T`). Colours: neutral until the first segment, accent
  for a bound gesture, dimmed with `—` for an unknown one. When the action fires the ring
  shows a check mark while fading out. Trackpad gestures show the finger count in the ring.
- On `end`/`cancel` the input surface is unmapped at once, so the next click reaches the
  application; only the visual surface fades out (≤ 150 ms). Safety nets: everything closes
  after 10 s at the latest, and when the daemon exits or restarts.
- Settings in `~/.local/state/omarchy/settings/more-gestures.json`:
  - `indicator`: `"off"` (no overlay at all), `"minimal"` (line, ring, action name) or
    `"full"` (default; adds arrows and the growing segment). Anything else means `full`.
  - `animations`: `false` replaces every fade/grow animation by a cut (default `true`).

## Plugin (`manifest.json`, `Service.qml`, `Actions.js`)

Plugin id `more-gestures`, kinds `service` + `overlay`, `keepLoaded`. The service:

- starts `bin/gesture-daemon` relative to the plugin directory (`python3`, trigger button,
  threshold, hold time and rocker as arguments) and reads its JSON lines; the daemon only
  ever lives as a child of the shell (stdin is its leash). A crashed daemon is restarted
  with 1, 2, 4 … 30 s backoff; ten seconds of uptime reset it,
- tracks the active window (`hyprctl activewindow -j`, read-only, refreshed on Hyprland
  focus events and on gesture start) with class and tags, and sends `pass on|off` when
  class or tag is on the exclusion list (default: `steam_app_*`, `retroarch`, `qemu*`,
  `virt-manager`, `gamescope`; a trailing `*` is a prefix match),
- on `end`, `wheel` and `rocker` calls `Actions.resolve` and runs the result,
- reads `~/.local/state/omarchy/settings/more-gestures.json` (watched; broken JSON gives
  defaults): `enabled`, `button`, `threshold`, `holdMs`, `rocker`, `indicator`, `animations`,
  `exclude`, `bindings`.
  Nothing writes it yet (step 5),
- offers `qs ipc call more-gestures enable|disable|toggle|status`. `enable`/`disable` are
  runtime only; `status` returns JSON (daemon state, active window and profiles, last
  gesture and action).

### Actions

| Type | Fields | Runs |
|---|---|---|
| `dispatch` | `id` from a fixed table (`workspace-prev`, `window-close`, …) | `hyprctl eval 'hl.dispatch(hl.dsp…)'` |
| `keys` | `combo: ["CTRL SHIFT", "T"]`, optional `sequence` of up to 4 combos, `label` | `hyprctl eval` with `hl.dsp.send_key_state` down, 50 ms later up (as `clipboard.lua`); sequence steps 80 ms apart |
| `exec` | `command`, `label` | `bash -lc command` (runs arbitrary code by design, like hotcorners) |
| `none` | | nothing; in a profile it also blocks inheriting the desktop binding |

Lua text is built only from fixed strings and validated parts: modifiers from the allow-list
`SUPER CTRL ALT SHIFT`, keys against `^[A-Za-z0-9_]{1,32}$`. Invalid actions are rejected as a
whole, so a hand-edited settings file cannot inject Lua. Not offered: a target window for
`keys` – `send_key_state` has no documented window parameter in the Hyprland stubs.

Gesture keys are `<source>:<gesture>`, source `mouse`, `tp3`, `tp4` or `*` (all);
gestures are `U D L R` (up to 5 strokes) plus `wheel-up`, `wheel-down`, `rocker-left`, `rocker-right`.
Profiles come from window tags (`chromium-based-browser`/`firefox-based-browser` → `browser`,
`terminal` → `terminal`), the first match wins, `default` is last. Lookup order: profile
before `default`; within a profile `<source>:G` before `*:G`. User `bindings`
(`{ "browser": { "*:DR": {…} } }`) are layered over the defaults entry by entry.

### Gesture language (defaults)

One language for every device and program: the mouse (trigger + movement) and three
fingers share every shape (`*:` entries), and a shape does the same thing everywhere.
Four fingers are the system level.

| Shape | Action |
|---|---|
| ← / → | back / forward (Alt+Left / Alt+Right, as in the browser) |
| ↑ | layer up: Exposé, then app launcher; closes Files / brings the windows back |
| ↓ | layer down: wallpaper, then Files; closes launcher / Exposé |
| ↑← / ↑→ | workspace left / right |
| ↓→ | close tab (Ctrl+W) |
| ↓← | close window (Super+W) |
| ↓←↑ / ↓→↑ | move window to workspace left / right |
| ↓↑ | new tab (Ctrl+T) |
| ←↑ | reopen closed tab (Ctrl+Shift+T) |
| ↑↓ | reload (F5) |
| →↑ | toggle fullscreen |
| wheel | workspace left / right (browser: Ctrl+Shift+Tab / Ctrl+Tab) |
| rocker left / right | back / forward |
| double click, hold | ring menu |

Four fingers: left/right is Hyprland's own workspace swipe, up/down the same layers,
pinch in = app launcher, pinch out = Hyprexpo, double tap = ring menu.
Profiles only differ where a program needs it: in the browser the wheel switches tabs;
in a terminal ↓→ sends Ctrl+Shift+W (Ctrl+W would delete a word in the shell).
Everything can be changed in the settings, and new shapes (up to 5 strokes, per device
if wanted) can be added; "All gestures to default" removes every change.

Action names are available in German and English (`Actions.actionName(action, lang)`).

## Daemon (`bin/gesture-daemon`)

- Finds pointing devices: `REL_X`/`REL_Y` plus the trigger button, no `ABS_MT`
  (touchpads are left alone). Hotplug is handled by rescanning `/dev/input` every 2 s.
- Grabs each one exclusively and forwards everything 1:1 through a `uinput` clone
  (`UInput.from_device`). The clone is named `more-gestures virtual (...)` and is
  excluded by that name so the daemon never grabs itself.
- The trigger button (default: right) is held back on press:
  - released without moving → replayed as a normal click,
  - held longer than 350 ms without moving → press replayed (so "hold right, drag in
    a context menu" keeps working),
  - moved beyond the threshold (default 20 units) → press discarded, gesture recognition
    runs (see below).
- Modifiers: keyboards are only read passively (never grabbed) and only
  Super/Alt/Ctrl/Shift are evaluated, every other key is dropped immediately. While a
  modifier is down the press is passed through at once, so Super+right-drag still
  resizes windows.
- Emergency brake: a gesture held for more than 10 s is reset (`cancel`).
- Clean shutdown: SIGTERM, SIGINT and EOF on stdin release the grab and exit. If the
  process dies in any other way the kernel releases the grab.

## Recognition

Directions are `U`, `D`, `L`, `R`. The recognizer (`Recognizer` in `lib/gesture_core.py`) is
source-neutral: its input is deltas in any unit and the threshold is a parameter (raw mouse
units now, mm for the trackpad in step 4b).

- A segment is created once one direction exceeds the threshold and clearly dominates
  (the other axis ≤ 0.7×). A pure diagonal stays undecided instead of flipping between
  two directions; the first straight stretch resolves it.
- Equal directions in a row are merged, at most 4 segments (`"DR"`, `"RDLU"`).
- Jitter: the anchor follows the furthest point along the current direction, so a
  reversal needs the full threshold from the extreme point, and a slightly slanted line
  does not grow into a second segment.
- A drag that crosses the threshold but never forms a segment (diagonal, zigzag) ends in
  `cancel`; the press is still discarded.

## Protocol

stdout, one JSON object per line. Gesture events carry `"source":"mouse"`:

| Line | Meaning |
|---|---|
| `{"type":"start","source":"mouse"}` | threshold crossed, press discarded |
| `{"type":"segment","source":"mouse","dirs":"DR"}` | segments so far (cumulative) |
| `{"type":"progress","source":"mouse","dir":"R","ratio":0.4}` | next segment grows toward the threshold; at most 30 Hz, never for the direction already running |
| `{"type":"end","source":"mouse","gesture":"DR"}` | trigger released with ≥ 1 segment |
| `{"type":"cancel","source":"mouse"}` | no segment recognized, emergency brake, or wheel/rocker took over |
| `{"type":"wheel","dir":"up"}` / `"down"` | wheel step while the trigger is held; the wheel is **not** forwarded |
| `{"type":"rocker","side":"left"}` | trigger held, left button clicked |
| `{"type":"rocker","side":"right"}` | left held, trigger clicked |

Wheel and rocker replace the line gesture: if a path was already running it is cancelled
first, and the press is discarded (no right click). Once the press has been replayed
(held > 350 ms, i.e. a context menu is open) wheel and left clicks go to the application.
Rocker gestures are off by default; switch them on with `--rocker` or `config`. Both are ignored while a
modifier is down or `pass on` is active.

stdin, one command per line:

- `pass on|off` – forward everything untouched (for games, VMs). A held-back press is
  replayed at once; a running gesture finishes normally.
- `config {json}` – `threshold` (1–5000 units), `hold_ms` (0–5000), `rocker` (bool). Applies
  immediately to all devices; invalid entries are skipped and logged to stderr. The
  trigger button is not configurable at runtime: restart the daemon with `--button`.

```
bin/gesture-daemon --dry-run          # grabs nothing, prints devices and state changes
bin/gesture-daemon [--button right|middle|side|extra] [--threshold N] [--hold-ms N] [--emergency-s N] [--rocker] [--include-pointing-sticks]
```

`--dry-run` still opens the devices for reading (needed to observe the state changes)
but never grabs them or creates a `uinput` device. Note that stdin is watched: when it
is closed (e.g. `< /dev/null`) the daemon exits, that is how the shell stops it.

## Layout

- `lib/gesture_core.py` – decision logic (state machine, direction recognizer, command
  parsing, device classification), no evdev dependency.
- `bin/gesture-daemon` – thin evdev/uinput wrapper.
- `manifest.json`, `Service.qml`, `Settings.qml`, `BarWidget.qml` – the Omarchy plugin.
- `SettingsTransfer.qml` – export, import and the backup before an import.
- `ChangesPage.qml`, `Changelog.js` – Settings › What's new; `Changelog.js` is the parser
  More Time and More Weather share, kept byte-identical (`tests/changelog.test.mjs`).
- `GestureOverlay.qml` – line and indicator, instantiated by `Service.qml`.
- `Actions.js` – pure functions: profiles, gesture keys, defaults, validation, Lua building,
  indicator helpers (arrows, preview name, cursor position parsing).
- `tests/test_core.py`, `tests/actions.test.mjs` – unit tests.

## Tests

```
python -m unittest discover -s tests
mise x node@24.21.0 -- node --test tests/*.test.mjs
tests/qml-syntax.sh
```
