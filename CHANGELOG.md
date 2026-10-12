# Changelog

All notable changes to More Gestures are documented here.

## 1.1.0 — 2026-10-12

- **Nothing to install.** The daemon no longer needs python-evdev, which
  Omarchy does not ship: the part it used (reading, grabbing and cloning input
  devices) is now plain Python in `lib/evdev_lite.py`, checked against
  python-evdev on every device of the test machine.
- **Setup page.** One udev rule replaces joining the `input` group and a
  separate rule for `/dev/uinput`. The new Setup page shows what is granted
  and what is missing, why each is needed, the command with a copy button
  (`Ctrl+C` copies it too), what it does and how to undo it, plus the
  Hyprland hook and the Exposé plugin. No logout: the daemon picks the devices
  up within seconds of the command. Until then the bar icon is red, its click
  opens the Setup page, and one notification per session says so.
- **Position in the bar.** Left, center or right, switched under General ›
  Menu bar, as in More Time.

## 1.0.1 — 2026-10-12

- **Nothing runs while the screen is locked.** The daemon reads the mouse
  and trackpad below the compositor, so a gesture made at the locked machine
  could start a bound command or open Files. Every action, the ring and its
  slots now first ask Hyprland whether a session lock is held (Omarchy's lock,
  hyprlock or any other) and do nothing unless it clearly is not; while
  locked the daemon passes the mouse and trackpad straight through. Found in
  the marketplace review.

## 1.0.0 — 2026-10-11

The first release.

- **Mouse gestures, Opera style.** Hold the trigger (right button by default,
  or middle, side, extra), draw a line, release. A short click stays a click,
  a held one opens the context menu as before, and Super + right drag still
  resizes windows. Up to 5 strokes per shape, trigger + wheel, and rocker
  gestures (opt-in).
- **One gesture language.** The mouse and three fingers share every shape,
  and a shape does the same in every program: ← / → back / forward,
  ↑ / ↓ the layers (Exposé, launcher / wallpaper, Files), ↑← / ↑→ workspace,
  ↓→ close tab, ↓← close window, ↓←↑ / ↓→↑ move the window. Four fingers are
  the system level. Profiles for browsers (the wheel switches tabs) and
  terminals (↓→ sends Ctrl+Shift+W).
- **Trackpad gestures with 3 and 4 fingers.** Lines, shapes and pinches; the
  trackpad is only read, so scrolling, tapping and Hyprland's own gestures
  keep working. Hyprland's workspace swipe, which follows the fingers, is a
  gesture in the list ("← → swipe"). Corner taps (double or triple tap a
  corner, opt-in) and a 4-finger double tap for the ring menu.
- **The ring menu.** Double click the trigger and keep holding, double tap
  with four fingers, or press Super+Alt+R: a clock face around the pointer
  with Exposé, workspaces 1-0 and the wallpaper. Up to three rings: by default
  ring 2 moves the window under the pointer to a workspace (an arrow into a
  small monitor), ring 3 holds window and program actions. Every slot takes
  any action and a key (letters, digits, ⇧1 … ⇧0 by key position); soft
  dividing lines between rings and slots.
- **Eleven styles.** The ring: Plain, Comets, Drifting clouds, Radar,
  Orbits, Ink in water, Neon, Pulse, Clockwork, Aurora, Fireflies. The
  gesture trail separately (Comet with a tail that burns out, Vapour trail,
  Blips, Stardust, Brush stroke …), each with a live preview; with
  animations off every style is a still frame.
- **Workspaces show their windows.** Picking a workspace in the ring, by
  gesture or with Super+1 … Super+0 closes Exposé and brings back the
  windows the wallpaper layer hid, also on the workspace already shown.
- **Works on a plain Omarchy.** Without the Exposé plugin its slots open the
  app launcher; the settings recommend it with the install command. The
  Hyprland file the plugin writes (swipe, ring shortcut, Super+1…0) is hooked
  into `input.lua` with one click ("Set up", with a backup; `bin/hypr-hook`).
- **Settings like More Time and More Weather.** Pages for General, Mouse,
  Trackpad, Ring menu and What's new, saved as you go, keyboard control,
  export and import with a backup, an app launcher entry and a menu bar icon
  whose clicks you choose. Record a gesture instead of building it from
  arrows; recorded or typed key combinations of up to four steps.
- **30 languages.** The same as More Time and More Weather, for the
  settings, the ring, the indicator, the tooltip and the notifications.
- **Safe by design.** The daemon only lives as a child of the shell: if
  anything dies, the kernel releases the mouse. Games and VMs on the
  exclusion list get the mouse untouched; actions from the settings file are
  validated, so it cannot inject Lua.
