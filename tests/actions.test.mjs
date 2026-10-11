import test from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"

// Through the shared loader: it strips the QML-only pragma and resolves `.import` lines
// (Actions.js imports I18n.js for the names in other languages).
const A = load("Actions.js")

const browser = { class: "chromium", tags: ["chromium-based-browser", "default-opacity*"] }
const term = { class: "Alacritty", tags: ["terminal*"] }
const plain = { class: "nautilus", tags: [] }
const mouse = (gesture) => ({ source: "mouse", gesture })

test("profilesFor: tags decide, dynamic suffix ignored, default last", () => {
  assert.deepEqual(A.profilesFor(browser), ["browser", "default"])
  assert.deepEqual(A.profilesFor({ tags: ["firefox-based-browser"] }), ["browser", "default"])
  assert.deepEqual(A.profilesFor(term), ["terminal", "default"])
  assert.deepEqual(A.profilesFor(plain), ["default"])
  assert.deepEqual(A.profilesFor(null), ["default"])
  assert.deepEqual(A.profilesFor({ tags: "terminal" }), ["default"])
})

test("gestureKey: source prefixes, unknown input rejected", () => {
  assert.equal(A.gestureKey(mouse("DR")), "mouse:DR")
  assert.equal(A.gestureKey({ source: "touchpad", fingers: 3, gesture: "L" }), "tp3:L")
  assert.equal(A.gestureKey({ source: "touchpad", fingers: 4, gesture: "UD" }), "tp4:UD")
  assert.equal(A.gestureKey({ source: "touchpad", fingers: 2, gesture: "L" }), "")
  assert.equal(A.gestureKey(mouse("X")), "")
  assert.equal(A.gestureKey(mouse("LRLRLR")), "")
  assert.equal(A.gestureKey(null), "")
})

test("eventGesture maps daemon events", () => {
  assert.equal(A.eventGesture({ type: "end", gesture: "DR" }), "DR")
  assert.equal(A.eventGesture({ type: "wheel", dir: "up" }), "wheel-up")
  assert.equal(A.eventGesture({ type: "wheel", dir: "down" }), "wheel-down")
  assert.equal(A.eventGesture({ type: "rocker", side: "left" }), "rocker-left")
  assert.equal(A.eventGesture({ type: "cancel" }), "")
  assert.equal(A.eventGesture({ type: "wheel", dir: "sideways" }), "")
})

const combo = (a) => A.keysText(A.validateAction(a).action.sequence, "en")

test("gesture language: one meaning for every shape", () => {
  const id = (g, w = plain) => A.resolve(mouse(g), w, {}).action
  assert.equal(combo(id("L")), "Alt+Left")
  assert.equal(combo(id("R")), "Alt+Right")
  assert.deepEqual(id("U"), { type: "dispatch", id: "stack-up" })
  assert.deepEqual(id("D"), { type: "dispatch", id: "stack-down" })
  assert.deepEqual(id("UL"), { type: "dispatch", id: "workspace-prev" })
  assert.deepEqual(id("UR"), { type: "dispatch", id: "workspace-next" })
  assert.equal(combo(id("DR")), "Ctrl+W")
  assert.deepEqual(id("DL"), { type: "dispatch", id: "window-close" })
  assert.deepEqual(id("DLU"), { type: "dispatch", id: "window-to-workspace-prev" })
  assert.deepEqual(id("DRU"), { type: "dispatch", id: "window-to-workspace-next" })
  assert.equal(combo(id("DU")), "Ctrl+T")
  assert.equal(combo(id("LU")), "Ctrl+Shift+T")
  assert.equal(combo(id("UD")), "F5")
  assert.deepEqual(id("RU"), { type: "dispatch", id: "window-fullscreen" })
})

test("gesture language: the same shapes in the browser, mouse and three fingers alike", () => {
  const tp3 = (g) => ({ source: "touchpad", fingers: 3, gesture: g })
  for (const g of ["L", "R", "U", "D", "UL", "UR", "DR", "DL", "DLU", "DRU", "DU", "LU", "UD", "RU"]) {
    const m = A.resolve(mouse(g), browser, {})
    assert.deepEqual(m.action, A.resolve(mouse(g), plain, {}).action, g)
    assert.deepEqual(A.resolve(tp3(g), browser, {}).action, m.action, g)
  }
})

test("terminal: close tab is Ctrl+Shift+W, everything else shared", () => {
  const dr = A.resolve(mouse("DR"), term, {})
  assert.equal(dr.profile, "terminal")
  assert.equal(combo(dr.action), "Ctrl+Shift+W")
  assert.equal(A.resolve(mouse("L"), term, {}).profile, "default")
  assert.equal(A.resolve(mouse("DL"), term, {}).action.id, "window-close")
})

test("wheel and rocker defaults", () => {
  const w = (g, win) => A.resolve(mouse(g), win, {}).action
  assert.deepEqual(w("wheel-down", plain), { type: "dispatch", id: "workspace-next" })
  assert.equal(combo(w("wheel-down", browser)), "Ctrl+Tab")
  assert.equal(combo(w("wheel-up", browser)), "Ctrl+Shift+Tab")
  assert.equal(combo(w("rocker-left", browser)), "Alt+Left")
  assert.equal(combo(w("rocker-right", plain)), "Alt+Right")
})

test("source fallback: specific source beats *, * covers all sources", () => {
  const config = { bindings: { default: { "tp3:DR": { type: "none" }, "tp4:L": { type: "dispatch", id: "focus-left" } } } }
  const tp = (fingers, gesture) => ({ source: "touchpad", fingers, gesture })
  // "*:DR" is the shared binding: mouse and tp4 use it, tp3 is blocked by an explicit none.
  assert.equal(A.resolve(mouse("DR"), plain, config).action.label, "close-tab")
  assert.equal(A.resolve(tp(4, "DR"), plain, config).action.label, "close-tab")
  assert.equal(A.resolve(tp(3, "DR"), plain, config), null)
  assert.equal(A.resolve(tp(4, "L"), plain, config).action.id, "focus-left")
  assert.equal(A.resolve(tp(3, "L"), plain, config).action.label, "back")
})

test("profile beats source specificity of the default profile", () => {
  const config = { bindings: { default: { "mouse:wheel-up": { type: "dispatch", id: "focus-left" } } } }
  assert.equal(A.resolve(mouse("wheel-up"), plain, config).action.id, "focus-left")
  // browser has "*:wheel-up", which wins over the default profile's "mouse:wheel-up".
  assert.equal(A.resolve(mouse("wheel-up"), browser, config).profile, "browser")
})

test("user config: explicit none blocks inheritance, invalid entries are ignored", () => {
  const config = {
    bindings: {
      browser: { "*:U": { type: "none" }, "*:L": { type: "keys", combo: ["CTRL", "T\"})"] }, "not a key": { type: "none" } },
      default: { "*:UL": "oops" }
    }
  }
  assert.equal(A.resolve(mouse("U"), browser, config), null)
  assert.equal(A.resolve(mouse("L"), browser, config).action.type, "keys")
  assert.equal(A.resolve(mouse("L"), browser, config).action.sequence[0].key, "Left")
  assert.equal(A.resolve(mouse("UL"), plain, config).action.id, "workspace-prev")
  assert.equal(A.resolve(mouse("wheel-up"), browser, { bindings: "garbage" }).profile, "browser")
})

test("parseModifiers: allow-list, canonical order, separators", () => {
  assert.deepEqual(A.parseModifiers("shift ctrl"), ["CTRL", "SHIFT"])
  assert.deepEqual(A.parseModifiers("CTRL+ALT+SUPER"), ["SUPER", "CTRL", "ALT"])
  assert.deepEqual(A.parseModifiers(["alt", "alt"]), ["ALT"])
  assert.deepEqual(A.parseModifiers(""), [])
  assert.deepEqual(A.parseModifiers(null), [])
  assert.equal(A.parseModifiers("CTRL META"), null)
  assert.equal(A.parseModifiers("CTRL; os.execute"), null)
  assert.equal(A.parseModifiers(["CTRL", 5]), null)
  assert.equal(A.parseModifiers({}), null)
})

test("validateAction: keys", () => {
  const ok = A.validateAction({ type: "keys", combo: ["ctrl shift", "T"] })
  assert.ok(ok.ok)
  assert.deepEqual(ok.action.sequence, [{ mods: ["CTRL", "SHIFT"], key: "T" }])
  for (const key of ["T ", "", "a-b", "a.b", "ä", "A\nB", 'T"', "T)", "a b", "x".repeat(33), 5, null, ["T"]])
    assert.equal(A.validateAction({ type: "keys", combo: ["CTRL", key] }).ok, false, JSON.stringify(key))
  assert.equal(A.validateAction({ type: "keys", combo: ["CTRL"] }).ok, false)
  assert.equal(A.validateAction({ type: "keys" }).ok, false)
  assert.ok(A.validateAction({ type: "keys", combo: ["", "XF86AudioPlay"] }).ok)
  assert.ok(A.validateAction({ type: "keys", combo: ["", "F24"] }).ok)
})

test("validateAction: sequence limit of 4", () => {
  const c = ["CTRL", "K"]
  assert.ok(A.validateAction({ type: "keys", sequence: [c, c, c, c] }).ok)
  assert.equal(A.validateAction({ type: "keys", sequence: [c, c, c, c, c] }).ok, false)
  assert.equal(A.validateAction({ type: "keys", sequence: [] }).ok, false)
  assert.equal(A.validateAction({ type: "keys", sequence: [c, ["CTRL", "x y"]] }).ok, false)
  assert.equal(A.validateAction({ type: "keys", sequence: "CTRL K" }).ok, false)
})

test("validateAction: other types", () => {
  assert.ok(A.validateAction({ type: "none" }).ok)
  assert.ok(A.validateAction({ type: "dispatch", id: "window-close" }).ok)
  assert.equal(A.validateAction({ type: "dispatch", id: "hl.dsp.exit()" }).ok, false)
  assert.equal(A.validateAction({ type: "dispatch", id: "__proto__" }).ok, false)
  assert.equal(A.validateAction({ type: "dispatch", id: "constructor" }).ok, false)
  assert.equal(A.validateAction({ type: "dispatch", lua: "hl.dsp.exit()" }).ok, false)
  assert.equal(A.validateAction({ type: "exec", command: "  " }).ok, false)
  assert.equal(A.validateAction({ type: "exec", command: "x".repeat(501) }).ok, false)
  assert.equal(A.validateAction({ type: "exec", command: "a\u0000b" }).ok, false)
  assert.equal(A.validateAction({ type: "lua", code: "x" }).ok, false)
  assert.equal(A.validateAction("keys").ok, false)
  assert.equal(A.validateAction(null).ok, false)
  assert.equal(A.validateAction([]).ok, false)
})

test("validateAction drops unknown fields", () => {
  const v = A.validateAction({ type: "dispatch", id: "window-close", lua: "evil()", extra: 1 })
  assert.deepEqual(v.action, { type: "dispatch", id: "window-close" })
})

test("buildCommand: dispatch", () => {
  assert.deepEqual(A.buildCommand({ type: "dispatch", id: "workspace-prev" }), {
    argv: ["hyprctl", "eval", 'hl.dispatch(hl.dsp.focus({ workspace = "e-1" }))']
  })
})

test("buildCommand: keys, single combo like clipboard.lua", () => {
  const cmd = A.buildCommand({ type: "keys", combo: ["CTRL", "W"] })
  assert.equal(cmd.argv[0], "hyprctl")
  assert.equal(cmd.argv[1], "eval")
  const lua = cmd.argv[2]
  assert.match(lua, /send_key_state\(\{ mods = m, key = key, state = "down" \}\)/)
  assert.match(lua, /send_key_state\(\{ mods = m, key = key, state = "up" \}\)/)
  assert.match(lua, /timeout = 50, type = "oneshot"/)
  assert.match(lua, /^k\("CTRL", "W"\)$/m)
  assert.equal(cmd.argv.length, 3)
})

test("buildCommand: key sequence is timed and ordered", () => {
  const cmd = A.buildCommand({ type: "keys", sequence: [["CTRL", "K"], ["CTRL", "S"], ["", "Return"]] })
  const lua = cmd.argv[2]
  assert.match(lua, /^k\("CTRL", "K"\)$/m)
  // 50 ms hold + 80 ms gap per step
  assert.match(lua, /k\("CTRL", "S"\) end, \{ timeout = 130,/)
  assert.match(lua, /k\("", "Return"\) end, \{ timeout = 260,/)
  assert.ok(lua.indexOf('"K"') < lua.indexOf('"S"') && lua.indexOf('"S"') < lua.indexOf('"Return"'))
})

test("buildCommand: modifiers emitted in canonical order", () => {
  const lua = A.buildCommand({ type: "keys", combo: ["shift alt ctrl super", "Tab"] }).argv[2]
  assert.match(lua, /k\("SUPER CTRL ALT SHIFT", "Tab"\)/)
})

test("buildCommand: exec runs through bash -lc, none builds nothing", () => {
  assert.deepEqual(A.buildCommand({ type: "exec", command: "omarchy-menu toggle apps" }), {
    argv: ["bash", "-lc", "omarchy-menu toggle apps"]
  })
  assert.equal(A.buildCommand({ type: "none" }), null)
  assert.equal(A.buildCommand(undefined), null)
})

// Everything the settings file could smuggle into a Lua chunk.
const injections = [
  'T"}) os.execute("touch /tmp/pwn") --',
  'T"); os.execute("x"); ("',
  "T') os.execute('x') --",
  "T\\",
  "T]]",
  "T\n os.execute('x')",
  "T --",
  "T;os.exit()",
  "T)",
  "a b",
  "$(id)",
  "`id`"
]

test("injection: key names never reach Lua", () => {
  for (const key of injections) {
    assert.equal(A.buildCommand({ type: "keys", combo: ["CTRL", key] }), null, key)
    assert.equal(A.buildCommand({ type: "keys", sequence: [["CTRL", "K"], ["CTRL", key]] }), null, key)
  }
})

test("injection: modifiers never reach Lua", () => {
  for (const mods of injections.concat(["CTRL\" , key = \"x", ["CTRL", 'ALT"})--'], "CTRL+SHIFT; x"]))
    assert.equal(A.buildCommand({ type: "keys", combo: [mods, "T"] }), null, JSON.stringify(mods))
})

test("injection: dispatch ids are looked up, not interpolated", () => {
  for (const id of injections.concat(["window-close\")) os.exit() --", "toString", "hasOwnProperty", "__proto__"]))
    assert.equal(A.buildCommand({ type: "dispatch", id }), null, id)
})

test("injection: generated Lua only contains validated tokens", () => {
  // Property check over a grid of inputs: whatever builds must match the strict shape.
  const mods = ["", "ctrl", "ctrl shift", "SUPER ALT", "x", 'CTRL"']
  const keyset = ["T", "F5", "XF86AudioPlay", "Left", 'T"', "a b", ""]
  const allowed = /^(local function k\(m, key\)\n  hl\.dispatch\(hl\.dsp\.send_key_state\(\{ mods = m, key = key, state = "down" \}\)\)\n  hl\.timer\(function\(\)\n    hl\.dispatch\(hl\.dsp\.send_key_state\(\{ mods = m, key = key, state = "up" \}\)\)\n  end, \{ timeout = 50, type = "oneshot" \}\)\nend\n)(k\("[A-Z ]*", "[A-Za-z0-9_]+"\)\n|hl\.timer\(function\(\) k\("[A-Z ]*", "[A-Za-z0-9_]+"\) end, \{ timeout = \d+, type = "oneshot" \}\)\n)+$/
  for (const m of mods) for (const k of keyset) {
    const cmd = A.buildCommand({ type: "keys", combo: [m, k] })
    if (cmd) assert.match(cmd.argv[2], allowed, `${m} / ${k}`)
  }
})

test("injection: hyprctl gets Lua as a single argv element", () => {
  const cmd = A.buildCommand({ type: "keys", combo: ["CTRL", "T"] })
  assert.equal(cmd.argv.length, 3)
  assert.equal(cmd.argv.slice(0, 2).join(" "), "hyprctl eval")
})

test("keysLua refuses unsafe values even when called directly", () => {
  assert.throws(() => A.keysLua([{ mods: ["CTRL"], key: 'T"})' }]))
  assert.throws(() => A.keysLua([{ mods: ['CTRL"'], key: "T" }]))
})

test("actionName: de and en", () => {
  assert.equal(A.actionName({ type: "dispatch", id: "workspace-prev" }, "de_DE"), "Arbeitsfläche links")
  assert.equal(A.actionName({ type: "dispatch", id: "workspace-prev" }, "en_US"), "Workspace left")
  assert.equal(A.actionName({ type: "keys", combo: ["CTRL SHIFT", "T"] }, "de"), "Strg+Umschalt+T")
  assert.equal(A.actionName({ type: "keys", combo: ["CTRL SHIFT", "T"] }, "en"), "Ctrl+Shift+T")
  assert.equal(A.actionName({ type: "keys", combo: ["ALT", "Left"], label: "back" }, "de"), "Zurück (Alt+Left)")
  assert.equal(A.actionName({ type: "keys", combo: ["ALT", "Left"], label: "back" }, "en"), "Back (Alt+Left)")
  assert.equal(A.actionName({ type: "keys", sequence: [["CTRL", "K"], ["CTRL", "S"]] }, "en"), "Ctrl+K, Ctrl+S")
  assert.equal(A.actionName({ type: "exec", command: "foo --bar" }, "en"), "foo --bar")
  assert.equal(A.actionName({ type: "exec", command: "foo", label: "launcher" }, "de"), "App-Launcher")
  assert.equal(A.actionName({ type: "exec", command: "foo", label: "My thing" }, "de"), "My thing")
  assert.equal(A.actionName({ type: "none" }, "en"), "—")
  assert.equal(A.actionName({ type: "bogus" }, "en"), "—")
  assert.equal(A.actionName(null, undefined), "—")
})

test("every default action is valid and has a name in both languages", () => {
  const table = A.defaultBindings()
  for (const profile of Object.keys(table)) for (const [key, action] of Object.entries(table[profile])) {
    assert.ok(A.validateAction(action).ok, `${profile} ${key}`)
    for (const l of ["en", "de"]) assert.ok(A.actionName(action, l).length > 0, `${profile} ${key} ${l}`)
    assert.match(key, /^(\*|mouse|tp3|tp4|tap):/)
  }
  for (const [id, d] of Object.entries(A.DISPATCH)) {
    // Either a single dispatcher expression or a fixed multi-line chunk (show desktop,
    // hyprexpo) that is passed to `hyprctl eval` as is.
    if (d.internal) assert.ok(["ring", "swipe"].includes(d.internal), id)
    else if (d.chunk) assert.match(d.chunk, /^(local |for |if #|hl\.exec_cmd\("[a-z -]+"\)$)/, id)
    else assert.match(d.lua, /^hl\.dsp\.[a-z_.]+\(.*\)$/, id)
  }
})

test("pinch gestures and trackpad defaults resolve", () => {
  const cfg = { bindings: {} }
  const ev = (fingers, gesture) => ({ type: "end", source: "touchpad", fingers, gesture })
  assert.equal(A.gestureKey(ev(4, "pinchout")), "tp4:pinchout")
  assert.equal(A.resolve(ev(4, "pinchout"), {}, cfg).action.id, "hyprexpo")
  assert.equal(A.resolve(ev(4, "D"), {}, cfg).action.id, "stack-down")
  assert.equal(A.resolve(ev(4, "U"), {}, cfg).action.id, "stack-up")
  // Three fingers fall back to the shared "*:" table, in the browser to back/forward.
  assert.equal(A.resolve(ev(3, "L"), { tags: ["chromium-based-browser"] }, cfg).action.label, "back")
  assert.deepEqual(A.arrowList("pinchin"), ["→←"])
})

test("chunk dispatchers are passed through unchanged", () => {
  const cmd = A.buildCommand({ type: "dispatch", id: "show-desktop" })
  assert.equal(cmd.argv[0], "hyprctl")
  assert.equal(cmd.argv[2], A.DISPATCH["show-desktop"].chunk)
  assert.match(cmd.argv[2], /special:more-gestures-desktop-/)
})

test("isExcluded: class, tag, prefix, case", () => {
  const list = ["steam_app_*", "retroarch", "qemu*", "terminal"]
  assert.equal(A.isExcluded({ class: "steam_app_1234", tags: [] }, list), true)
  assert.equal(A.isExcluded({ class: "RetroArch", tags: [] }, list), true)
  assert.equal(A.isExcluded({ class: "qemu-system-x86_64", tags: [] }, list), true)
  assert.equal(A.isExcluded({ class: "Alacritty", tags: ["terminal*"] }, list), true)
  assert.equal(A.isExcluded({ class: "steam", tags: [] }, list), false)
  assert.equal(A.isExcluded({ class: "firefox", tags: ["firefox-based-browser"] }, list), false)
  assert.equal(A.isExcluded({ class: "", tags: [] }, [""]), false)
  assert.equal(A.isExcluded({ class: "x", tags: [] }, null), false)
  assert.equal(A.isExcluded(null, list), false)
  assert.equal(A.isExcluded({ class: "steam_app_1", tags: [] }, A.DEFAULT_EXCLUDES), true)
})

test("parseActiveWindow tolerates empty and broken output", () => {
  assert.deepEqual(A.parseActiveWindow('{"class":"kitty","tags":["terminal*",3]}'), { class: "kitty", tags: ["terminal*"] })
  assert.deepEqual(A.parseActiveWindow("{}"), { class: "", tags: [] })
  assert.deepEqual(A.parseActiveWindow(""), { class: "", tags: [] })
  assert.deepEqual(A.parseActiveWindow("Invalid"), { class: "", tags: [] })
  assert.deepEqual(A.parseActiveWindow("null"), { class: "", tags: [] })
})

test("arrows: directions become arrows, unknown letters are dropped", () => {
  assert.equal(A.arrowText("DR"), "↓→")
  assert.equal(A.arrowText("ULDR"), "↑←↓→")
  assert.deepEqual(A.arrowList("RX"), ["→"])
  assert.equal(A.arrowFor("toString"), "")
  assert.equal(A.arrowText(undefined), "")
})

test("normalizeIndicator: known modes pass, everything else is full", () => {
  for (const m of ["off", "minimal", "full"]) assert.equal(A.normalizeIndicator(m), m)
  for (const bad of [undefined, null, "", "FULL", 1, {}]) assert.equal(A.normalizeIndicator(bad), "full")
})

test("preview: name and validity for the indicator", () => {
  assert.deepEqual(A.preview(mouse("UL"), plain, {}, "en"), { name: "Workspace left", valid: true })
  assert.deepEqual(A.preview(mouse("DR"), browser, {}, "de"), { name: "Tab schließen (Strg+W)", valid: true })
  assert.deepEqual(A.preview(mouse("LU"), browser, {}, "en"), { name: "Reopen closed tab (Ctrl+Shift+T)", valid: true })
  // unbound -> dash, not valid
  assert.deepEqual(A.preview(mouse("LRL"), plain, {}, "en"), { name: "—", valid: false })
  // explicit "none" counts as unknown too
  const cfg = { bindings: { default: { "*:L": { type: "none" } } } }
  assert.deepEqual(A.preview(mouse("L"), plain, cfg, "en"), { name: "—", valid: false })
  // unknown source
  assert.deepEqual(A.preview({ source: "pen", gesture: "L" }, plain, {}, "en"), { name: "—", valid: false })
})

test("preview: key combination without label shows the combination", () => {
  const cfg = { bindings: { default: { "*:LRL": { type: "keys", combo: ["CTRL SHIFT", "T"] } } } }
  assert.equal(A.preview(mouse("LRL"), plain, cfg, "de").name, "Strg+Umschalt+T")
  assert.equal(A.preview(mouse("LRL"), plain, cfg, "en").name, "Ctrl+Shift+T")
})

test("parseCursorPos: JSON, plain text, garbage", () => {
  assert.deepEqual(A.parseCursorPos('{"x": 1234, "y": 567}'), { x: 1234, y: 567 })
  assert.deepEqual(A.parseCursorPos("-12, 34\n"), { x: -12, y: 34 })
  assert.deepEqual(A.parseCursorPos("1.5,2"), { x: 1.5, y: 2 })
  for (const bad of ["", "null", "12", "{}", "a, b", '{"x":"q","y":1}']) assert.equal(A.parseCursorPos(bad), null)
})

test("corner taps resolve to workspaces", () => {
  const cfg = { bindings: {} }
  const tap = (gesture) => ({ type: "end", source: "tap", gesture })
  assert.equal(A.gestureKey(tap("tl2")), "tap:tl2")
  assert.equal(A.resolve(tap("tl2"), {}, cfg).action.id, "workspace-1")
  assert.equal(A.resolve(tap("br2"), {}, cfg).action.id, "workspace-4")
  assert.equal(A.resolve(tap("tl3"), {}, cfg).action.id, "workspace-5")
  assert.equal(A.resolve(tap("br3"), {}, cfg).action.id, "workspace-8")
  // Tap names only exist with the tap source, and lines never with it.
  assert.equal(A.GESTURE_KEY_PATTERN.test("*:tl2"), false)
  assert.equal(A.GESTURE_KEY_PATTERN.test("tap:L"), false)
  assert.equal(A.tapText("tr3"), "↗ 3×")
})

test("restore chunk targets only our stash workspaces", () => {
  assert.match(A.RESTORE_DESKTOPS_LUA, /more%-gestures%-desktop%-/)
  assert.match(A.RESTORE_DESKTOPS_LUA, /^local active = hl\.get_active_workspace\(\)/)
})

test("workspace actions restore that workspace's stash before switching", () => {
  const lua = A.DISPATCH["workspace-3"].chunk
  assert.match(lua, /special:more-gestures-desktop-3/)
  assert.match(lua, /hl\.dsp\.focus\(\{ workspace = "3" \}\)\)$/)
})

test("workspace actions close an open Exposé so the windows show", () => {
  const lua = A.DISPATCH["workspace-1"].chunk
  assert.match(lua, /namespace = "expose-window-overview"/)
  assert.ok(lua.indexOf("expose close") < lua.indexOf("hl.dsp.focus"))
})

test("4-finger double tap opens the ring inside the shell", () => {
  const ev = { type: "end", source: "touchpad", fingers: 4, gesture: "tap2" }
  assert.equal(A.gestureKey(ev), "tp4:tap2")
  const hit = A.resolve(ev, {}, { bindings: {} })
  assert.equal(A.internalOf(hit.action), "ring")
  assert.equal(A.buildCommand(hit.action), null)
  assert.equal(A.GESTURE_KEY_PATTERN.test("tp3:tap2"), false)
})

test("five-stroke shapes can be bound", () => {
  assert.equal(A.gestureKey(mouse("DRDLU")), "mouse:DRDLU")
  const cfg = { bindings: { default: { "*:DRDLU": { type: "dispatch", id: "files" } } } }
  assert.equal(A.resolve(mouse("DRDLU"), plain, cfg).action.id, "files")
})

test("ring defaults: three rings, slots and keys match their counts", () => {
  const rings = A.ringDefaultsList()
  assert.equal(rings.length, 3)
  rings.forEach((r, i) => {
    assert.ok(A.RING_COUNTS[i].includes(r.count), String(i))
    assert.equal(r.slots.length, r.count)
    assert.equal(r.keys.length, r.count)
    r.slots.forEach(s => assert.ok(A.validateAction(s).ok))
  })
  const keys = rings.flatMap(r => r.keys).filter(k => k)
  assert.equal(new Set(keys).size, keys.length)
})

// QML passes arrays from `var` properties and Repeater modelData as sequences that are
// not real arrays; the settings listed every key combination as "—" because of it.
test("key actions validate when their lists are array-likes from QML", () => {
  const seq = (...items) => { const o = { length: items.length }; items.forEach((v, i) => { o[i] = v }); return o }
  const action = { type: "keys", sequence: seq({ mods: seq("ALT"), key: "Left" }), label: "back" }
  const v = A.validateAction(action)
  assert.equal(v.ok, true)
  assert.deepEqual(v.action.sequence, [{ mods: ["ALT"], key: "Left" }])
  assert.match(A.actionName(action, "en"), /Alt\+Left/)
})

test("move window under the pointer: the ring's point goes into the Lua, numbers only", () => {
  const a = { type: "dispatch", id: "window-to-workspace-silent-3" }
  const plain = A.buildCommand(a).argv[2]
  assert.match(plain, /^local p = hl\.get_cursor_pos\(\)/)
  assert.match(plain, /workspace = "3", follow = false, window = best/)
  const at = A.buildCommand(a, { x: 812.25, y: 40 }).argv[2]
  assert.match(at, /^local px, py = 812\.3, 40\.0\n/)
  assert.ok(!/get_cursor_pos/.test(at))
  // Anything but finite numbers falls back to the pointer.
  assert.equal(A.buildCommand(a, { x: "1); os.exit(", y: 2 }).argv[2], plain)
  // Other actions ignore the point.
  assert.equal(A.buildCommand({ type: "dispatch", id: "workspace-3" }, { x: 1, y: 2 }).argv[2],
    A.DISPATCH["workspace-3"].chunk)
})

// Without the Exposé plugin the defaults still act: the launcher instead.
test("Exposé falls back to the app launcher; Hyprexpo to Exposé, then the launcher", () => {
  const ex = A.DISPATCH.expose.chunk
  assert.match(ex, /local function expose_available\(\)/)
  assert.match(ex, /if expose_available\(\) then hl\.dispatch\(hl\.dsp\.event\("expose\.window-overview:toggle"\)\) else hl\.exec_cmd\("omarchy-menu toggle apps"\) end$/)
  const up = A.DISPATCH["stack-up"].chunk
  assert.match(up, /expose_available\(\) then .* else hl\.exec_cmd\("omarchy-menu toggle apps"\) end$/)
  const hx = A.DISPATCH.hyprexpo.chunk
  assert.match(hx, /if x then x\.expo\("toggle"\)\nelseif expose_available\(\) then .*\nelse hl\.exec_cmd\("omarchy-menu toggle apps"\) end$/)
  assert.ok(!/notify-send/.test(hx))
})

test("exposeAvailable: installed and not disabled in shell.json", () => {
  assert.equal(A.exposeAvailable(false, "{}"), false)
  assert.equal(A.exposeAvailable(true, ""), true)
  assert.equal(A.exposeAvailable(true, '{"disabledPlugins":["x"]}'), true)
  assert.equal(A.exposeAvailable(true, '{"disabledPlugins":["expose.window-overview"]}'), false)
})

test("notification text: markup characters become look-alikes", () => {
  assert.equal(A.notificationText('<b>x</b> & "y"'), '\u2039b\u203ax\u2039/b\u203a \uff06 "y"')
  assert.equal(A.notificationText(undefined), "")
})
