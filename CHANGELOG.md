# Changelog

## Unreleased

### Changed (muscle memory!)
- One gesture language for mouse and three fingers, the same in every program:
  ← / → back / forward everywhere (was: workspace on the desktop), ↑ / ↓ the layers like
  four fingers (was: launcher / terminal), ↑← / ↑→ workspace left / right (was: move
  window), ↓→ close tab (Ctrl+W; was: close window outside the browser), ↓← close window
  (Super+W, new), ↓←↑ / ↓→↑ move the window to the workspace left / right, ↓↑ new tab
  (was: floating / duplicate tab), ←↑ reopen tab and ↑↓ reload everywhere, rocker =
  back / forward. Browser profile: only the wheel (tabs) differs; terminal: ↓→ sends
  Ctrl+Shift+W.
- Shapes can have up to 5 strokes.

### Changed
- The defaults work without the Exposé plugin: "Exposé", the ring's 12 o'clock slot and
  the up layer open the app launcher when it is missing or disabled (the ring then says
  "App launcher"); Hyprexpo falls back to Exposé, then the launcher, instead of a
  notification. The settings recommend Exposé with its install command and a copy button.

### Added
- Super+1 … Super+0 bring back the windows the wallpaper layer hid and close Exposé, like
  the ring's workspace slots, also on the workspace already shown (General, on by
  default; rebinds Omarchy's keys in the generated Hyprland file).
- Ten styles for the ring menu, each with a matching gesture trail (Ring menu › Style,
  live preview): Comets, Drifting clouds, Radar, Orbits, Ink in water, Neon, Pulse,
  Clockwork, Aurora, Fireflies; "Plain" stays the default. "Gesture trail in the same
  style" can be switched off; with animations off each style is a still frame.

### Changed
- Trackpad gestures in groups: taps (by corner, then count; the 4-finger double tap
  last), 2, 3 (with the shared shapes) and 4 fingers, each with a heading. Taps show as
  dots on a small trackpad: one dot per tap on the diagonal into the tapped corner.

### Added
- Record gestures: "Record" in the gesture editor takes the next gesture you make (mouse,
  trigger + wheel, rocker, 3 or 4 fingers, corner tap) into the editor instead of running
  it, with its device, and says if it is bound already. Esc or 15 s stop it.

### Changed
- Trackpad like the mouse, gesture first, then its effect: Hyprland's workspace swipe is
  no longer a switch per finger count but the gesture "← → swipe" (3 or 4 fingers) in the
  list, with the effect "Swipe workspaces (Hyprland)" or nothing. Settings from before are
  carried over.

### Added
- Settings are saved at once, as in More Time and More Weather: no Save or Cancel button
  any more; a change made elsewhere while the window is open (the bar's middle click) is
  taken in.
- General › Back up and restore: export and import of all settings in one file, with a
  backup before every import and a second click to confirm ("Replace settings?"), as in
  More Time and More Weather.
- Ring menu: soft dividing lines between the rings and between their slots (on by
  default, "Dividing lines" switches them off).
- General › Language: Automatic, English or Deutsch, as in More Time and More Weather,
  for the settings, ring, indicator, menu bar tooltip and notifications (was: always the
  system locale, so an English system showed English next to German siblings).
- Ring 2 moves the window under the pointer to a workspace without following it (new
  actions "Window under pointer → workspace 1-10", also for gestures): each slot
  sits straight outside its workspace on ring 1 and shows an arrow into a small monitor
  with the number. The window is the one where the ring was opened. The former ring 2
  (window and program actions, keys q f s a d n t o l x) is now ring 3.
- Settings in pages like More Time and More Weather: General, Mouse, Trackpad, Ring menu
  and What's new, with a tab strip, Tab / Shift+Tab to switch, a fixed header and a
  page subtitle. The gesture list sits on the Mouse and the
  Trackpad page, each showing the shared shapes and its own device's rows.
- Settings › What's new ("Neuigkeiten", the name More Time and More Weather use): this change log, read from the plugin folder, newest first.
- General › "Show in app launcher" adds or removes the launcher entry at once.
- Rings 2 and 3 in the ring menu, each switched on in the settings, with 8/12/16/24
  slots (ring 1: 8/12/16). Distance picks the ring, direction the slot; ring 2 is turned
  by half a step and holds window and program actions by default, ring 3 starts empty.
  Any action fits any slot, workspaces too. The full name of the slot under the pointer
  shows in the middle; rings too big for the screen are drawn smaller.
- A key for every slot on every ring (upper case = Shift+letter), unique across rings.
- Keyboard shortcut to open the ring, Super+Alt+R by default (settings, empty = none),
  bound through the generated Hyprland file.
- Actions "App launcher", "New terminal" and "Files" for rings and gestures.
- Settings: gesture language hint, "All gestures to default".

### Fixed
- Scrolling in the settings at the speed of More Time and More Weather: a fixed step per
  wheel notch, touchpad deltas scaled up 2.5 × (Omarchy slows touchpads to 0.4, the page
  crawled). The window opens at the top of the page.
- Texts brought up to date: ring 2 / ring 3 hints, launcher entry comment (also in
  German), plugin description.
- The settings listed every key combination action (back, forward, close tab …) as "—"
  and opened it as "no action" in the editor: QML hands lists over as sequences that are
  not real arrays, and the check refused them.

### Changed
- Ring 2 is no longer turned by half a step: all rings start at 12 o'clock, so a slot sits
  straight outside the one before it.

### Changed
- A workspace action (ring, corner taps, gestures) closes an open Exposé, so picking
  workspace 1 while Exposé or the wallpaper is open on it shows its windows again.
- The menu bar icon is as tall as the icons next to it (it was a pixel smaller).
- App icon like More Weather's: a bigger symbol, and the right button (the gesture
  trigger) in the theme's accent color; it still follows every theme change.
- Four fingers up/down work as layers, the opposite swipe undoes the last step:
  nothing open: down = wallpaper, up = Exposé; Exposé: down closes it, up = app
  launcher; launcher: down closes it; wallpaper: down = Files (floating, centred,
  60 x 65 %), up = windows back; Files: up closes them (actions "stack-down" and
  "stack-up", the new trackpad defaults).
- "Show desktop" is called "Wallpaper" (the ring shows "Wallpaper").
- Smaller menu bar icon.

### Added
- Keyboard in the ring: Esc closes, 1-0 workspaces, e Exposé, w wallpaper; one key per
  slot, set next to each slot in the settings (`ring.keys`).

### Added
- Menu bar icon (`BarWidget.qml`, kind `bar-widget`): the mouse symbol inverted (arms cut
  out, so a transparent bar shows through), faded while gestures are off. Left click
  settings, middle click gestures on/off (saved), right click a status notification;
  each button can also open the ring or do nothing, tooltip optional ("Menu bar"
  settings). IPC `toggleSaved`, `openRing`, `notifyStatus`.

### Changed
- Ring slots 50 % larger (and the ring wider). Once the ring stays open for clicking, a
  click outside every slot closes it without doing anything.

### Added
- Double tap with 4 fingers on the trackpad opens the ring menu (gesture `tp4:tap2`,
  action "Ring menu", handled in the shell). It opens to stay: tap or click a slot.
  libinput only taps with 1-3 fingers, so this needs no grab and clicks nothing.

### Changed
- "Show desktop" ends when another workspace is shown: on every workspace switch the
  stashed windows go back to their workspace (the active one is left alone), so it
  looks as expected when you come back.
- Picking a workspace (ring, corner tap, gesture) ends "show desktop" there too, also when
  it is the current one (choosing 1 while on 1 used to leave the desktop empty).

### Fixed
- Ring: releasing without having left the middle keeps the ring open, then a click on
  a slot runs it (in the first test the numbers "could not be clicked"). When no hover
  position arrived, the release asks Hyprland for the pointer position.
- The ring shows "Desktop" for show desktop (the settings keep the longer name).

### Changed
- The ring is a clock face with 12 slots: Exposé at 12, workspaces 1-5 at 1-5, show
  desktop at 6, workspaces 6-0 at 7-11. Each slot can be set in the settings
  (`ring.slots`, default `Actions.RING_SLOTS`).

### Added (workspace ring)
- Double click the trigger and hold the second press: a ring with workspaces 1-0 around
  the pointer (1 at the top, clockwise). Move towards one and release to switch, release
  in the middle to cancel. 1-5 always normal, 6-0 faded unless a window is on them; the
  current workspace is outlined (`RingOverlay.qml`, `Ring.js`).
- Opt-in setting "Workspace ring" with the double click time (default 250 ms): ordinary
  clicks of the trigger are delayed by that time while it is on.

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
- 4 fingers down: back to "show desktop" (the scratchpad toggle was a misunderstanding).

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
