import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Actions.js starts with the QML-only `.pragma library` line, which is a syntax
// error under node; strip it and evaluate the rest like a CommonJS module.
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "Actions.js")
const source = readFileSync(file, "utf8").replace(/^\.pragma library\s*$/m, "")
const mod = { exports: {} }
new Function("module", source)(mod)
const A = mod.exports

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
  assert.equal(A.gestureKey(mouse("LRLRL")), "")
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

test("default table: desktop", () => {
  const id = (g, w = plain) => A.resolve(mouse(g), w, {}).action
  assert.deepEqual(id("L"), { type: "dispatch", id: "workspace-prev" })
  assert.deepEqual(id("R"), { type: "dispatch", id: "workspace-next" })
  assert.equal(id("U").type, "exec")
  assert.equal(id("D").type, "exec")
  assert.deepEqual(id("DR"), { type: "dispatch", id: "window-close" })
  assert.deepEqual(id("DU"), { type: "dispatch", id: "window-float-toggle" })
  assert.deepEqual(id("RU"), { type: "dispatch", id: "window-fullscreen" })
  assert.deepEqual(id("UL"), { type: "dispatch", id: "window-to-workspace-prev" })
  assert.deepEqual(id("UR"), { type: "dispatch", id: "window-to-workspace-next" })
  assert.equal(A.resolve(mouse("UD"), plain, {}), null)
})

test("default table: browser overrides and inherits", () => {
  const r = (g) => A.resolve(mouse(g), browser, {})
  assert.equal(r("L").profile, "browser")
  assert.equal(A.keysText(A.validateAction(r("L").action).action.sequence, "en"), "Alt+Left")
  assert.equal(A.keysText(A.validateAction(r("DR").action).action.sequence, "en"), "Ctrl+W")
  assert.equal(A.keysText(A.validateAction(r("LU").action).action.sequence, "en"), "Ctrl+Shift+T")
  assert.equal(A.keysText(A.validateAction(r("UD").action).action.sequence, "en"), "F5")
  // U is not set for the browser, so the desktop launcher applies.
  assert.equal(r("U").profile, "default")
  assert.equal(r("RU").profile, "default")
  // Duplicate tab is a two-step sequence.
  assert.equal(A.validateAction(r("DU").action).action.sequence.length, 2)
})

test("default table: terminal inherits L/R, DR closes the window", () => {
  assert.equal(A.resolve(mouse("L"), term, {}).profile, "default")
  const dr = A.resolve(mouse("DR"), term, {})
  assert.equal(dr.profile, "terminal")
  assert.equal(dr.action.type, "dispatch")
})

test("wheel and rocker defaults", () => {
  const w = (g, win) => A.resolve(mouse(g), win, {}).action
  assert.deepEqual(w("wheel-down", plain), { type: "dispatch", id: "workspace-next" })
  assert.equal(A.keysText(w("wheel-down", browser).sequence || A.validateAction(w("wheel-down", browser)).action.sequence, "en"), "Ctrl+Tab")
  assert.equal(A.keysText(A.validateAction(w("wheel-up", browser)).action.sequence, "en"), "Ctrl+Shift+Tab")
  assert.equal(A.keysText(A.validateAction(w("rocker-left", browser)).action.sequence, "en"), "Alt+Left")
  assert.deepEqual(w("rocker-right", plain), { type: "dispatch", id: "workspace-next" })
})

test("source fallback: specific source beats *, * covers all sources", () => {
  const config = { bindings: { default: { "tp3:DR": { type: "none" }, "tp4:L": { type: "dispatch", id: "focus-left" } } } }
  const tp = (fingers, gesture) => ({ source: "touchpad", fingers, gesture })
  // "*:DR" is the shared binding: mouse and tp4 use it, tp3 is blocked by an explicit none.
  assert.equal(A.resolve(mouse("DR"), plain, config).action.id, "window-close")
  assert.equal(A.resolve(tp(4, "DR"), plain, config).action.id, "window-close")
  assert.equal(A.resolve(tp(3, "DR"), plain, config), null)
  assert.equal(A.resolve(tp(4, "L"), plain, config).action.id, "focus-left")
  assert.equal(A.resolve(tp(3, "L"), plain, config).action.id, "workspace-prev")
})

test("profile beats source specificity of the default profile", () => {
  const config = { bindings: { default: { "mouse:L": { type: "dispatch", id: "focus-left" } } } }
  assert.equal(A.resolve(mouse("L"), plain, config).action.id, "focus-left")
  // browser has "*:L", which wins over the default profile's "mouse:L".
  assert.equal(A.resolve(mouse("L"), browser, config).profile, "browser")
})

test("user config: explicit none blocks inheritance, invalid entries are ignored", () => {
  const config = {
    bindings: {
      browser: { "*:U": { type: "none" }, "*:L": { type: "keys", combo: ["CTRL", "T\"})"] }, "not a key": { type: "none" } },
      default: { "*:L": "oops" }
    }
  }
  assert.equal(A.resolve(mouse("U"), browser, config), null)
  assert.equal(A.resolve(mouse("L"), browser, config).action.type, "keys")
  assert.equal(A.resolve(mouse("L"), browser, config).action.sequence[0].key, "Left")
  assert.equal(A.resolve(mouse("L"), plain, config).action.id, "workspace-prev")
  assert.equal(A.resolve(mouse("DR"), browser, { bindings: "garbage" }).profile, "browser")
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
    assert.match(key, /^(\*|mouse|tp3|tp4):/)
  }
  for (const [id, d] of Object.entries(A.DISPATCH)) {
    assert.ok(d.en && d.de, id)
    assert.match(d.lua, /^hl\.dsp\.[a-z_.]+\(.*\)$/, id)
  }
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
  assert.deepEqual(A.preview(mouse("L"), plain, {}, "en"), { name: "Workspace left", valid: true })
  assert.deepEqual(A.preview(mouse("DR"), browser, {}, "de"), { name: "Tab schließen (Strg+W)", valid: true })
  assert.deepEqual(A.preview(mouse("LU"), browser, {}, "en"), { name: "Reopen closed tab (Ctrl+Shift+T)", valid: true })
  // unbound on the desktop -> dash, not valid
  assert.deepEqual(A.preview(mouse("UD"), plain, {}, "en"), { name: "—", valid: false })
  // explicit "none" counts as unknown too
  const cfg = { bindings: { default: { "*:L": { type: "none" } } } }
  assert.deepEqual(A.preview(mouse("L"), plain, cfg, "en"), { name: "—", valid: false })
  // unknown source
  assert.deepEqual(A.preview({ source: "pen", gesture: "L" }, plain, {}, "en"), { name: "—", valid: false })
})

test("preview: key combination without label shows the combination", () => {
  const cfg = { bindings: { default: { "*:UD": { type: "keys", combo: ["CTRL SHIFT", "T"] } } } }
  assert.equal(A.preview(mouse("UD"), plain, cfg, "de").name, "Strg+Umschalt+T")
  assert.equal(A.preview(mouse("UD"), plain, cfg, "en").name, "Ctrl+Shift+T")
})

test("parseCursorPos: JSON, plain text, garbage", () => {
  assert.deepEqual(A.parseCursorPos('{"x": 1234, "y": 567}'), { x: 1234, y: 567 })
  assert.deepEqual(A.parseCursorPos("-12, 34\n"), { x: -12, y: 34 })
  assert.deepEqual(A.parseCursorPos("1.5,2"), { x: 1.5, y: 2 })
  for (const bad of ["", "null", "12", "{}", "a, b", '{"x":"q","y":1}']) assert.equal(A.parseCursorPos(bad), null)
})
