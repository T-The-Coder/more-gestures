import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Config.js" as Config
import "I18n.js" as I18n

// Menu bar icon: the inverted mouse symbol. Faded while gestures are off.
// Mouse buttons on it (settings: "Menu bar"): left settings, middle gestures on/off,
// right a status notification by default; each can also open the ring or do nothing.
//
// It reads the settings file itself (watched) and talks to the service over IPC
// (omarchy-shell), so the bar and the service stay separate plugin instances.
BarWidget {
  id: root
  moduleName: "more-gestures"

  property var config: Config.defaults(Actions)
  readonly property string lang: Config.uiLanguage(root.config, Qt.locale().name)
  readonly property bool gesturesOn: config.enabled

  visible: config.bar.show
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // Until the one-time setup is done gestures cannot work: the icon turns urgent and the
  // tooltip says so (the settings open on their Setup page). Checked on load and every
  // 10 s while missing; the check is a short Python run that opens no device.
  property var access: null
  readonly property bool setupNeeded: root.access !== null && !root.access.ready
  Process {
    id: accessCheck
    command: ["python3", decodeURIComponent(String(Qt.resolvedUrl("bin/gesture-daemon")).replace(/^file:\/\//, "")), "--check"]
    running: true
    stdout: StdioCollector { id: accessOut; waitForEnd: true }
    onExited: function() { root.access = Config.parseAccess(accessOut.text) }
  }
  Timer {
    interval: 10000
    repeat: true
    running: root.access === null || root.setupNeeded
    onTriggered: if (!accessCheck.running) accessCheck.running = true
  }

  FileView {
    path: Quickshell.env("HOME") + Config.PATH_SUFFIX
    watchChanges: true
    printErrors: false
    onLoaded: root.config = Config.parse(text(), Actions)
    onLoadFailed: root.config = Config.defaults(Actions)
    onFileChanged: reload()
  }

  function run(action) {
    if (action === "settings") Quickshell.execDetached(["omarchy-shell", "-q", "shell", "toggle", "more-gestures"])
    else if (action === "toggle") Quickshell.execDetached(["omarchy-shell", "-q", "more-gestures", "toggleSaved"])
    else if (action === "status") Quickshell.execDetached(["omarchy-shell", "-q", "more-gestures", "notifyStatus"])
    else if (action === "ring") Quickshell.execDetached(["omarchy-shell", "-q", "more-gestures", "openRing"])
  }

  function tooltip() {
    var tr = function (key) { return I18n.tr(root.lang, key) }
    if (root.setupNeeded) return "More Gestures: " + tr("setupNeeded")
    if (!root.config.bar.tooltip) return ""
    var state = tr(root.gesturesOn ? "stateOn" : "stateOff")
    var name = function (a) { return a && a !== "none" ? tr("tip_" + a) : "" }
    var b = root.config.bar
    var parts = []
    ;[["tipLeft", b.left], ["tipMiddle", b.middle], ["tipRight", b.right]].forEach(function (p) {
      var n = name(p[1])
      if (n) parts.push(tr(p[0]) + ": " + n)
    })
    return "More Gestures: " + state + (parts.length ? "\n" + parts.join(" · ") : "")
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    labelVisible: false
    hasVisualContent: root.visible
    fixedWidth: Style.bar.iconSlot
    tooltipText: root.tooltip()

    MouseGlyph {
      anchors.centerIn: parent
      width: Math.round(Style.font.body * 0.92)  // as tall as the font icons beside it (11 px at body 12)
      height: width
      inverted: true
      color: root.setupNeeded ? Color.urgent : button.foreground
      opacity: root.gesturesOn || root.setupNeeded ? 1.0 : 0.35
    }

    onPressed: function(b) {
      if (root.setupNeeded) { root.run("settings"); return }  // straight to the Setup page
      var bar = root.config.bar
      if (b === Qt.RightButton) root.run(bar.right)
      else if (b === Qt.MiddleButton) root.run(bar.middle)
      else root.run(bar.left)
    }
  }
}
