import QtQuick
import QtQuick.Shapes
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import "Effects.js" as Effects
import "Actions.js" as Actions
import "Trail.js" as Trail

// Gesture feedback: the real line under the pointer plus the indicator (ring, arrows,
// action name).
//
// Two layer-shell surfaces on the monitor under the pointer, both only alive while a
// gesture runs:
//  - the input surface is transparent and only exists to receive hover positions. The
//    daemon holds the trigger press back, so no client has seen a button-down and there is
//    no implicit pointer grab: Hyprland hands this surface the exact pointer positions
//    even though the physical button is still held;
//  - the visual surface draws line and indicator with an empty input region, so the
//    fade-out never swallows a click.
// The input surface is unmapped the moment the gesture ends. Otherwise the click that
// follows a gesture would hit this surface instead of the application below it
// (symptom: after a gesture the next click "does nothing").
Item {
  id: root

  // "off" | "minimal" | "full" (Actions.normalizeIndicator); set by Service.qml.
  property string indicator: "full"
  // False swaps every fade for a cut (accessibility).
  property bool animations: true
  property string lang: "en"

  readonly property int fadeMs: 150
  // Gestures end at the latest with the daemon's emergency brake (10 s); if its `end` or
  // `cancel` line gets lost, the surfaces must still go away on their own.
  readonly property int safetyMs: 10000

  // armed: a gesture is running. active: the surfaces are mapped.
  property bool armed: false
  property bool active: false
  property bool fading: false
  property bool done: false          // trigger fired: show the check mark while fading

  property var targetScreen: null
  property real originX: 0           // top-left of targetScreen in layout coordinates
  property real originY: 0
  property bool haveStart: false
  property real startX: 0            // ring centre, local to the screen
  property real startY: 0
  property var points: []
  // Seconds since begin() for each point, for styles whose trail ages (sparks, vapour).
  property var pointTimes: []
  property real begunAt: 0
  // The trail's look (Effects.js); "plain" is the accent line.
  property string trailStyle: "plain"

  property string source: "mouse"
  property int fingers: 0
  property string dirs: ""
  property string label: ""
  property bool valid: false
  property string progressDir: ""
  property real progressRatio: 0

  readonly property bool showArrows: indicator === "full"
  // Trail and ring share one stroke width so they read as one mark.
  readonly property real lineWidth: Math.max(3, Style.space(4))
  readonly property real ringSize: Style.space(36)
  // Trail from the ring's outer edge to the pointer, plus its arrowhead.
  readonly property var trailPath: haveStart
      ? Trail.clipStart(points, startX, startY, ringSize / 2).map(function(p) { return Qt.point(p.x, p.y) })
      : []
  readonly property var trailHead: Trail.arrowHead(trailPath, lineWidth * 3.5)
      .map(function(p) { return Qt.point(p.x, p.y) })
  readonly property color neutralColor: Color.foreground
  readonly property color dimColor: Util.alpha(Color.foreground, 0.45)
  readonly property color stateColor: dirs === "" ? neutralColor : (valid ? Color.accent : dimColor)

  // ---------------------------------------------------------------- lifecycle

  function begin(src, fingerCount) {
    if (indicator === "off") return
    if (active || fading) hideNow()
    armed = true
    source = src || "mouse"
    fingers = fingerCount || 0
    dirs = ""
    label = ""
    valid = false
    progressDir = ""
    progressRatio = 0
    done = false
    haveStart = false
    points = []
    pointTimes = []
    begunAt = Date.now()
    safety.restart()
    // Read-only; tells which monitor holds the pointer. The surfaces open when it answers.
    if (!cursorProbe.running) cursorProbe.running = true
  }

  function update(newDirs, newLabel, isValid) {
    if (!armed) return
    dirs = newDirs
    label = newLabel
    valid = isValid
    progressDir = ""
    progressRatio = 0
  }

  function setProgress(dir, ratio) {
    if (!armed) return
    progressDir = dir
    progressRatio = Math.max(0, Math.min(1, ratio))
  }

  // Trigger released. `fired`: an action ran, so confirm it with a check mark.
  function finish(fired) {
    if (!armed && !active) return
    armed = false
    done = fired
    close()
  }

  function cancel() {
    armed = false
    done = false
    close()
  }

  // The input surface goes first and unconditionally; only the harmless visual
  // surface may linger for the fade.
  function close() {
    safety.stop()
    active = false
    if (animations && visualVisible) {
      fading = true
      fadeTimer.restart()
    } else {
      fading = false
    }
  }

  function hideNow() {
    armed = false
    active = false
    fading = false
    done = false
    fadeTimer.stop()
    safety.stop()
  }

  readonly property bool visualVisible: targetScreen !== null && (active || fading)

  Timer {
    id: safety
    interval: root.safetyMs
    onTriggered: root.cancel()
  }

  Timer {
    id: fadeTimer
    interval: root.fadeMs
    onTriggered: { root.fading = false; root.done = false }
  }

  // --------------------------------------------------------- monitor under pointer

  // `hyprctl cursorpos -j` is read-only: {"x": 1234, "y": 567} in layout coordinates.
  Process {
    id: cursorProbe
    command: ["hyprctl", "cursorpos", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.placeAt(Actions.parseCursorPos(text))
    }
  }

  function screenAt(pos) {
    var screens = Quickshell.screens
    if (pos) {
      for (var i = 0; i < screens.length; i++) {
        var s = screens[i]
        if (pos.x >= s.x && pos.x < s.x + s.width && pos.y >= s.y && pos.y < s.y + s.height) return s
      }
    }
    // Pointer position unreadable: the focused monitor is where the pointer almost always is.
    var focused = Hyprland.focusedMonitor
    if (focused) {
      for (var j = 0; j < screens.length; j++) if (screens[j].name === focused.name) return screens[j]
    }
    return screens.length > 0 ? screens[0] : null
  }

  function placeAt(pos) {
    // The trigger was released while hyprctl was still answering.
    if (!armed) return
    var screen = screenAt(pos)
    if (!screen) { cancel(); return }
    targetScreen = screen
    originX = screen.x
    originY = screen.y
    if (pos) {
      startX = pos.x - screen.x
      startY = pos.y - screen.y
      haveStart = true
      points = [Qt.point(startX, startY)]
      pointTimes = [root.now()]
    }
    active = true
  }

  function now() { return (Date.now() - root.begunAt) / 1000 }

  function addPoint(x, y) {
    if (!active) return
    if (!haveStart) {
      // No cursor position: the first hover event is the best start we have.
      startX = x
      startY = y
      haveStart = true
      points = [Qt.point(x, y)]
      pointTimes = [root.now()]
      return
    }
    var last = points[points.length - 1]
    // Hover events arrive per input packet; sub-pixel steps would only grow the path.
    if (Math.abs(x - last.x) + Math.abs(y - last.y) < 2) return
    // A path this long means a stuck gesture; the safety timer ends it, no need to grow further.
    if (points.length >= 4000) return
    var next = points.slice()
    next.push(Qt.point(x, y))
    var times = pointTimes.slice()
    times.push(root.now())
    pointTimes = times
    points = next
  }

  // ------------------------------------------------------------- input surface

  PanelWindow {
    id: inputWindow
    visible: root.active && root.targetScreen !== null
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "more-gestures"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.NoButton
      onPositionChanged: function(mouse) { root.addPoint(mouse.x, mouse.y) }
      onEntered: root.addPoint(mouseX, mouseY)
    }
  }

  // ------------------------------------------------------------ visual surface

  PanelWindow {
    id: visualWindow
    visible: root.visualVisible
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "more-gestures"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    // Visual only: an empty input region keeps clicks going to the desktop below.
    mask: Region {}

    Item {
      id: content
      anchors.fill: parent
      opacity: root.active ? 1 : 0
      Behavior on opacity {
        enabled: root.animations
        NumberAnimation { duration: root.fadeMs; easing.type: Easing.OutCubic }
      }

      // A style's trail (Effects.drawTrail) instead of the plain line; repainted about 30
      // times a second while the gesture runs, so ageing effects keep moving.
      Canvas {
        id: trailCanvas
        anchors.fill: parent
        visible: root.trailStyle !== "plain"
        property real t: 0
        onPaint: {
          var ctx = getContext("2d")
          ctx.reset()
          var path = root.trailPath
          // trailPath is clipped at the ring: its points are the last ones of `points`.
          var times = root.pointTimes.slice(Math.max(0, root.pointTimes.length - path.length))
          Effects.drawTrail(ctx, root.trailStyle, {
            t: t, still: !root.animations, points: path, times: times, lineWidth: root.lineWidth,
            colors: { accent: Color.accent, fg: Color.foreground, bg: Color.background }
          })
        }
        Timer {
          interval: 33
          repeat: true
          running: trailCanvas.visible && root.visualVisible
          onTriggered: { trailCanvas.t = root.now(); trailCanvas.requestPaint() }
        }
      }

      Shape {
        anchors.fill: parent
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
          strokeColor: root.trailStyle === "plain" ? Color.accent : "transparent"
          strokeWidth: root.lineWidth
          fillColor: "transparent"
          capStyle: ShapePath.RoundCap
          joinStyle: ShapePath.RoundJoin
          PathPolyline { path: root.trailPath }
        }
        ShapePath {
          strokeColor: Color.accent
          strokeWidth: root.lineWidth
          fillColor: "transparent"
          capStyle: ShapePath.RoundCap
          joinStyle: ShapePath.RoundJoin
          PathPolyline { path: root.trailHead }
        }
      }

      Item {
        id: indicatorItem
        visible: root.haveStart
        x: root.startX
        y: root.startY

        readonly property real ringSize: root.ringSize

        Rectangle {
          id: ring
          width: indicatorItem.ringSize
          height: width
          x: -width / 2
          y: -height / 2
          radius: width / 2
          color: Util.alpha(Color.background, 0.55)
          border.width: root.lineWidth
          border.color: root.done ? Color.accent : root.stateColor

          Text {
            anchors.centerIn: parent
            textFormat: Text.PlainText
            text: root.done ? "✓" : (root.source === "touchpad" && root.fingers > 0 ? String(root.fingers) : "")
            color: root.done ? Color.accent : root.stateColor
            font.family: Style.font.family
            font.bold: true
            font.pixelSize: Style.font.title
          }
        }

        Rectangle {
          id: card
          visible: root.label !== ""
          readonly property int pad: Style.space(8)
          width: Math.max(cardColumn.implicitWidth, 0) + pad * 2
          height: cardColumn.implicitHeight + pad * 2
          radius: Style.cornerRadius
          color: Util.alpha(Color.background, 0.92)
          border.width: 1
          border.color: Util.alpha(root.stateColor, 0.7)
          // Below the ring, nudged back inside the screen near the edges.
          x: Math.max(Style.space(8) - indicatorItem.x,
               Math.min(visualWindow.width - Style.space(8) - width - indicatorItem.x, -width / 2))
          y: Math.min(visualWindow.height - Style.space(8) - height - indicatorItem.y,
               ring.height / 2 + Style.space(8))

          Column {
            id: cardColumn
            x: card.pad
            y: card.pad
            spacing: Style.space(4)

            Row {
              id: arrowRow
              visible: root.showArrows
              spacing: Style.space(6)
              anchors.horizontalCenter: parent.horizontalCenter

              Repeater {
                model: root.showArrows ? Actions.arrowList(root.dirs) : []
                Text {
                  required property string modelData
                  textFormat: Text.PlainText
                  text: modelData
                  color: root.stateColor
                  font.family: Style.font.family
                  font.bold: true
                  font.pixelSize: Math.round(Style.font.title * 1.4)
                }
              }

              // The segment under way: it grows toward full size as the pointer
              // approaches the threshold, so the next arrow is visible before it counts.
              Text {
                visible: root.progressDir !== ""
                textFormat: Text.PlainText
                text: Actions.arrowFor(root.progressDir)
                color: root.neutralColor
                opacity: 0.2 + 0.8 * root.progressRatio
                scale: 0.6 + 0.4 * root.progressRatio
                font.family: Style.font.family
                font.bold: true
                font.pixelSize: Math.round(Style.font.title * 1.4)
                Behavior on opacity {
                  enabled: root.animations
                  NumberAnimation { duration: 60 }
                }
                Behavior on scale {
                  enabled: root.animations
                  NumberAnimation { duration: 60 }
                }
              }
            }

            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              textFormat: Text.PlainText
              text: root.label
              color: root.stateColor
              font.family: Style.font.family
              font.pixelSize: Style.font.title
              maximumLineCount: 1
              elide: Text.ElideRight
              width: Math.min(implicitWidth, Style.space(320))
            }
          }
        }
      }
    }
  }
}
