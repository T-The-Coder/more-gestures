import QtQuick
import QtQuick.Shapes

// The More Gestures symbol drawn in QML so it follows the theme live: a square split
// by a fine cross whose lower arm is missing (a schematic mouse). Same proportions as
// bin/app-icon (78 px square, 7 px frame, 3 px lines in a 128 px tile).
//
// `inverted` (bar icon): a filled square with the arms cut out. They are real holes
// (odd-even fill), so a transparent bar shows through them like through the tile.
Item {
  id: root
  property color color: "white"
  property bool inverted: false
  implicitWidth: 32
  implicitHeight: 32

  readonly property real frame: Math.max(1.5, width * 6 / 64)
  readonly property real line: Math.max(1, width * 2.5 / 64)
  readonly property real cut: Math.max(1.5, width * 4 / 64)  // thicker: stays visible at bar size

  Rectangle {
    visible: !root.inverted
    anchors.fill: parent
    radius: root.width * 10 / 64
    color: "transparent"
    border.width: root.frame
    border.color: root.color
  }
  Rectangle {  // horizontal arm across the middle
    visible: !root.inverted
    x: root.frame / 2
    width: root.width - root.frame
    y: (root.height - root.line) / 2
    height: root.line
    color: root.color
  }
  Rectangle {  // upper arm only: the buttons
    visible: !root.inverted
    x: (root.width - root.line) / 2
    width: root.line
    y: root.frame / 2
    height: root.height / 2 - root.frame / 2
    color: root.color
  }

  Shape {
    visible: root.inverted
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    ShapePath {
      fillColor: root.color
      strokeWidth: -1
      fillRule: ShapePath.OddEvenFill
      PathSvg {
        path: {
          var w = root.width, h = root.height, r = w * 10 / 64, c = root.cut
          var sq = "M " + r + " 0 H " + (w - r) + " Q " + w + " 0 " + w + " " + r
            + " V " + (h - r) + " Q " + w + " " + h + " " + (w - r) + " " + h
            + " H " + r + " Q 0 " + h + " 0 " + (h - r) + " V " + r + " Q 0 0 " + r + " 0 Z"
          // The two arms meet; drawn as one T-shaped hole so the crossing is not
          // filled again by odd-even.
          var hx0 = (w - c) / 2, hx1 = (w + c) / 2, y0 = (h - c) / 2, y1 = (h + c) / 2
          var hole = "M 0 " + y0 + " H " + hx0 + " V 0 H " + hx1 + " V " + y0 + " H " + w
            + " V " + y1 + " H 0 Z"
          return sq + " " + hole
        }
      }
    }
  }
}
