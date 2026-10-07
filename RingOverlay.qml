import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import "Actions.js" as Actions
import "Ring.js" as Ring

// Ring menu: double click with the trigger button and keep the second press held.
// A clock face of actions around the pointer (default: Exposé at 12, workspaces 1-5 at
// 1-5 o'clock, show desktop at 6, workspaces 6-0 at 7-11). Moving towards a slot
// highlights it, releasing runs it, releasing in the middle cancels. Workspaces 1-5
// always look normal, 6-0 are faded unless a window is on them.
//
// One surface that takes pointer input: the daemon held the button back, so no
// application has an implicit grab and the hover positions come straight from
// Hyprland (same trick as the gesture trail). It goes away the moment the button is
// released, so the next click reaches the application below.
Item {
  id: root

  property string lang: "en"
  property var slots: Actions.RING_SLOTS
  readonly property int count: slots.length

  property bool opened: false
  // Set on open, cleared on close: hyprctl may answer after the button is already up,
  // and the ring must not appear then.
  property bool armed: false
  property var targetScreen: null
  property real cx: 0
  property real cy: 0
  property real px: 0
  property real py: 0
  property bool havePointer: false
  property var occupied: []
  property int current: 0

  readonly property real radius: Style.space(110)
  readonly property real deadzone: radius * 0.35
  readonly property int rawSelected: havePointer ? Ring.sectorFor(px - cx, py - cy, deadzone, count) : -1
  // An empty slot cannot be picked: releasing there cancels like the middle.
  readonly property int selected: rawSelected >= 0 && slots[rawSelected].type !== "none" ? rawSelected : -1

  function open() {
    root.armed = true
    root.havePointer = false
    root.current = Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : 0
    if (!cursorProbe.running) cursorProbe.running = true
    if (!workspaceProbe.running) workspaceProbe.running = true
  }

  // Returns the chosen slot's action, or null when cancelled.
  function close() {
    var pick = root.opened && root.selected >= 0 ? root.slots[root.selected] : null
    root.armed = false
    root.opened = false
    safety.stop()
    return pick
  }

  // "Exposé (all windows)" -> "Exposé": the ring has little room, the part in brackets
  // is explanation for the settings list.
  function shortName(action) {
    return Actions.actionName(action, root.lang).replace(/\s*\(.*\)\s*$/, "")
  }

  function cancel() {
    root.armed = false
    root.opened = false
    safety.stop()
  }

  // A release that never arrives must not leave a surface that eats clicks.
  Timer { id: safety; interval: 10000; onTriggered: root.cancel() }

  Process {
    id: cursorProbe
    command: ["hyprctl", "cursorpos", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.placeAt(Actions.parseCursorPos(text))
    }
  }

  Process {
    id: workspaceProbe
    command: ["hyprctl", "workspaces", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.occupied = Ring.occupiedFrom(text)
    }
  }

  function placeAt(pos) {
    if (!root.armed) return
    var screens = Quickshell.screens
    var screen = null
    if (pos) {
      for (var i = 0; i < screens.length; i++) {
        var s = screens[i]
        if (pos.x >= s.x && pos.x < s.x + s.width && pos.y >= s.y && pos.y < s.y + s.height) screen = s
      }
    }
    if (!screen && screens.length > 0) screen = screens[0]
    if (!screen) return
    root.targetScreen = screen
    // Keep the whole ring on screen near the edges.
    var margin = root.radius + Style.space(40)
    var lx = pos ? pos.x - screen.x : screen.width / 2
    var ly = pos ? pos.y - screen.y : screen.height / 2
    root.cx = Math.max(margin, Math.min(screen.width - margin, lx))
    root.cy = Math.max(margin, Math.min(screen.height - margin, ly))
    root.px = lx
    root.py = ly
    root.opened = true
    safety.restart()
  }

  PanelWindow {
    id: window
    visible: root.opened && root.targetScreen !== null
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "more-gestures-ring"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.NoButton
      onPositionChanged: function(mouse) { root.px = mouse.x; root.py = mouse.y; root.havePointer = true }
      onEntered: { root.px = mouseX; root.py = mouseY; root.havePointer = true }
    }

    // Backdrop disc.
    Rectangle {
      x: root.cx - width / 2
      y: root.cy - height / 2
      width: (root.radius + Style.space(34)) * 2
      height: width
      radius: width / 2
      color: Util.alpha(Color.background, 0.82)
      border.width: Math.max(1, Style.space(2))
      border.color: Util.alpha(Color.foreground, 0.18)
    }

    // Dead zone: release here to cancel.
    Rectangle {
      x: root.cx - width / 2
      y: root.cy - height / 2
      width: root.deadzone * 2
      height: width
      radius: width / 2
      color: "transparent"
      border.width: Math.max(1, Style.space(2))
      border.color: Util.alpha(Color.foreground, root.selected < 0 ? 0.6 : 0.25)
      Text {
        anchors.centerIn: parent
        text: "×"
        color: Util.alpha(Color.foreground, root.selected < 0 ? 0.8 : 0.35)
        font.family: Style.font.family
        font.pixelSize: Style.font.title
      }
    }

    Repeater {
      model: root.count
      delegate: Rectangle {
        required property int index
        readonly property var action: root.slots[index]
        readonly property int ws: Ring.workspaceOf(action)
        readonly property var pos: Ring.position(index, root.radius, root.count)
        readonly property bool hot: root.selected === index
        readonly property bool strong: Ring.emphasized(action, root.occupied)
        readonly property bool isCurrent: ws > 0 && ws === root.current
        visible: action.type !== "none"
        // Workspaces are round number chips; other actions a pill with their name.
        width: ws > 0 ? Style.space(44) : Math.max(Style.space(44), label.implicitWidth + Style.space(20))
        height: Style.space(44)
        radius: height / 2
        x: root.cx + pos.x - width / 2
        y: root.cy + pos.y - height / 2
        color: hot ? Color.accent : "transparent"
        border.width: isCurrent ? Math.max(2, Style.space(3)) : 0
        border.color: Color.accent
        Text {
          id: label
          anchors.centerIn: parent
          text: parent.ws > 0 ? Ring.workspaceLabel(parent.ws) : root.shortName(parent.action)
          color: parent.hot ? Color.background : Color.foreground
          opacity: parent.hot || parent.strong ? 1.0 : 0.35
          font.family: Style.font.family
          font.pixelSize: parent.ws > 0 ? Style.font.title : Style.font.body
          font.bold: parent.hot || parent.isCurrent
        }
      }
    }
  }
}
