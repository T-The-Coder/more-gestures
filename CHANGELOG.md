# Changelog

## Unreleased

### Added
- `bin/gesture-daemon`: device detection (REL_X/REL_Y + trigger button, no ABS_MT, own
  uinput device excluded by name, hotplug rescan every 2 s), exclusive grab, 1:1
  forwarding via `UInput.from_device`.
- Trigger button is held back and replayed as a click on release, or after 350 ms hold.
- Passive modifier reading (Super/Alt/Ctrl/Shift only) with immediate pass-through.
- Movement beyond the threshold discards the press and prints
  `{"type":"gesture-candidate"}` (direction detection follows in step 2).
- Emergency brake after 10 s, clean ungrab on SIGTERM/SIGINT/stdin EOF, `--dry-run`.
- `lib/gesture_core.py`: evdev-free decision logic with unit tests.
