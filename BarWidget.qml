import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Config.js" as Config

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
  readonly property string lang: Qt.locale().name
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
    var de = Actions.lang(root.lang) === "de"
    var state = root.gesturesOn ? (de ? "an" : "on") : (de ? "aus" : "off")
    var names = de
      ? { settings: "Einstellungen", toggle: "an/aus", status: "Status", ring: "Kreismenü", none: "" }
      : { settings: "settings", toggle: "on/off", status: "status", ring: "ring menu", none: "" }
    var b = root.config.bar
    var parts = []
    if (names[b.left]) parts.push((de ? "Links: " : "Left: ") + names[b.left])
    if (names[b.middle]) parts.push((de ? "Mitte: " : "Middle: ") + names[b.middle])
    if (names[b.right]) parts.push((de ? "Rechts: " : "Right: ") + names[b.right])
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
      width: Math.round(Style.font.body * 0.85)  // 1.05 looked too big next to the other icons
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
