# More Gestures

Opera-style mouse gestures for Omarchy (Hyprland + Quickshell shell): hold the right
button, drag a line, release. See `PLAN.md` for the full plan.

**Status:** step 2 of 6 – the input daemon with direction recognition and JSON events.
There is no plugin (service, actions) and no UI yet.

*Deutsch:* Opera-artige Mausgesten für Omarchy. Stand: Schritt 2 von 6, Eingabe-Daemon mit
Richtungserkennung und JSON-Ereignissen; Service, Aktionen und Oberfläche fehlen noch.

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
- `tests/test_core.py` – unit tests.

## Tests

```
python -m unittest discover -s tests
```
