# More Gestures

Opera-style mouse gestures for Omarchy (Hyprland + Quickshell shell): hold the right
button, drag a line, release. See `PLAN.md` for the full plan.

**Status:** step 1 of 6 – the input daemon only. There is no plugin, no gesture
recognition and no UI yet.

*Deutsch:* Opera-artige Mausgesten für Omarchy. Stand: Schritt 1 von 6, nur der
Eingabe-Daemon (Durchreichen und Klick-Nachsenden), noch keine Gestenerkennung.

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
  - moved beyond the threshold (default 20 units) → press discarded and the line
    `{"type":"gesture-candidate"}` is printed on stdout. Direction detection comes in step 2.
- Modifiers: keyboards are only read passively (never grabbed) and only
  Super/Alt/Ctrl/Shift are evaluated, every other key is dropped immediately. While a
  modifier is down the press is passed through at once, so Super+right-drag still
  resizes windows.
- Emergency brake: a gesture held for more than 10 s is reset (`{"type":"cancel"}`).
- Clean shutdown: SIGTERM, SIGINT and EOF on stdin release the grab and exit. If the
  process dies in any other way the kernel releases the grab.

```
bin/gesture-daemon --dry-run          # grabs nothing, prints devices and state changes
bin/gesture-daemon [--button right|middle|side|extra] [--threshold N] [--hold-ms N] [--emergency-s N]
```

`--dry-run` still opens the devices for reading (needed to observe the state changes)
but never grabs them or creates a `uinput` device. Note that stdin is watched: when it
is closed (e.g. `< /dev/null`) the daemon exits, that is how the shell stops it.

## Layout

- `lib/gesture_core.py` – decision logic (state machine, device classification), no
  evdev dependency.
- `bin/gesture-daemon` – thin evdev/uinput wrapper.
- `tests/test_core.py` – unit tests.

## Tests

```
python -m unittest discover -s tests
```
