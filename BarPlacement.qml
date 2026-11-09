import QtQuick
import Quickshell
import Quickshell.Io

// Where the widget sits (taken over from More Time's TimeBarPlacement.qml) in Omarchy's bar (left, middle, right or the tray's drawer),
// switched in the settings. The layout belongs to Omarchy: it is only read
// here, and a change goes through Omarchy's own `omarchy-bar move`, run when
// the user picks a section, never on its own.
QtObject {
  id: placement
  readonly property string widgetId: "more-gestures"
  // What the settings show: "left" | "center" | "right" | "tray", or "" when the widget
  // is not on the bar. Omarchy 4.5 splits the middle into centerBegin, center (the box
  // around the clock) and centerEnd; all three read as "center".
  property string section: ""
  // The section as Omarchy names it (one of sections).
  property string rawSection: ""
  readonly property var sections: ["left", "centerBegin", "center", "centerEnd", "right", "tray"]
  // A bar on the left or right screen edge runs top to bottom.
  property bool verticalBar: false
  property bool busy: false

  function readLayout(raw) {
    var found = ""
    var vertical = false
    try {
      var bar = (JSON.parse(String(raw || "")) || {}).bar || {}
      vertical = bar.position === "left" || bar.position === "right"
      var layout = bar.layout || {}
      for (var s = 0; s < sections.length && !found; ++s) {
        var entries = layout[sections[s]] || []
        for (var i = 0; i < entries.length; ++i)
          if (entries[i] && entries[i].id === widgetId) { found = sections[s]; break }
      }
    } catch (e) {
      found = ""
    }
    rawSection = found
    section = shown(found)
    verticalBar = vertical
  }

  function shown(raw) {
    return raw === "centerBegin" || raw === "centerEnd" ? "center" : raw
  }

  // "center" goes beside the clock box (centerEnd), as Omarchy places a manifest's
  // "center"; inside the box the widget would be centred together with the clock.
  function moveTo(target) {
    if (busy || !section || target === section) return
    var raw = { left: "left", center: "centerEnd", right: "right", tray: "tray" }[target]
    if (!raw) return
    busy = true
    moveProc.command = ["omarchy-bar", "move", widgetId, "--section", raw]
    moveProc.running = true
  }

  property FileView shellConfigView: FileView {
    path: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: readLayout(text())
    onLoadFailed: readLayout("")
  }

  property Process moveProc: Process {
    onExited: function(exitCode) {
      if (exitCode !== 0) console.warn("more-gestures: moving the bar widget failed with exit code", exitCode)
      busy = false
      shellConfigView.reload()
    }
  }
}
