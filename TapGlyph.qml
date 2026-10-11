import QtQuick
import "Actions.js" as Actions

// A tap drawn as dots on a small trackpad: one dot per tap on the diagonal into the
// tapped corner (Actions.tapDots), two rows of four for the 4-finger double tap.
Item {
  id: glyph
  property string gesture: ""
  property color color: "white"
  implicitWidth: 22
  implicitHeight: 16
  readonly property var dots: Actions.tapDots(gesture)
  readonly property real dot: Math.max(2.5, Math.min(width, height) * 0.2)

  Rectangle {  // the trackpad
    anchors.fill: parent
    radius: Math.max(2, height * 0.18)
    color: "transparent"
    border.width: 1
    border.color: glyph.color
    opacity: 0.45
  }
  Repeater {
    model: glyph.dots
    delegate: Rectangle {
      required property var modelData
      width: glyph.dot
      height: width
      radius: width / 2
      x: modelData.x * glyph.width - width / 2
      y: modelData.y * glyph.height - height / 2
      color: glyph.color
    }
  }
}
