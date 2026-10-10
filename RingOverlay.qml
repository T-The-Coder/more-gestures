import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import "Actions.js" as Actions
import "Ring.js" as Ring

// Ring menu: double click with the trigger button and keep the second press held (or
// four-finger double tap, or the hotkey). Up to three clock faces of actions around the
// pointer, inner first (default ring 1: Exposé at 12, workspaces 1-5 at 1-5 o'clock,
// wallpaper at 6, workspaces 6-0 at 7-11). Moving towards a slot highlights it: the
// direction picks the slot, the distance the ring. Releasing runs it, releasing in the
// middle cancels. Every slot can also have a key. Workspaces 1-5 always look normal,
// 6-0 are faded unless a window is on them.
//
// One surface that takes pointer input: the daemon held the button back, so no
// application has an implicit grab and the hover positions come straight from
// Hyprland (same trick as the gesture trail). It goes away the moment the button is
// released, so the next click reaches the application below.
Item {
  id: root

  property string lang: "en"
  // Config.activeRings: [{ index, count, slots, keys }], inner first. One key per slot
  // while the ring is open ("" = none, upper case = Shift+letter); Esc always closes.
  property var rings: []

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

  // Slots 50 % larger than the first version (44 px), the inner ring wide enough that
  // twelve of them do not touch. Three full rings do not fit a small screen at that
  // size: `fit` shrinks everything (set when the ring is placed).
  property real fit: 1
  readonly property real slotSize: Style.space(66) * fit
  readonly property real innerRadius: Style.space(165) * fit
  readonly property var geometry: Ring.layout(rings.map(function(r) { return r.count }), slotSize, innerRadius)
  readonly property real outer: Ring.outerRadius(geometry, slotSize)
  readonly property real deadzone: (geometry.length ? geometry[0].radius : innerRadius) * 0.3

  // Every slot of every ring as one flat list: { ring, index, action, key, x, y } with
  // x/y relative to the centre. One list keeps hit testing, keys and drawing in step.
  readonly property var chips: {
    var out = []
    for (var k = 0; k < rings.length && k < geometry.length; k++) {
      for (var i = 0; i < rings[k].count; i++) {
        var p = Ring.position(i, geometry[k].radius, rings[k].count, geometry[k].offset)
        out.push({ ring: k, index: i, action: rings[k].slots[i], key: rings[k].keys[i] || "", x: p.x, y: p.y })
      }
    }
    return out
  }

  // Chip under a drag: direction and distance (works blind), -1 for none/empty.
  function dragChip(dx, dy) {
    var hit = Ring.pick(dx, dy, root.geometry, root.deadzone)
    if (!hit) return -1
    for (var c = 0; c < root.chips.length; c++) {
      var chip = root.chips[c]
      if (chip.ring === hit.ring && chip.index === hit.index) return chip.action.type !== "none" ? c : -1
    }
    return -1
  }

  // Once the ring stays open for clicking, only a slot itself counts: a click anywhere
  // else just closes the ring.
  readonly property int selected: !havePointer ? -1 : sticky ? slotAt(px, py) : dragChip(px - cx, py - cy)

  // Index of the visible chip under (x, y) in window coordinates, or -1.
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
    var c = root.dragChip(x - root.cx, y - root.cy)
    if (c >= 0) { root.finish(root.chips[c].action); return }
    var inMiddle = Math.sqrt((x - root.cx) * (x - root.cx) + (y - root.cy) * (y - root.cy)) < root.deadzone
    if (!root.leftMiddle && inMiddle) {
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
    // Shrink when the rings at full size would not fit the screen.
    var full = Ring.layout(root.rings.map(function(r) { return r.count }), Style.space(66), Style.space(165))
    var need = Ring.outerRadius(full, Style.space(66)) + Style.space(32)
    root.fit = Math.min(1, Math.min(screen.width, screen.height) / 2 / need)
    // Keep the whole ring on screen near the edges.
    var margin = root.outer + Style.space(20)
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
        // event.text keeps the case: "a" and Shift+a ("A") are two keys.
        var k = String(event.text || "")
        if (k === "") return
        for (var c = 0; c < root.chips.length; c++) {
          var chip = root.chips[c]
          if (chip.key === k && chip.action.type !== "none") { root.finish(chip.action); return }
        }
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
        if (hit >= 0) root.finish(root.chips[hit].action)
        else root.cancel()  // outside every slot: close, do nothing
      }
    }

    // Backdrop disc.
    Rectangle {
      x: root.cx - width / 2
      y: root.cy - height / 2
      width: (root.outer + Style.space(12)) * 2
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

    // Full name of the slot under the pointer: chips on the outer rings are small and
    // only show a shortened name.
    Text {
      visible: root.selected >= 0
      width: root.deadzone * 4
      x: root.cx - width / 2
      y: root.cy + root.deadzone + Style.space(6)
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.Wrap
      text: root.selected >= 0 ? Actions.actionName(root.chips[root.selected].action, root.lang) : ""
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }

    Repeater {
      id: slotRepeater
      model: root.chips
      delegate: Rectangle {
        required property var modelData
        required property int index
        readonly property var action: modelData.action
        readonly property int ws: Ring.workspaceOf(action)
        readonly property bool hot: root.selected === index
        readonly property bool strong: Ring.emphasized(action, root.occupied)
        readonly property bool isCurrent: ws > 0 && ws === root.current
        // Inner ring: other actions are a pill with their name. Outer rings are tighter:
        // round chips with the name on up to two lines (the full name shows in the middle).
        readonly property bool pill: ws === 0 && modelData.ring === 0
        visible: action.type !== "none"
        width: pill ? Math.max(root.slotSize, label.implicitWidth + Style.space(28)) : root.slotSize
        height: root.slotSize
        radius: height / 2
        x: root.cx + modelData.x - width / 2
        y: root.cy + modelData.y - height / 2
        color: hot ? Color.accent : modelData.ring > 0 ? Util.alpha(Color.foreground, 0.06) : "transparent"
        border.width: isCurrent ? Math.max(2, Style.space(3)) : 0
        border.color: Color.accent
        // The key, small in the corner, unless the label already says it (1 for
        // workspace 1).
        Text {
          visible: modelData.key !== "" && !(parent.ws > 0 && Ring.workspaceLabel(parent.ws) === modelData.key)
          anchors.right: parent.right
          anchors.top: parent.top
          anchors.rightMargin: parent.pill ? Style.space(8) : Style.space(4)
          anchors.topMargin: Style.space(2)
          text: modelData.key
          color: parent.hot ? Color.background : Color.foreground
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
        Text {
          id: label
          anchors.centerIn: parent
          width: parent.pill || parent.ws > 0 ? implicitWidth : parent.width - Style.space(8)
          horizontalAlignment: Text.AlignHCenter
          wrapMode: parent.pill || parent.ws > 0 ? Text.NoWrap : Text.Wrap
          maximumLineCount: 2
          elide: Text.ElideRight
          text: parent.ws > 0 ? Ring.workspaceLabel(parent.ws) : root.shortName(parent.action)
          color: parent.hot ? Color.background : Color.foreground
          opacity: parent.hot || parent.strong ? 1.0 : 0.35
          font.family: Style.font.family
          font.pixelSize: parent.ws > 0 ? Math.round(Style.font.title * 1.4 * Math.max(0.7, root.fit))
            : parent.pill ? Math.round(Style.font.body * 1.2) : Style.font.caption
          font.bold: parent.hot || parent.isCurrent
        }
      }
    }
  }
}
