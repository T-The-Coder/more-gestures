// QML refuses a property whose name starts with an upper-case letter ("Property names
// cannot begin with an upper case letter"), and the file then fails to load, taking
// whatever uses it along (BarPlacement took the whole settings window). The syntax
// check does not catch it; this does.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { root } from "./load.mjs"

function qmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return qmlFiles(path)
    return entry.name.endsWith(".qml") ? [path] : []
  })
}

test("no QML property name starts with an upper-case letter", () => {
  const found = qmlFiles(root).flatMap((path) =>
    readFileSync(path, "utf8").split("\n").flatMap((line, i) =>
      /^\s*(readonly\s+|required\s+|default\s+)*property\s+[\w<>.]+\s+[A-Z]/.test(line)
        ? [`${relative(root, path)}:${i + 1}: ${line.trim()}`] : []))
  assert.deepEqual(found, [])
})
