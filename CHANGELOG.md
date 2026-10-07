# Changelog

## Unreleased

### Added (corner taps)
- Corner taps on the trackpad (`lib/tap_core.py`, opt-in "Corner taps (experimental)"):
  the daemon grabs the touchpad, forwards every frame through a uinput clone and holds
  back only touches that start in a bound corner. Double tap top-left/top-right/
  bottom-left/bottom-right = workspaces 1-4, triple tap = 5-8 (gesture keys `tap:tl2`
  etc.). Unbound counts are replayed as normal taps; ABS_MT_SLOT is re-sent where a
  swallowed frame changed it. Workspace actions 1-10.

### Changed
- Trackpad shapes are easier to draw: 8 mm per segment (was 12) and a more lenient
  direction test (0.9 instead of the mouse's 0.7).
- 4 fingers down toggles the scratchpad (like Super+S) instead of "show desktop", which
  stays available as an action.

### Added (step 4b, trackpad)
- Trackpad gestures with 3 or 4 fingers (`lib/touchpad_core.py`): the daemon reads
  touchpads passively (no grab), counts fingers, measures in mm, recognises lines, shapes
  and pinch in/out. Gesture keys `tp3:`/`tp4:` per gesture, falling back to `*:`.
- Hyprland's workspace swipe (follows the fingers) stays native: the plugin writes
  `~/.local/state/omarchy/settings/more-gestures-hypr.lua`, which `input.lua` loads with
  `dofile`; the daemon ignores left/right for those finger counts.
- Actions "Show desktop" (windows of the workspace to a hidden special workspace and
  back), "Exposé" (expose.window-overview plugin) and "Hyprexpo" (with a notice when the
  hyprpm plugin is not loaded). Trackpad defaults: 4 fingers up Exposé, down show desktop,
  pinch in apps menu, pinch out Hyprexpo.
- Settings: trackpad section (on/off, finger counts, native swipe per count, segment
  length in mm, Exposé plugin tip), device choice and pinch buttons in the editor.

### Added (step 5, mouse only)
- `Settings.qml`: settings overlay (`omarchy-shell shell toggle more-gestures`, IPC
  `more-gestures settings`). On/off, trigger button, threshold, hold time, rocker, wheel,
  indicator, animations; gesture → action per profile (desktop, browser, terminal) with
  arrow buttons, desktop actions, key combinations (record or type, up to 4 steps), command
  or nothing; exclusion list. Writes only on Save; the service applies the file live.
- `Config.js` (settings contract, sanitising, binding edits), `Keys.js` (Qt key events and
  typed text → xkb combos), `I18n.js` (English/German).
- App icon: a schematic mouse (square split by a cross without its lower arm).
  `bin/app-icon` renders it in the theme's colors, `bin/install-app-entry` adds a launcher
  entry and a theme-set hook that recolors it (`--remove` undoes all three).
  `MouseGlyph.qml` draws the same symbol in the settings header.

### Changed
- The trail starts on the ring's outer edge and ends in an arrowhead; the ring uses the
  trail's stroke width (`Trail.js`).

### Added (step 4)
- `GestureOverlay.qml`: real gesture line drawn from hover positions of a transparent
  full-screen layer-shell surface on the monitor under the pointer, plus an indicator (ring,
  segment arrows, growing current segment, action name, check mark on trigger). The input
  surface is unmapped the moment the gesture ends; only the visual surface fades (≤ 150 ms).
  Safety nets: 10 s timeout, close on daemon exit/restart.
- Settings `indicator` (`off`/`minimal`/`full`, default `full`) and `animations` (default
  `true`) in the state file.
- `Actions.js`: `arrowFor`/`arrowList`/`arrowText`, `preview` (action name + validity for the
  indicator), `normalizeIndicator`, `parseCursorPos`; tests for all of them.
- `Service.qml` forwards `start`, `segment`, `progress`, `end`, `cancel` to the overlay.

### Added (step 3)
- `manifest.json` (id `more-gestures`, service + overlay, `keepLoaded`), `Settings.qml` placeholder.
- `Actions.js`: profiles from window tags, gesture keys with source (`mouse:`, `tp3:`, `tp4:`,
  fallback `*:`), default bindings, action types `dispatch`/`keys`/`exec`/`none`, key
  combinations and sequences up to 4, strict validation (modifier allow-list, key regex),
  Lua generation for `hyprctl eval` from validated parts only, German/English action names,
  exclusion matching.
- `Service.qml`: daemon via `Process` with backoff restart, JSON line parsing, active window
  with class and tags, `pass on|off` from the exclusion list, action execution, state file
  reading, `IpcHandler` `more-gestures` (`enable`, `disable`, `toggle`, `status`).
- `tests/actions.test.mjs` including injection attempts.

### Added (step 2)
- Direction recognition (`Recognizer`, source-neutral, threshold as a parameter): segments
  U/D/L/R, equal directions merged, at most 4, tolerant of diagonal and jittery movement.
- JSON events `start`, `segment {dirs}`, `progress {dir, ratio}` (≤ 30 Hz),
  `end {source, gesture}`, `cancel`.
- Trigger + wheel → `wheel {dir}` (wheel not forwarded); rocker gestures
  `rocker {side}`, switchable (`--rocker`, `config`).
- stdin commands `pass on|off` and `config {json}` (threshold, hold time, rocker).
- Motion is evaluated per input packet, so REL_X/REL_Y of one frame count as one step.

### Changed (step 2)
- Replaces the interim `gesture-candidate` message.
- Pointing sticks (TrackPoint) are no longer grabbed by default: through the uinput clone,
  middle-button scrolling stopped working. `--include-pointing-sticks` grabs them anyway.
- Rocker gestures are off by default (`--rocker`): marking with the left button and then
  right-clicking should still open the context menu.

### Added
- `bin/gesture-daemon`: device detection (REL_X/REL_Y + trigger button, no ABS_MT, own
  uinput device excluded by name, hotplug rescan every 2 s), exclusive grab, 1:1
  forwarding via `UInput.from_device`.
- Trigger button is held back and replayed as a click on release, or after 350 ms hold.
- Passive modifier reading (Super/Alt/Ctrl/Shift only) with immediate pass-through.
- Movement beyond the threshold discards the press.
- Emergency brake after 10 s, clean ungrab on SIGTERM/SIGINT/stdin EOF, `--dry-run`.
- `lib/gesture_core.py`: evdev-free decision logic with unit tests.
