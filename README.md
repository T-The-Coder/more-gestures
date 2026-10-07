# More Gestures

Opera-style mouse gestures for Omarchy (Hyprland + Quickshell shell): hold the right
button, drag a line, release. See `PLAN.md` for the full plan.

**Status:** step 4 of 6 – daemon, direction recognition, plugin service, actions with the
default bindings, and the gesture overlay (real line + indicator). No settings UI yet
(`Settings.qml` is a placeholder; the `indicator` and `animations` options are edited in the
state file for now).

*Deutsch:* Opera-artige Mausgesten für Omarchy. Stand: Schritt 4 von 6, Daemon, Erkennung,
Plugin-Service, Aktionen mit Standardbelegung und Overlay (echte Linie + Indikator);
Einstellungsoberfläche fehlt noch (`Settings.qml` ist ein Platzhalter, `indicator` und
`animations` stehen vorerst nur in der Zustandsdatei).

## Settings (`Settings.qml`)

Open with `omarchy-shell shell toggle more-gestures`, `qs ipc -p /usr/share/omarchy/shell
call more-gestures settings`, or the launcher entry "More Gestures" (install it once with
`bin/install-app-entry`; `bin/install-app-entry --remove` takes it away). Changes are
written to `~/.local/state/omarchy/settings/more-gestures.json` on Save and applied live:
a new trigger button restarts the daemon, everything else applies at once.

Per profile, the list shows only entries that differ from the defaults plus the defaults
of that profile. "Remove" on a built-in gesture stores `none` for it (switched off),
"Reset" restores the built-in action. Key combinations can be recorded (press them) or
typed (`Ctrl+Shift+T`, `Strg+Umschalt+T`); up to 4 are sent one after another.

## Trackpad

Touchpads are read, never grabbed: libinput and Hyprland keep every event, so scrolling,
tapping and Hyprland's own gestures keep working. With 3 or 4 fingers the daemon
recognises lines and shapes (segment length in mm) and pinch in/out; a gesture ends when
the fingers lift. Bindings use `tp3:` / `tp4:` per gesture and fall back to the shared
`*:` entries.

Hyprland's workspace swipe follows the fingers, which a gesture recogniser cannot do, so
it stays native. The plugin writes the `hl.gesture` lines for it into
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
For the "Exposé" action install the `expose.window-overview` plugin.

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
gestures are `U D L R` (up to 4) plus `wheel-up`, `wheel-down`, `rocker-left`, `rocker-right`.
Profiles come from window tags (`chromium-based-browser`/`firefox-based-browser` → `browser`,
`terminal` → `terminal`), the first match wins, `default` is last. Lookup order: profile
before `default`; within a profile `<source>:G` before `*:G`. User `bindings`
(`{ "browser": { "*:DR": {…} } }`) are layered over the defaults entry by entry.

Defaults (desktop / browser; the browser inherits what it does not set):

| Gesture | Desktop | Browser |
|---|---|---|
| L / R | workspace left / right | Alt+Left / Alt+Right |
| U | app launcher | inherits |
| D | new terminal | Ctrl+T |
| DR | close window | Ctrl+W |
| UD | – | F5 |
| LU | – | Ctrl+Shift+T |
| DU | toggle floating | duplicate tab (Ctrl+L, Alt+Enter) |
| RU | toggle fullscreen | inherits |
| UL / UR | move window to workspace left / right | inherits |
| wheel | workspace left / right | Ctrl+Shift+Tab / Ctrl+Tab |
| rocker left / right | like L / R | Alt+Left / Alt+Right |

Terminal: only DR is set (close window, never Ctrl+W); everything else inherits.
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
- `manifest.json`, `Service.qml`, `Settings.qml` (placeholder) – the Omarchy plugin.
- `GestureOverlay.qml` – line and indicator, instantiated by `Service.qml`.
- `Actions.js` – pure functions: profiles, gesture keys, defaults, validation, Lua building,
  indicator helpers (arrows, preview name, cursor position parsing).
- `tests/test_core.py`, `tests/actions.test.mjs` – unit tests.

## Tests

```
python -m unittest discover -s tests
mise x node@24.21.0 -- node --test tests/*.test.mjs
```
