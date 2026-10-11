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
    if (!root.config.bar.tooltip) return ""
    var tr = function (key) { return I18n.tr(root.lang, key) }
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
      color: button.foreground
      opacity: root.gesturesOn ? 1.0 : 0.35
    }

    onPressed: function(b) {
      var bar = root.config.bar
      if (b === Qt.RightButton) root.run(bar.right)
      else if (b === Qt.MiddleButton) root.run(bar.middle)
      else root.run(bar.left)
    }
  }
}
