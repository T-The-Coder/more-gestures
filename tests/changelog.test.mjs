import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { load } from "./load.mjs"
const Changelog = load("Changelog.js")

// Settings → Update log reads CHANGELOG.md with the parser the More plugins share.
test("the change log parses into sections with items", () => {
  const sections = Changelog.parse(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"))
  assert.ok(sections.length >= 1)
  assert.ok(sections[0].unreleased || sections[0].version)
  assert.ok(sections[0].items.length > 0)
})

test("Changelog.js is the one More Time ships", { skip: !existsSibling() }, () => {
  const ours = readFileSync(new URL("../Changelog.js", import.meta.url), "utf8")
  const theirs = readFileSync(new URL("../../more-time/Changelog.js", import.meta.url), "utf8")
  assert.equal(ours, theirs)
})

function existsSibling() {
  try { readFileSync(new URL("../../more-time/Changelog.js", import.meta.url)); return true } catch (e) { return false }
}
