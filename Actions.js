.pragma library
.import "I18n.js" as I18n
.import "Ring.js" as Ring

// Gesture -> action mapping and command building. Pure functions only (no QML, no
// I/O), so the same file runs in the shell and under `node --test`.
//
// Security model: everything that ends up in Lua text for `hyprctl eval` is either a
// fixed string from DISPATCH below (selected by id) or a modifier/key name that passed
// the allow-list/regex. The settings file is user-editable and may be written by other
// tools, so a value like `T"}) os.execute("...` must never reach the Lua source. The
// text is handed to hyprctl as one argv element, never through a shell.
// `exec` actions run an arbitrary user command by design (like hotcorners); they are
// the only place where the settings file can run code, and they do so without Lua.

var KEY_HOLD_MS = 50          // down -> up, same as default/hypr/bindings/clipboard.lua
var SEQUENCE_GAP_MS = 80      // pause between the up of one combo and the down of the next
var MAX_SEQUENCE = 4
var MAX_EXEC_LENGTH = 500
var MAX_LABEL_LENGTH = 40

// Canonical order, also the order in the generated Lua and in labels.
var MODIFIERS = ["SUPER", "CTRL", "ALT", "SHIFT"]
var KEY_PATTERN = /^[A-Za-z0-9_]{1,32}$/

// Window tags set by Omarchy (default/hypr/apps/browser.lua, terminals.lua).
// First hit wins; "default" always comes last.
var PROFILE_TAGS = [
  { profile: "browser", tags: ["chromium-based-browser", "firefox-based-browser"] },
  { profile: "terminal", tags: ["terminal"] }
]

var SOURCES = ["*", "mouse", "tp3", "tp4", "tap"]
// Corner taps (source "tap") have their own gesture names: corner + count, e.g. "tl2".
// `tp3:swipe` / `tp4:swipe`: the horizontal swipe Hyprland follows with the fingers; its
// only effects are "hypr-workspace-swipe" or none (see SWIPE_ACTION).
var GESTURE_KEY_PATTERN = /^((\*|mouse|tp3|tp4):([UDLR]{1,5}|wheel-up|wheel-down|rocker-left|rocker-right|pinchin|pinchout)|tap:(tl|tr|bl|br)[1-4]|tp4:tap2|(tp3|tp4):swipe)$/
var SWIPE_ACTION = "hypr-workspace-swipe"

// Windows the plugin must not touch (games, VMs). Trailing "*" is a prefix match.
var DEFAULT_EXCLUDES = ["steam_app_*", "retroarch", "qemu*", "virt-manager", "gamescope"]

// ------------------------------------------------------------------ dispatchers

// Hyprland has no "show desktop" dispatcher. Toggle: the windows of the active workspace
// move to a hidden special workspace and back. The decision is made from what is on that
// special workspace, not from remembered state, so a Hyprland reload in between cannot
// strand the windows there.
var SHOW_DESKTOP_LUA = [
  'local ws = hl.get_active_workspace()',
  'if not ws or ws.special then return end',
  'local here = ws.id > 0 and tostring(ws.id) or ("name:" .. ws.name)',
  'local hidden = "special:more-gestures-desktop-" .. ws.id',
  'local stash = hl.get_workspace_windows(hidden) or {}',
  'if #stash > 0 then',
  '  for _, w in ipairs(stash) do hl.dispatch(hl.dsp.window.move({ workspace = here, follow = false, window = w })) end',
  'else',
  '  for _, w in ipairs(hl.get_workspace_windows(here) or {}) do',
  '    hl.dispatch(hl.dsp.window.move({ workspace = hidden, follow = false, window = w }))',
  '  end',
  'end'
].join("\n")

// Ends "show desktop" everywhere but on the active workspace: run by Service.qml on every
// workspace switch. Without it, switching away and back later found the workspace empty
// although nobody had asked to keep it cleared.
var RESTORE_DESKTOPS_LUA = [
  'local active = hl.get_active_workspace()',
  'for _, w in ipairs(hl.get_workspaces() or {}) do',
  '  local id = string.match(w.name or "", "more%-gestures%-desktop%-(%-?%d+)$")',
  '  if id and w.windows > 0 and not (active and tostring(active.id) == id) then',
  '    local target = tonumber(id) > 0 and id or nil',
  '    if target then',
  '      for _, win in ipairs(hl.get_workspace_windows("special:more-gestures-desktop-" .. id) or {}) do',
  '        hl.dispatch(hl.dsp.window.move({ workspace = target, follow = false, window = win }))',
  '      end',
  '    end',
  '  end',
  'end'
].join("\n")

// Switch to workspace n and show its windows: end "show desktop" there first (picking 1
// while already on 1 changes no workspace, so the switch hook RESTORE_DESKTOPS_LUA never
// runs and the desktop stayed empty) and close an open Exposé, which would otherwise keep
// covering them.
function workspaceLua(n) {
  var id = String(n)
  return [
    'if #(hl.get_layers({ namespace = "expose-window-overview" }) or {}) > 0 then hl.exec_cmd("omarchy-shell expose close") end',
    'for _, win in ipairs(hl.get_workspace_windows("special:more-gestures-desktop-' + id + '") or {}) do',
    '  hl.dispatch(hl.dsp.window.move({ workspace = "' + id + '", follow = false, window = win }))',
    'end',
    'hl.dispatch(hl.dsp.focus({ workspace = "' + id + '" }))'
  ].join("\n")
}

// Exposé is a separate plugin (expose.window-overview). Without it the "Exposé" action,
// the up layer and the Hyprexpo fallback open the app launcher instead, so the defaults
// work on a plain Omarchy too. "Available" = installed and not disabled in shell.json,
// read when the action runs, so installing the plugin needs no restart of anything.
var EXPOSE_EVENT = 'hl.dispatch(hl.dsp.event("expose.window-overview:toggle"))'
var LAUNCHER = 'hl.exec_cmd("omarchy-menu toggle apps")'
var EXPOSE_AVAILABLE_LUA = [
  'local function expose_available()',
  '  local config = os.getenv("XDG_CONFIG_HOME") or ((os.getenv("HOME") or "") .. "/.config")',
  '  local m = io.open(config .. "/omarchy/plugins/expose.window-overview/manifest.json", "r")',
  '  if not m then return false end',
  '  m:close()',
  '  local f = io.open(config .. "/omarchy/shell.json", "r")',
  '  if not f then return true end',
  '  local text = f:read("a") or ""',
  '  f:close()',
  '  local list = text:match(\'"disabledPlugins"%s*:%s*(%b[])\')',
  '  return not (list and list:find(\'"expose.window-overview"\', 1, true))',
  'end'
].join("\n")
var EXPOSE_LUA = EXPOSE_AVAILABLE_LUA + "\n" + 'if expose_available() then ' + EXPOSE_EVENT + ' else ' + LAUNCHER + ' end'

// Layers for four fingers up/down. Each swipe looks at what is open right now, so the
// opposite swipe always undoes the last step (the first version toggled with the same
// direction, which felt wrong):
//   nothing open:      down = wallpaper,      up = Exposé
//   Exposé open:       down = close Exposé,   up = app launcher
//   launcher open:     down = close launcher, up = nothing
//   wallpaper:         down = files,          up = back to the windows
//   wallpaper + files: down = nothing,        up = close files
// Files open floating in the middle of the screen, tagged so the up swipe finds them.
var LAYER_HELPERS = [
  'local function expose_open() return #(hl.get_layers({ namespace = "expose-window-overview" }) or {}) > 0 end',
  'local function menu_open() return #(hl.get_layers({ namespace = "omarchy-menu" }) or {}) > 0 end',
  'local ws = hl.get_active_workspace()',
  'local here, hidden',
  'if ws and not ws.special then',
  '  here = ws.id > 0 and tostring(ws.id) or ("name:" .. ws.name)',
  '  hidden = "special:more-gestures-desktop-" .. ws.id',
  'end',
  'local function tagged_files()',
  '  local out = {}',
  '  for _, w in ipairs(here and hl.get_workspace_windows(here) or {}) do',
  '    local tags = type(w.tags) == "table" and w.tags or { w.tags }',
  '    for _, t in ipairs(tags) do',
  '      if tostring(t):gsub("%*$", "") == "more-gestures-files" then table.insert(out, w) end',
  '    end',
  '  end',
  '  return out',
  'end',
  'local function stash() return hidden and hl.get_workspace_windows(hidden) or {} end'
].join("\n")

var STACK_DOWN_LUA = LAYER_HELPERS + "\n" + [
  'if menu_open() then hl.exec_cmd("omarchy-shell shell hide omarchy.menu") return end',
  'if expose_open() then hl.exec_cmd("omarchy-shell expose close") return end',
  'if not here then return end',
  'if #stash() > 0 or #(hl.get_workspace_windows(here) or {}) == 0 then',
  '  if #tagged_files() == 0 then',
  '    hl.exec_cmd("uwsm-app -- nautilus --new-window", { float = true, center = true,',
  '      size = "monitor_w*0.6 monitor_h*0.65", tag = "+more-gestures-files" })',
  '  end',
  '  return',
  'end',
  'for _, w in ipairs(hl.get_workspace_windows(here) or {}) do',
  '  hl.dispatch(hl.dsp.window.move({ workspace = hidden, follow = false, window = w }))',
  'end'
].join("\n")

var STACK_UP_LUA = LAYER_HELPERS + "\n" + EXPOSE_AVAILABLE_LUA + "\n" + [
  'if menu_open() then return end',
  'if expose_open() then hl.exec_cmd("omarchy-menu toggle apps") return end',
  'local files = tagged_files()',
  'if #files > 0 then',
  '  for _, w in ipairs(files) do hl.dispatch(hl.dsp.window.close({ window = "address:" .. w.address })) end',
  '  return',
  'end',
  'local s = stash()',
  'if #s > 0 then',
  '  for _, w in ipairs(s) do hl.dispatch(hl.dsp.window.move({ workspace = here, follow = false, window = w })) end',
  '  return',
  'end',
  // Without Exposé the first step up is the launcher itself (up again: nothing, it is open).
  'if expose_available() then ' + EXPOSE_EVENT + ' else ' + LAUNCHER + ' end'
].join("\n")

// Moves the window under a point to workspace n without following it ("movetoworkspace-
// silent"). The point is the first line: where the ring was opened (buildCommand puts it
// in), otherwise the pointer now (a gesture). Hyprland has no "window at" query, so the
// windows on the monitor's shown workspaces are searched: the special workspace and
// pinned windows lie above the normal one, fullscreen above the rest, floating above
// tiled, and among equals the most recently focused is on top.
var POINT_FROM_CURSOR = 'local p = hl.get_cursor_pos() local px, py = p.x, p.y'
function moveSilentLua(n) {
  return [
    POINT_FROM_CURSOR,
    'local mon = hl.get_monitor_at(px, py)',
    'local shown = {}',
    'if mon then',
    '  if mon.active_workspace then shown[mon.active_workspace.id] = 1 end',
    '  if mon.active_special_workspace then shown[mon.active_special_workspace.id] = 0 end',
    'end',
    'local best, best_rank',
    'for _, w in ipairs(hl.get_windows() or {}) do',
    '  local layer = w.workspace and shown[w.workspace.id]',
    '  if w.pinned then layer = 0 end',
    '  if layer and w.mapped and not w.hidden and w.at and w.size',
    '    and px >= w.at.x and px < w.at.x + w.size.x and py >= w.at.y and py < w.at.y + w.size.y then',
    '    local rank = layer * 100000 + ((w.fullscreen or 0) > 0 and 0 or 1) * 10000',
    '      + (w.floating and 0 or 1) * 1000 + (w.focus_history_id or 999)',
    '    if not best_rank or rank < best_rank then best, best_rank = w, rank end',
    '  end',
    'end',
    'if best then hl.dispatch(hl.dsp.window.move({ workspace = "' + n + '", follow = false, window = best })) end'
  ].join("\n")
}

// hyprexpo is a hyprpm plugin, not part of a plain Omarchy, and after a Hyprland update
// it may not be loaded until `hyprpm reload`. Without it: Exposé, else the launcher (the
// gesture still does something; Settings says how to get either).
var HYPREXPO_LUA = EXPOSE_AVAILABLE_LUA + "\n" + [
  'local x = hl.plugin and hl.plugin.hyprexpo',
  'if x then x.expo("toggle")',
  'elseif expose_available() then ' + EXPOSE_EVENT,
  'else ' + LAUNCHER + ' end'
].join("\n")

// id -> { lua, en, de }. `lua` is a complete hl.dsp expression; copied from the
// shapes used in /usr/share/omarchy/default/hypr/bindings/tiling.lua.
var DISPATCH = {
  "workspace-prev":      { lua: 'hl.dsp.focus({ workspace = "e-1" })' },
  "workspace-next":      { lua: 'hl.dsp.focus({ workspace = "e+1" })' },
  "workspace-previous":  { lua: 'hl.dsp.focus({ workspace = "previous" })' },
  "window-close":        { lua: 'hl.dsp.window.close()' },
  "window-float-toggle": { lua: 'hl.dsp.window.float({ action = "toggle" })' },
  "window-fullscreen":   { lua: 'hl.dsp.window.fullscreen({ mode = "fullscreen" })' },
  "window-maximize":     { lua: 'hl.dsp.window.fullscreen({ mode = "maximized" })' },
  "window-pseudo":       { lua: 'hl.dsp.window.pseudo()' },
  "window-pin":          { lua: 'hl.dsp.window.pin()' },
  "window-to-workspace-prev": { lua: 'hl.dsp.window.move({ workspace = "e-1" })' },
  "window-to-workspace-next": { lua: 'hl.dsp.window.move({ workspace = "e+1" })' },
  "focus-left":          { lua: 'hl.dsp.focus({ direction = "l" })' },
  "focus-right":         { lua: 'hl.dsp.focus({ direction = "r" })' },
  "focus-up":            { lua: 'hl.dsp.focus({ direction = "u" })' },
  "focus-down":          { lua: 'hl.dsp.focus({ direction = "d" })' },
  "window-next":         { lua: 'hl.dsp.window.cycle_next()' },
  "window-prev":         { lua: 'hl.dsp.window.cycle_next({ next = false })' },
  "group-next":          { lua: 'hl.dsp.group.next()' },
  "group-prev":          { lua: 'hl.dsp.group.prev()' },
  "scratchpad-toggle":   { lua: 'hl.dsp.workspace.toggle_special("scratchpad")' },
  // Event the expose.window-overview plugin listens for (same as its CTRL+ALT+TAB bind).
  "workspace-1":         { chunk: workspaceLua(1) },
  "workspace-2":         { chunk: workspaceLua(2) },
  "workspace-3":         { chunk: workspaceLua(3) },
  "workspace-4":         { chunk: workspaceLua(4) },
  "workspace-5":         { chunk: workspaceLua(5) },
  "workspace-6":         { chunk: workspaceLua(6) },
  "workspace-7":         { chunk: workspaceLua(7) },
  "workspace-8":         { chunk: workspaceLua(8) },
  "workspace-9":         { chunk: workspaceLua(9) },
  "workspace-10":        { chunk: workspaceLua(10) },
  // Ring 2 by default: each just clockwise of its workspace on ring 1.
  "window-to-workspace-silent-1": { chunk: moveSilentLua(1), atPoint: true },
  "window-to-workspace-silent-2": { chunk: moveSilentLua(2), atPoint: true },
  "window-to-workspace-silent-3": { chunk: moveSilentLua(3), atPoint: true },
  "window-to-workspace-silent-4": { chunk: moveSilentLua(4), atPoint: true },
  "window-to-workspace-silent-5": { chunk: moveSilentLua(5), atPoint: true },
  "window-to-workspace-silent-6": { chunk: moveSilentLua(6), atPoint: true },
  "window-to-workspace-silent-7": { chunk: moveSilentLua(7), atPoint: true },
  "window-to-workspace-silent-8": { chunk: moveSilentLua(8), atPoint: true },
  "window-to-workspace-silent-9": { chunk: moveSilentLua(9), atPoint: true },
  "window-to-workspace-silent-10": { chunk: moveSilentLua(10), atPoint: true },
  // Handled inside the shell (Service.qml), not by Hyprland: opens the ring menu.
  "ring-menu":           { internal: "ring" },
  // Not run by the plugin: bound to a "swipe" gesture it becomes Hyprland's own gesture
  // in the generated Lua file, where the workspace follows the fingers.
  "hypr-workspace-swipe": { internal: "swipe" },
  "expose":              { chunk: EXPOSE_LUA },
  // The ring shows only the part before the brackets ("Wallpaper").
  "show-desktop":        { chunk: SHOW_DESKTOP_LUA },
  // Four-finger up/down as layers: what a swipe does depends on what is open, and the
  // opposite swipe takes it back (see STACK_DOWN_LUA / STACK_UP_LUA).
  "stack-down":          { chunk: STACK_DOWN_LUA },
  "stack-up":            { chunk: STACK_UP_LUA },
  "hyprexpo":            { chunk: HYPREXPO_LUA },
  // Programs as dispatch ids, so the ring settings can offer them in the dropdown.
  "app-launcher":        { chunk: 'hl.exec_cmd("omarchy-menu toggle apps")' },
  "new-terminal":        { chunk: 'hl.exec_cmd("omarchy-launch-terminal")' },
  "files":               { chunk: 'hl.exec_cmd("uwsm-app -- nautilus --new-window")' }
}

var MODIFIER_NAMES = {
  en: { SUPER: "Super", CTRL: "Ctrl", ALT: "Alt", SHIFT: "Shift" },
  de: { SUPER: "Super", CTRL: "Strg", ALT: "Alt", SHIFT: "Umschalt" }
}

// ------------------------------------------------------------- default bindings

function dispatch(id) { return { type: "dispatch", id: id } }
function exec(command, label) { return { type: "exec", command: command, label: label } }
function keys(mods, key, label) { return { type: "keys", combo: [mods, key], label: label } }
function none() { return { type: "none" } }

// Gesture keys are "<source>:<gesture>"; "*" applies to every source. Profile entries
// beat the default profile, and a specific source beats "*" within one profile.
// A profile only lists what differs; missing gestures fall through to "default".
//
// One gesture language for every device and program: the mouse (trigger + movement) and
// three fingers share the "*:" entries, so a shape learnt on one works on the other, and
// it means the same thing everywhere:
//   ← / →     back / forward (Alt+Left/Right, as in the browser)
//   ↑ / ↓     layers: Exposé → launcher / wallpaper → files; the opposite way undoes
//   ↑← / ↑→   workspace left / right ("one level up, then across")
//   ↓→        close tab (Ctrl+W)          ↓←      close window (Super+W)
//   ↓←↑ / ↓→↑ move the window to the workspace left / right
//   ↓↑ new tab, ←↑ reopen closed tab, ↑↓ reload, →↑ fullscreen
// Four fingers are the system level: left/right is Hyprland's own workspace swipe,
// up/down the same layers, pinches and the double tap add launcher, Hyprexpo and the ring.
function defaultBindings() {
  var desktop = {
    "*:L": keys("ALT", "Left", "back"),
    "*:R": keys("ALT", "Right", "forward"),
    "*:U": dispatch("stack-up"),
    "*:D": dispatch("stack-down"),
    "*:UL": dispatch("workspace-prev"),
    "*:UR": dispatch("workspace-next"),
    "*:DR": keys("CTRL", "W", "close-tab"),
    "*:DL": dispatch("window-close"),
    "*:DLU": dispatch("window-to-workspace-prev"),
    "*:DRU": dispatch("window-to-workspace-next"),
    "*:DU": keys("CTRL", "T", "new-tab"),
    "*:LU": keys("CTRL SHIFT", "T", "reopen-tab"),
    "*:UD": keys("", "F5", "reload"),
    "*:RU": dispatch("window-fullscreen"),
    "*:wheel-up": dispatch("workspace-prev"),
    "*:wheel-down": dispatch("workspace-next"),
    "*:rocker-left": keys("ALT", "Left", "back"),
    "*:rocker-right": keys("ALT", "Right", "forward")
  }
  // The wheel switches tabs instead of workspaces; every shape stays the same.
  var browser = {
    "*:wheel-up": keys("CTRL SHIFT", "Tab", "prev-tab"),
    "*:wheel-down": keys("CTRL", "Tab", "next-tab")
  }
  // Ctrl+W deletes a word in a shell; terminals with tabs close them with Ctrl+Shift+W.
  var terminal = {
    "*:DR": keys("CTRL SHIFT", "W", "close-tab")
  }
  // Four fingers left/right are Hyprland's workspace swipe by default (the "swipe"
  // gesture), so they never reach these tables; up/down use the "*:" layers. Three
  // fingers swipe nothing natively; the row is listed so it can be switched on.
  desktop["tp4:swipe"] = dispatch(SWIPE_ACTION)
  desktop["tp3:swipe"] = none()
  desktop["tp4:pinchin"] = exec("omarchy-menu toggle apps", "launcher")
  desktop["tp4:pinchout"] = dispatch("hyprexpo")
  // No "hold and drag" on a trackpad: the ring opens to stay, tap a slot to pick it.
  desktop["tp4:tap2"] = dispatch("ring-menu")
  // Corner taps (touchpad, needs "corner taps" on): double tap = workspaces 1-4 in the
  // order top-left, top-right, bottom-left, bottom-right; triple tap = 5-8.
  var corners = ["tl", "tr", "bl", "br"]
  for (var c = 0; c < corners.length; c++) {
    desktop["tap:" + corners[c] + "2"] = dispatch("workspace-" + (c + 1))
    desktop["tap:" + corners[c] + "3"] = dispatch("workspace-" + (c + 5))
  }
  return { "default": desktop, browser: browser, terminal: terminal }
}

// Ring menu: up to three rings around the pointer, each a clock face with slot 0 at the
// top, clockwise. Ring 1 (inner, always on): Exposé at 12, workspaces 1-5 at 1-5,
// wallpaper at 6, workspaces 6-9 and 10 ("0") at 7-11. Ring 2: window and program
// actions. Ring 3: empty, for the user. Any action fits any ring, workspaces included.
// Key per slot while the ring is open (Esc always closes); upper case = Shift+letter.
var RING_COUNTS = [[8, 12, 16], [8, 12, 16, 24], [8, 12, 16, 24]]

var RING_KEYS = ["e", "1", "2", "3", "4", "5", "w", "6", "7", "8", "9", "0"]

var RING_SLOTS = [
  dispatch("expose"),
  dispatch("workspace-1"), dispatch("workspace-2"), dispatch("workspace-3"),
  dispatch("workspace-4"), dispatch("workspace-5"),
  dispatch("show-desktop"),
  dispatch("workspace-6"), dispatch("workspace-7"), dispatch("workspace-8"),
  dispatch("workspace-9"), dispatch("workspace-10")
]

function ringDefaultsList() {
  return [
    { enabled: true, count: 12, slots: RING_SLOTS, keys: RING_KEYS },
    // Ring 2's slot k sits straight outside ring 1's slot k: "move the window there"
    // right behind each workspace. Keys ⇧1 … ⇧0, like Super+Shift+digit in Omarchy.
    { enabled: false, count: 12,
      slots: RING_SLOTS.map(function (a) {
        var ws = Ring.workspaceOf(a)
        return ws ? dispatch("window-to-workspace-silent-" + ws) : none()
      }),
      keys: RING_SLOTS.map(function (a) {
        var ws = Ring.workspaceOf(a)
        return ws ? "⇧" + Ring.workspaceLabel(ws) : ""
      }) },
    { enabled: false, count: 12,
      slots: [dispatch("window-close"), dispatch("window-fullscreen"), dispatch("window-float-toggle"),
              dispatch("window-to-workspace-prev"), dispatch("window-to-workspace-next"),
              dispatch("scratchpad-toggle"), dispatch("new-terminal"), dispatch("files"),
              dispatch("app-launcher"), dispatch("hyprexpo"), none(), none()],
      keys: ["q", "f", "s", "a", "d", "n", "t", "o", "l", "x", "", ""] }
  ]
}

// ------------------------------------------------------------------ validation

// QML hands arrays that went through a `var` property or a Repeater's modelData over as
// Qt sequences: indexable with a length, but Array.isArray is false. Key combinations
// then failed validation and the settings listed them as "—". Lists are taken as either.
function isList(v) {
  return Array.isArray(v) || (v !== null && typeof v === "object" && typeof v.length === "number")
}
function toArray(v) { return Array.prototype.slice.call(v) }

function isPlainObject(v) { return v !== null && typeof v === "object" && !isList(v) }

// Accepts "CTRL SHIFT", "ctrl+shift", ["CTRL","SHIFT"], "" and returns the canonical
// list, or null when anything is not on the allow-list.
function parseModifiers(raw) {
  var parts
  if (raw === undefined || raw === null || raw === "") parts = []
  else if (isList(raw)) parts = toArray(raw)
  else if (typeof raw === "string") parts = raw.split(/[\s+]+/)
  else return null
  var seen = {}
  for (var i = 0; i < parts.length; i++) {
    if (typeof parts[i] !== "string") return null
    var m = parts[i].trim().toUpperCase()
    if (m === "") continue
    if (MODIFIERS.indexOf(m) < 0) return null
    seen[m] = true
  }
  return MODIFIERS.filter(function (m) { return seen[m] })
}

// One combination [mods, key] -> { mods: [...], key } or null.
function parseCombo(raw) {
  // Canonical { mods, key } is accepted too, so validateAction is idempotent.
  if (isPlainObject(raw)) raw = [raw.mods, raw.key]
  if (!isList(raw) || raw.length !== 2) return null
  raw = toArray(raw)
  var mods = parseModifiers(raw[0])
  if (mods === null) return null
  var key = raw[1]
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null
  return { mods: mods, key: key }
}

function cleanLabel(label) {
  if (typeof label !== "string") return ""
  return label.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_LABEL_LENGTH)
}

// Returns { ok: true, action } with a canonical copy, or { ok: false, error }.
// Unknown fields are dropped so nothing unvalidated travels further.
function validateAction(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: "action must be an object" }
  var label = cleanLabel(raw.label)
  switch (raw.type) {
  case "none":
    return { ok: true, action: { type: "none" } }
  case "dispatch":
    if (typeof raw.id !== "string" || !Object.prototype.hasOwnProperty.call(DISPATCH, raw.id))
      return { ok: false, error: "unknown dispatch id" }
    return { ok: true, action: { type: "dispatch", id: raw.id } }
  case "exec":
    if (typeof raw.command !== "string" || raw.command.trim() === "")
      return { ok: false, error: "exec needs a command" }
    if (raw.command.length > MAX_EXEC_LENGTH || raw.command.indexOf("\u0000") >= 0)
      return { ok: false, error: "exec command invalid" }
    return { ok: true, action: { type: "exec", command: raw.command, label: label } }
  case "keys":
    var combos = []
    var source = raw.sequence !== undefined && raw.sequence !== null ? raw.sequence : [raw.combo]
    if (isList(source)) source = toArray(source)
    if (!Array.isArray(source) || source.length < 1 || source.length > MAX_SEQUENCE)
      return { ok: false, error: "sequence must have 1.." + MAX_SEQUENCE + " combos" }
    for (var i = 0; i < source.length; i++) {
      var c = parseCombo(source[i])
      if (!c) return { ok: false, error: "invalid key combination" }
      combos.push(c)
    }
    return { ok: true, action: { type: "keys", sequence: combos, label: label } }
  }
  return { ok: false, error: "unknown action type" }
}

// ------------------------------------------------------------------ commands

function luaString(value) {
  // Only reached with validated parts; refuse anything else instead of escaping.
  if (!/^[A-Za-z0-9_ ]*$/.test(value)) throw new Error("unsafe lua string")
  return '"' + value + '"'
}

// The Lua chunk for `hyprctl eval`: one down/up pair per combo, later combos on timers.
function keysLua(sequence) {
  var lua = 'local function k(m, key)\n'
    + '  hl.dispatch(hl.dsp.send_key_state({ mods = m, key = key, state = "down" }))\n'
    + '  hl.timer(function()\n'
    + '    hl.dispatch(hl.dsp.send_key_state({ mods = m, key = key, state = "up" }))\n'
    + '  end, { timeout = ' + KEY_HOLD_MS + ', type = "oneshot" })\n'
    + 'end\n'
  for (var i = 0; i < sequence.length; i++) {
    var call = 'k(' + luaString(sequence[i].mods.join(" ")) + ', ' + luaString(sequence[i].key) + ')'
    if (i === 0) {
      lua += call + '\n'
    } else {
      lua += 'hl.timer(function() ' + call + ' end, { timeout = ' + (i * (KEY_HOLD_MS + SEQUENCE_GAP_MS))
        + ', type = "oneshot" })\n'
    }
  }
  return lua
}

// Validated action -> what to run: { argv } or null for "none"/invalid input.
// Revalidates, so callers can pass settings data straight in.
// `point` ({ x, y } in layout pixels, optional): where an action that acts on the window
// under a point looks (the ring passes where it was opened); without it, the pointer.
function buildCommand(raw, point) {
  var v = validateAction(raw)
  if (!v.ok) return null
  var a = v.action
  if (a.type === "none") return null
  if (a.type === "dispatch") {
    var d = DISPATCH[a.id]
    if (d.internal) return null  // the caller handles it (see isInternal)
    var chunk = d.chunk
    if (d.atPoint && point && isFinite(point.x) && isFinite(point.y))
      chunk = chunk.replace(POINT_FROM_CURSOR,
        "local px, py = " + Number(point.x).toFixed(1) + ", " + Number(point.y).toFixed(1))
    return { argv: ["hyprctl", "eval", chunk ? chunk : "hl.dispatch(" + d.lua + ")"] }
  }
  if (a.type === "exec")
    return { argv: ["bash", "-lc", a.command] }
  return { argv: ["hyprctl", "eval", keysLua(a.sequence)] }
}

// "ring" for an action the shell runs itself, "" otherwise.
function internalOf(raw) {
  var v = validateAction(raw)
  if (!v.ok || v.action.type !== "dispatch") return ""
  return DISPATCH[v.action.id].internal || ""
}

// ------------------------------------------------------------------- display

// Names come from the catalogues: act_<id>, numbered actions one act_<kind>-n with
// "%1" for the number (act_workspace-n = "Workspace %1").
function dispatchName(id, l) {
  var m = /^(workspace|window-to-workspace-silent)-(\d+)$/.exec(id)
  return m ? I18n.tr(l, "act_" + m[1] + "-n").replace("%1", m[2]) : I18n.tr(l, "act_" + id)
}

// Key names stay English or German in every other language: the settings read a typed
// combination back, and only those two spellings are understood (Keys.comboFromText).
function comboText(combo, l) {
  var names = MODIFIER_NAMES[I18n.lang(l) === "de" ? "de" : "en"]
  var parts = combo.mods.map(function (m) { return names[m] })
  parts.push(combo.key)
  return parts.join("+")
}

// "Strg+Umschalt+T"; a sequence is joined with ", ".
function keysText(sequence, l) {
  return sequence.map(function (c) { return comboText(c, l) }).join(", ")
}

// Name shown in the indicator and in the settings list; "—" for none/invalid.
function actionName(raw, l) {
  var v = validateAction(raw)
  if (!v.ok || v.action.type === "none") return "—"
  var a = v.action
  if (a.type === "dispatch") return dispatchName(a.id, l)
  // The default key combos carry a known label (label_back …); others show their own.
  var name = a.label && I18n.has("en", "label_" + a.label) ? I18n.tr(l, "label_" + a.label) : a.label
  if (a.type === "exec") return name || a.command.slice(0, MAX_LABEL_LENGTH)
  var text = keysText(a.sequence, l)
  return name ? name + " (" + text + ")" : text
}

// Text for notify-send: its body is markup, so a label like "<b>" or "&" would be
// interpreted. Swapped for look-alikes, as in More Time and More Weather.
function notificationText(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "\uff06").replace(/</g, "\u2039").replace(/>/g, "\u203a")
}

// ----------------------------------------------------------------- indicator

var INDICATOR_MODES = ["off", "minimal", "full"]
var ARROWS = { U: "↑", D: "↓", L: "←", R: "→" }

// Anything but a known mode gives "full" (the default), so a typo in the settings file
// does not silently switch the feedback off.
function normalizeIndicator(v) { return INDICATOR_MODES.indexOf(v) >= 0 ? v : "full" }

function arrowFor(dir) { return Object.prototype.hasOwnProperty.call(ARROWS, dir) ? ARROWS[dir] : "" }

// "DR" -> ["↓", "→"]; unknown letters are dropped.
var CORNER_ARROWS = { tl: "↖", tr: "↗", bl: "↙", br: "↘" }

// "tl2" -> "↖ 2×"; "" for anything else.
function tapText(gesture) {
  var m = /^(tl|tr|bl|br)([1-4])$/.exec(String(gesture || ""))
  return m ? CORNER_ARROWS[m[1]] + " " + m[2] + "×" : ""
}

// Dots for a tap symbol, in a unit square (0..1, y down): a corner tap puts one dot per
// tap on the diagonal into its corner ("tl2": one near the top-left corner, one further
// in towards the bottom right); "tap2" (four fingers, twice) two rows of four.
// [] for anything else.
function tapDots(gesture) {
  var g = String(gesture || "")
  if (g === "tap2") {
    var rows = []
    for (var r = 0; r < 2; r++) for (var c = 0; c < 4; c++) rows.push({ x: 0.2 + c * 0.2, y: 0.38 + r * 0.24 })
    return rows
  }
  var m = /^(tl|tr|bl|br)([1-4])$/.exec(g)
  if (!m) return []
  var sx = m[1].charAt(1) === "l" ? 1 : -1, sy = m[1].charAt(0) === "t" ? 1 : -1
  var x0 = sx > 0 ? 0.2 : 0.8, y0 = sy > 0 ? 0.2 : 0.8
  var dots = []
  for (var i = 0; i < Number(m[2]); i++) dots.push({ x: x0 + sx * i * 0.2, y: y0 + sy * i * 0.2 })
  return dots
}

function arrowList(dirs) {
  // Pinches are not lines: fingers moving towards / away from each other.
  if (dirs === "pinchin") return ["→←"]
  if (dirs === "pinchout") return ["←→"]
  if (dirs === "tap2") return ["••"]
  return String(dirs || "").split("").map(arrowFor).filter(function (a) { return a !== "" })
}

// "DR" -> "↓→"
function arrowText(dirs) { return arrowList(dirs).join("") }

// What releasing now would do, for the indicator: { name, valid }. `name` is "—" and
// `valid` false when nothing is bound (or the entry is "none").
function preview(event, windowInfo, config, l) {
  var hit = resolve(event, windowInfo, config)
  if (!hit) return { name: "—", valid: false }
  var name = actionName(hit.action, l)
  return { name: name, valid: name !== "—" }
}

// `hyprctl cursorpos -j` ({"x": 12, "y": 34}) or the plain "12, 34" form -> {x, y} or null.
function parseCursorPos(text) {
  var x, y
  try {
    var p = JSON.parse(text)
    x = Number(p.x)
    y = Number(p.y)
  } catch (e) {
    var m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(text))
    if (!m) return null
    x = Number(m[1])
    y = Number(m[2])
  }
  return isFinite(x) && isFinite(y) ? { x: x, y: y } : null
}

// ------------------------------------------------------------------- resolve

function stripTag(tag) { return String(tag).replace(/\*$/, "") }  // dynamic tags carry a trailing "*"

// Profile names for a window, most specific first, always ending with "default".
function profilesFor(windowInfo) {
  var tags = windowInfo && Array.isArray(windowInfo.tags) ? windowInfo.tags.map(stripTag) : []
  var out = []
  for (var i = 0; i < PROFILE_TAGS.length; i++) {
    for (var t = 0; t < PROFILE_TAGS[i].tags.length; t++) {
      if (tags.indexOf(PROFILE_TAGS[i].tags[t]) >= 0) { out.push(PROFILE_TAGS[i].profile); break }
    }
  }
  out.push("default")
  return out
}

// {source:"mouse"} / {source:"touchpad", fingers:3} + gesture -> "mouse:DR" / "tp3:DR".
// Returns "" for sources the plugin does not know.
function gestureKey(event) {
  if (!event) return ""
  var gesture = String(event.gesture || "")
  var prefix = ""
  if (event.source === "mouse" || event.source === undefined) prefix = "mouse"
  else if (event.source === "touchpad" && (event.fingers === 3 || event.fingers === 4)) prefix = "tp" + event.fingers
  else if (event.source === "tap") prefix = "tap"
  if (!prefix || !GESTURE_KEY_PATTERN.test(prefix + ":" + gesture)) return ""
  return prefix + ":" + gesture
}

// The same check as EXPOSE_AVAILABLE_LUA for the shell (ring labels, settings hint):
// the plugin's manifest exists and shell.json does not list it as disabled.
function exposeAvailable(manifestExists, shellJsonText) {
  if (!manifestExists) return false
  var config = null
  try { config = JSON.parse(String(shellJsonText || "")) } catch (e) { config = null }
  var off = config && isList(config.disabledPlugins) ? toArray(config.disabledPlugins) : []
  return off.indexOf("expose.window-overview") < 0
}

// A daemon event as the settings' gesture editor takes it while recording:
// { source: "mouse" | "tp3" | "tp4" | "tap", gesture } or null (nothing bindable).
function recordedGesture(event) {
  var gesture = eventGesture(event)
  if (gesture === "") return null
  var key = gestureKey({ source: event.source, fingers: event.fingers, gesture: gesture })
  if (key === "") return null
  var i = key.indexOf(":")
  return { source: key.slice(0, i), gesture: key.slice(i + 1) }
}

// A gesture/action pair the settings accept: the swipe gesture takes only the Hyprland
// swipe (or none), and that action fits no other gesture.
function fitsGesture(gesture, raw) {
  var v = validateAction(raw)
  if (!v.ok) return false
  var isSwipe = v.action.type === "dispatch" && v.action.id === SWIPE_ACTION
  if (gesture === "swipe") return isSwipe || v.action.type === "none"
  return !isSwipe
}

// Daemon events -> gesture string: end{gesture}, wheel{dir}, rocker{side}.
function eventGesture(event) {
  if (!event) return ""
  if (event.type === "end") return String(event.gesture || "")
  if (event.type === "wheel") return event.dir === "up" ? "wheel-up" : event.dir === "down" ? "wheel-down" : ""
  if (event.type === "rocker") return event.side === "left" ? "rocker-left" : event.side === "right" ? "rocker-right" : ""
  return ""
}

// User bindings (config.bindings: profile -> gestureKey -> action) layered over the
// defaults per entry. An explicit {type:"none"} blocks inheritance; entries with a
// malformed gesture key or an invalid action are ignored so a typo cannot hide a default.
function mergeBindings(user) {
  // Defaults go through validateAction too, so resolve always returns canonical actions.
  var merged = defaultBindings()
  Object.keys(merged).forEach(function (profile) {
    Object.keys(merged[profile]).forEach(function (key) {
      merged[profile][key] = validateAction(merged[profile][key]).action
    })
  })
  if (!isPlainObject(user)) return merged
  Object.keys(user).forEach(function (profile) {
    if (!isPlainObject(user[profile])) return
    if (!merged[profile]) merged[profile] = {}
    Object.keys(user[profile]).forEach(function (key) {
      if (!GESTURE_KEY_PATTERN.test(key)) return
      var v = validateAction(user[profile][key])
      if (v.ok) merged[profile][key] = v.action
    })
  })
  return merged
}

// Looks up the action for a gesture event in the window's profiles.
// Order: profile (browser/terminal) before default; inside a profile "<source>:G"
// before "*:G". Returns { action, profile, key } or null when nothing is bound or
// the entry is {type:"none"}.
function resolve(event, windowInfo, config) {
  var key = gestureKey(event)
  if (!key) return null
  var gesture = key.slice(key.indexOf(":") + 1)
  var source = key.slice(0, key.indexOf(":"))
  var bindings = mergeBindings(config && config.bindings)
  var profiles = profilesFor(windowInfo)
  for (var i = 0; i < profiles.length; i++) {
    var table = bindings[profiles[i]]
    if (!table) continue
    var hit = table[source + ":" + gesture] || table["*:" + gesture]
    if (hit) {
      if (hit.type === "none") return null
      return { action: hit, profile: profiles[i], key: key }
    }
  }
  return null
}

// ------------------------------------------------------------------ exclusions

// list entries match the window class (case-insensitive) or a tag; trailing "*" = prefix.
function matchesPattern(pattern, value) {
  var p = String(pattern).toLowerCase()
  var v = String(value).toLowerCase()
  if (p === "") return false
  if (p.charAt(p.length - 1) === "*") return v.indexOf(p.slice(0, -1)) === 0
  return p === v
}

function isExcluded(windowInfo, list) {
  if (!windowInfo || !Array.isArray(list)) return false
  var cls = windowInfo.class || ""
  var tags = Array.isArray(windowInfo.tags) ? windowInfo.tags.map(stripTag) : []
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i] !== "string") continue
    if (cls && matchesPattern(list[i], cls)) return true
    for (var t = 0; t < tags.length; t++) if (matchesPattern(list[i], tags[t])) return true
  }
  return false
}

// hyprctl activewindow -j text -> { class, tags } ("{}" or garbage -> empty window).
function parseActiveWindow(text) {
  try {
    var w = JSON.parse(text)
    return {
      class: isPlainObject(w) && typeof w.class === "string" ? w.class : "",
      tags: isPlainObject(w) && Array.isArray(w.tags) ? w.tags.filter(function (t) { return typeof t === "string" }) : []
    }
  } catch (e) {
    return { class: "", tags: [] }
  }
}

if (typeof module !== "undefined") module.exports = {
  KEY_HOLD_MS: KEY_HOLD_MS, SEQUENCE_GAP_MS: SEQUENCE_GAP_MS, MAX_SEQUENCE: MAX_SEQUENCE,
  MODIFIERS: MODIFIERS, DISPATCH: DISPATCH, RING_SLOTS: RING_SLOTS, RING_KEYS: RING_KEYS, RING_COUNTS: RING_COUNTS, ringDefaultsList: ringDefaultsList, RESTORE_DESKTOPS_LUA: RESTORE_DESKTOPS_LUA, DEFAULT_EXCLUDES: DEFAULT_EXCLUDES,
  GESTURE_KEY_PATTERN: GESTURE_KEY_PATTERN, KEY_PATTERN: KEY_PATTERN,
  defaultBindings: defaultBindings, mergeBindings: mergeBindings,
  parseModifiers: parseModifiers, parseCombo: parseCombo,
  validateAction: validateAction, buildCommand: buildCommand, internalOf: internalOf, keysLua: keysLua,
  EXPOSE_AVAILABLE_LUA: EXPOSE_AVAILABLE_LUA, exposeAvailable: exposeAvailable,
  dispatchName: dispatchName, notificationText: notificationText,
  recordedGesture: recordedGesture, fitsGesture: fitsGesture, SWIPE_ACTION: SWIPE_ACTION, tapDots: tapDots,
  actionName: actionName, keysText: keysText,
  INDICATOR_MODES: INDICATOR_MODES, normalizeIndicator: normalizeIndicator,
  arrowFor: arrowFor, arrowList: arrowList, arrowText: arrowText, tapText: tapText, SOURCES: SOURCES,
  preview: preview, parseCursorPos: parseCursorPos,
  profilesFor: profilesFor, gestureKey: gestureKey, eventGesture: eventGesture, resolve: resolve,
  isExcluded: isExcluded, parseActiveWindow: parseActiveWindow
}
