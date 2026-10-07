# Changelog

## Unreleased

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
