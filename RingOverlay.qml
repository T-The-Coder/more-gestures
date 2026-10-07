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
  // One key per slot while the ring is open ("" = none); Esc always closes.
  property var keys: Actions.RING_KEYS
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
  property real originX: 0           // top-left of targetScreen in layout coordinates
  property real originY: 0
  // The pointer left the middle at least once: releasing in the middle then cancels.
  // If it never did, the release only ends the double click and the ring stays open
  // for a click on a slot ("the numbers could not be clicked" in the first test).
  property bool leftMiddle: false
  property bool sticky: false
  property bool releasePending: false

  signal chosen(var action)
  property var occupied: []
  property int current: 0

  // Slots 50 % larger than the first version (44 px), the ring wide enough that twelve
  // of them do not touch.
  readonly property real slotSize: Style.space(66)
  readonly property real radius: Style.space(165)
  readonly property real deadzone: radius * 0.3
  readonly property int rawSelected: havePointer ? Ring.sectorFor(px - cx, py - cy, deadzone, count) : -1
  // Dragging picks by direction (fast, works blind). Once the ring stays open for
  // clicking, only a slot itself counts: a click anywhere else just closes the ring.
  readonly property int selected: sticky ? (havePointer ? slotAt(px, py) : -1)
    : (rawSelected >= 0 && slots[rawSelected].type !== "none" ? rawSelected : -1)

  // Index of the visible slot under (x, y) in window coordinates, or -1.
  function slotAt(x, y) {
    for (var i = 0; i < slotRepeater.count; i++) {
      var it = slotRepeater.itemAt(i)
      if (it && it.visible && x >= it.x && x < it.x + it.width && y >= it.y && y < it.y + it.height)
        return i
    }
    return -1
  }

  function open() {
    root.armed = true
    root.havePointer = false
    root.leftMiddle = false
    root.sticky = false
    root.releasePending = false
    root.current = Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : 0
    if (!cursorProbe.running) cursorProbe.running = true
    if (!workspaceProbe.running) workspaceProbe.running = true
  }

  // The trigger was released.
  function release() {
    if (!root.armed) return
    if (!root.opened) { root.releasePending = true; return }  // placed later, then sticky
    if (!root.havePointer) {
      // No hover position arrived: ask Hyprland where the pointer is now.
      if (!releaseProbe.running) releaseProbe.running = true
      return
    }
    root.decide(root.px, root.py)
  }

  function decide(x, y) {
    var raw = Ring.sectorFor(x - root.cx, y - root.cy, root.deadzone, root.count)
    var pick = raw >= 0 && root.slots[raw].type !== "none" ? root.slots[raw] : null
    if (pick) { root.finish(pick); return }
    if (!root.leftMiddle && raw < 0) {
      root.sticky = true
      safety.restart()
      return
    }
    root.cancel()
  }

  function finish(action) {
    root.cancel()
    root.chosen(action)
  }

  function track(x, y) {
    root.px = x
    root.py = y
    root.havePointer = true
    if (Math.sqrt((x - root.cx) * (x - root.cx) + (y - root.cy) * (y - root.cy)) >= root.deadzone)
      root.leftMiddle = true
  }

  Process {
    id: releaseProbe
    command: ["hyprctl", "cursorpos", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var pos = Actions.parseCursorPos(text)
        if (!root.opened) return
        if (pos) root.decide(pos.x - root.originX, pos.y - root.originY)
        else root.cancel()
      }
    }
  }

  // "Exposé (all windows)" -> "Exposé": the ring has little room, the part in brackets
  // is explanation for the settings list.
  function shortName(action) {
    return Actions.actionName(action, root.lang).replace(/\s*\(.*\)\s*$/, "")
  }

  function cancel() {
    root.armed = false
    root.sticky = false
    root.releasePending = false
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
    root.originX = screen.x
    root.originY = screen.y
    // Keep the whole ring on screen near the edges.
    var margin = root.radius + root.slotSize / 2 + Style.space(20)
    var lx = pos ? pos.x - screen.x : screen.width / 2
    var ly = pos ? pos.y - screen.y : screen.height / 2
    root.cx = Math.max(margin, Math.min(screen.width - margin, lx))
    root.cy = Math.max(margin, Math.min(screen.height - margin, ly))
    root.px = lx
    root.py = ly
    root.opened = true
    safety.restart()
    // Released while hyprctl was answering: the pointer never moved, keep it open.
    if (root.releasePending) { root.releasePending = false; root.sticky = true }
  }

  PanelWindow {
    id: window
    visible: root.opened && root.targetScreen !== null
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "more-gestures-ring"
    WlrLayershell.layer: WlrLayer.Overlay
    // Keys pick slots too (1-0, e, w by default), so the ring takes the keyboard while
    // it is open.
    WlrLayershell.keyboardFocus: root.opened ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onPressed: function(event) {
        event.accepted = true
        if (event.key === Qt.Key_Escape) { root.cancel(); return }
        var k = String(event.text || "").toLowerCase()
        if (k === "") return
        var i = root.keys.indexOf(k)
        if (i >= 0 && root.slots[i] && root.slots[i].type !== "none") root.finish(root.slots[i])
      }
    }
    onVisibleChanged: if (visible) keyCatcher.forceActiveFocus()

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      // Clicks only while the ring stays open after the release (sticky); a click on a
      // slot runs it, anywhere else closes the ring.
      acceptedButtons: root.sticky ? (Qt.LeftButton | Qt.RightButton) : Qt.NoButton
      onPositionChanged: function(mouse) { root.track(mouse.x, mouse.y) }
      onEntered: root.track(mouseX, mouseY)
      onClicked: function(mouse) {
        root.track(mouse.x, mouse.y)
        var hit = root.slotAt(mouse.x, mouse.y)
        if (hit >= 0) root.finish(root.slots[hit])
        else root.cancel()  // outside every slot: close, do nothing
      }
    }

    // Backdrop disc.
    Rectangle {
      x: root.cx - width / 2
      y: root.cy - height / 2
      width: (root.radius + root.slotSize / 2 + Style.space(12)) * 2
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
      id: slotRepeater
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
        width: ws > 0 ? root.slotSize : Math.max(root.slotSize, label.implicitWidth + Style.space(28))
        height: root.slotSize
        radius: height / 2
        x: root.cx + pos.x - width / 2
        y: root.cy + pos.y - height / 2
        color: hot ? Color.accent : "transparent"
        border.width: isCurrent ? Math.max(2, Style.space(3)) : 0
        border.color: Color.accent
        // The key for a slot whose label does not already say it (e for Exposé, w for
        // Wallpaper), small in the corner.
        Text {
          visible: parent.ws === 0 && (root.keys[index] || "") !== ""
          anchors.right: parent.right
          anchors.top: parent.top
          anchors.rightMargin: Style.space(8)
          anchors.topMargin: Style.space(2)
          text: root.keys[index] || ""
          color: parent.hot ? Color.background : Color.foreground
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
        Text {
          id: label
          anchors.centerIn: parent
          text: parent.ws > 0 ? Ring.workspaceLabel(parent.ws) : root.shortName(parent.action)
          color: parent.hot ? Color.background : Color.foreground
          opacity: parent.hot || parent.strong ? 1.0 : 0.35
          font.family: Style.font.family
          font.pixelSize: parent.ws > 0 ? Math.round(Style.font.title * 1.4) : Math.round(Style.font.body * 1.2)
          font.bold: parent.hot || parent.isCurrent
        }
      }
    }
  }
}
