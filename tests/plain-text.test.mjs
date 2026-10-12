// Texts can carry data from the settings file or the user (action names and labels,
// commands, exclusions, key combinations, the change log): with Qt's default AutoText
// a crafted label holding HTML would be rendered as rich text and could load a remote
// image. So every Text element of the plugin's own QML sets `textFormat: Text.PlainText`
// (the shell's Ui components already do). An element that really needs rich text
// explains itself in a `// rich text:` comment inside it.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const opener = /^(\s*)(?:(?:component \w+|property \w+ \w+|\w+): )?Text \{\s*$/

// The element's own lines (not its children's).
function ownLines(lines, start) {
  const own = []
  for (let depth = 1, i = start + 1; i < lines.length && depth > 0; i++) {
    if (depth === 1) own.push(lines[i])
    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length
  }
  return own
}

test("every Text in the plugin's QML is plain text", () => {
  let count = 0
  for (const name of readdirSync(root).filter((n) => n.endsWith(".qml"))) {
    const lines = readFileSync(join(root, name), "utf8").split("\n")
    lines.forEach((line, i) => {
      if (!opener.test(line)) return
      count++
      const own = ownLines(lines, i)
      assert.ok(own.some((l) => /textFormat:\s*Text\.PlainText/.test(l) || /\/\/ rich text:/.test(l)),
        `${name}:${i + 1} Text without textFormat: Text.PlainText`)
    })
  }
  assert.ok(count > 20, "found the Text elements")
})

test("notifications escape markup", () => {
  const service = readFileSync(join(root, "Service.qml"), "utf8")
  const calls = service.match(/execDetached\(\["omarchy-notification-send"[\s\S]*?\]\)/g) || []
  assert.ok(calls.length >= 2, "notification calls found")
  for (const call of calls) assert.match(call, /Actions\.notificationText\(/)
})

// Nothing a gesture is bound to may run while the session is locked (marketplace review
// of 1.0.0): every place that starts an action or opens the ring goes through the gate.
test("actions and the ring only start through the lock gate", () => {
  const service = readFileSync(join(root, "Service.qml"), "utf8")
  const direct = service.split("\n").filter((l) =>
    /execDetached\(cmd\.argv\)|ring\.open\(\)/.test(l) && !/whenUnlocked\(function/.test(l))
  assert.deepEqual(direct, [])
})
