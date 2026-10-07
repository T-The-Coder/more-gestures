"""Trackpad gestures with 3 or 4 fingers, read passively (no grab, no uinput).

Pure logic without evdev, so `python -m unittest` runs without devices. The daemon feeds
the raw multitouch events of a touchpad in; libinput and Hyprland keep getting the very
same events, so scrolling, tapping and Hyprland's own gestures stay untouched.

- Finger count from BTN_TOOL_* (DOUBLETAP 2 … QUINTTAP 5), position as the centroid of
  the active slots in mm (resolution from absinfo), so the threshold feels the same on
  every touchpad.
- Lines go through the same Recognizer as the mouse. Pinch in/out is decided from the
  spread (mean distance of the fingers to their centroid) before a line starts.
- Directions Hyprland owns natively (workspace swipe that follows the fingers) are
  "claimed": such a swipe never reaches the overlay, it is dropped silently.
- A gesture ends when fingers lift; more fingers landing mid-gesture cancel it.
"""

import math
from dataclasses import dataclass, field

import gesture_core as core

EV_SYN = core.EV_SYN
EV_KEY = core.EV_KEY
EV_ABS = core.EV_ABS
SYN_REPORT = 0

ABS_MT_SLOT = 0x2F
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36
ABS_MT_TRACKING_ID = 0x39

BTN_TOOL_FINGER = 0x145
BTN_TOOL_QUINTTAP = 0x148
BTN_TOOL_DOUBLETAP = 0x14D
BTN_TOOL_TRIPLETAP = 0x14E
BTN_TOOL_QUADTAP = 0x14F
TOOL_FINGERS = {
    BTN_TOOL_FINGER: 1, BTN_TOOL_DOUBLETAP: 2, BTN_TOOL_TRIPLETAP: 3,
    BTN_TOOL_QUADTAP: 4, BTN_TOOL_QUINTTAP: 5,
}

INPUT_PROP_DIRECT = 0x01  # touchscreens: never ours

GESTURE_FINGERS = (3, 4)


@dataclass
class TouchpadSettings:
    enabled: bool = True
    # 8 mm per segment and a lenient direction test: in the first live test shapes like
    # ↓→ needed "quite precise" strokes with 12 mm and the mouse's 0.7.
    threshold_mm: float = 8.0
    dominance: float = 0.9
    # Relative change of the finger spread that counts as a pinch (0.3 = 30 %).
    pinch_ratio: float = 0.3
    max_segments: int = 4
    fingers: tuple = GESTURE_FINGERS
    # Finger count -> first directions Hyprland handles itself (e.g. {4: {"L", "R"}}).
    native: dict = field(default_factory=dict)

    @property
    def threshold(self):  # what core.Recognizer reads
        return self.threshold_mm


def update_settings(settings, data):
    """Applies the `touchpad` part of a `config {...}` line in place; returns rejected keys."""
    rejected = []
    for key, value in data.items():
        if key == "enabled" and isinstance(value, bool):
            settings.enabled = value
        elif key == "threshold_mm" and core._number(value, 2, 100):
            settings.threshold_mm = float(value)
        elif key == "pinch_ratio" and core._number(value, 0.05, 0.9):
            settings.pinch_ratio = float(value)
        elif key == "fingers" and isinstance(value, list) and all(v in GESTURE_FINGERS for v in value):
            settings.fingers = tuple(sorted(set(value)))
        elif key == "native" and isinstance(value, dict):
            native = {}
            ok = True
            for count, dirs in value.items():
                try:
                    n = int(count)
                except (TypeError, ValueError):
                    ok = False
                    break
                if n not in GESTURE_FINGERS or not isinstance(dirs, list) or \
                        not all(d in ("U", "D", "L", "R") for d in dirs):
                    ok = False
                    break
                native[n] = set(dirs)
            if ok:
                settings.native = native
            else:
                rejected.append(key)
        else:
            rejected.append(key)
    return rejected


def classify_touchpad(caps, props=(), name=""):
    """True for a touchpad: multitouch positions plus a 3-finger tool bit, not direct.

    Our own uinput clones are never touchpads to us: in the first live test of corner
    taps the daemon grabbed its clone, cloned that, and so on (event27 ... event301).
    """
    if name.startswith(core.VIRTUAL_NAME_PREFIX):
        return False
    if INPUT_PROP_DIRECT in props:
        return False
    abs_codes = core._codes(caps, EV_ABS)
    keys = core._codes(caps, EV_KEY)
    return ABS_MT_POSITION_X in abs_codes and ABS_MT_POSITION_Y in abs_codes \
        and BTN_TOOL_TRIPLETAP in keys


class TouchpadEngine:
    """State machine for one touchpad. `handle` returns core.Message objects."""

    def __init__(self, settings, res_x=1.0, res_y=1.0):
        self.settings = settings
        self.res_x = res_x or 1.0  # units per mm; 0 from a broken absinfo would divide by 0
        self.res_y = res_y or 1.0
        self.passthrough = False
        self._slots = {}  # slot -> [x, y, active]
        self._slot = 0
        self._tool = 0
        self._reset_gesture()

    # ----------------------------------------------------------------- input

    def set_passthrough(self, active):
        """`pass on` (excluded window, e.g. a game): drop a running gesture, stay quiet."""
        self.passthrough = active
        return self._abort() if active else []

    def handle(self, now, etype, code, value):
        if etype == EV_ABS:
            if code == ABS_MT_SLOT:
                self._slot = value
            elif code == ABS_MT_TRACKING_ID:
                s = self._slots.setdefault(self._slot, [0.0, 0.0, False])
                s[2] = value >= 0
            elif code == ABS_MT_POSITION_X:
                self._slots.setdefault(self._slot, [0.0, 0.0, False])[0] = value / self.res_x
            elif code == ABS_MT_POSITION_Y:
                self._slots.setdefault(self._slot, [0.0, 0.0, False])[1] = value / self.res_y
            return []
        if etype == EV_KEY and code in TOOL_FINGERS:
            n = TOOL_FINGERS[code]
            if value:
                self._tool = n
            elif self._tool == n:
                self._tool = 0
            return []
        if etype == EV_SYN and code == SYN_REPORT:
            return self._frame(now)
        return []

    def reset(self):
        """SYN_DROPPED: events were lost, nothing about the current touch can be trusted."""
        out = self._abort()
        self._slots = {}
        self._tool = 0
        return out

    # ----------------------------------------------------------------- frames

    def _reset_gesture(self):
        self.fingers = 0
        self._rec = None
        self._contacts = None
        self._last = None
        self._base_spread = 0.0
        self._moved = 0.0
        self._shown = False   # start already sent to the overlay
        self._blocked = False  # native swipe or decided pinch: ignore further motion
        self._pinch = ""

    def _active_points(self):
        return {k: (v[0], v[1]) for k, v in self._slots.items() if v[2]}

    @staticmethod
    def _centroid(points):
        xs = [p[0] for p in points.values()]
        ys = [p[1] for p in points.values()]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    @staticmethod
    def _spread(points, c):
        return sum(math.hypot(p[0] - c[0], p[1] - c[1]) for p in points.values()) / len(points)

    def _frame(self, now):
        n = self._tool
        if self.fingers:
            if n == self.fingers:
                return self._move(now)
            if n > self.fingers:
                return self._abort()  # another finger landed: not the gesture it started as
            return self._finish()  # fingers lifted
        if self.passthrough or not self.settings.enabled or n not in self.settings.fingers:
            return []
        points = self._active_points()
        if len(points) < 2:
            return []
        self.fingers = n
        self._contacts = set(points)
        self._last = self._centroid(points)
        self._base_spread = self._spread(points, self._last)
        self._rec = core.Recognizer(self.settings, "touchpad", {"fingers": n})
        return []

    def _move(self, now):
        points = self._active_points()
        if len(points) < 2:
            return []
        c = self._centroid(points)
        if set(points) != self._contacts:
            # A finger was re-reported in another slot: re-anchor instead of a jump.
            self._contacts = set(points)
            self._last = c
            self._base_spread = self._spread(points, c)
            return []
        dx, dy = c[0] - self._last[0], c[1] - self._last[1]
        self._last = c
        if self._blocked:
            return []
        self._moved += math.hypot(dx, dy)
        out = []
        rec = self._rec
        if not rec.dirs and self._base_spread > 0:
            ratio = self._spread(points, c) / self._base_spread
            if abs(ratio - 1.0) > self.settings.pinch_ratio and self._moved < self.settings.threshold_mm:
                self._pinch = "pinchin" if ratio < 1.0 else "pinchout"
                self._blocked = True
                return self._show() + [core.Message(rec.payload("segment", dirs=self._pinch))]
        for p in rec.feed(now, dx, dy):
            kind = p["type"]
            if kind == "segment":
                if len(rec.dirs) == 1 and rec.dirs[0] in self.settings.native.get(self.fingers, ()):
                    # Hyprland swipes the workspace with these fingers; stay out of it.
                    self._blocked = True
                    return out
                out += self._show()
                out.append(core.Message(p))
            elif kind == "progress" and self._shown:
                out.append(core.Message(p))
            # "start" is held back until the first segment: a native swipe must not
            # flash the overlay.
        return out

    def _show(self):
        if self._shown:
            return []
        self._shown = True
        return [core.Message(self._rec.payload("start"))]

    def _finish(self):
        out = []
        gesture = self._pinch or (self._rec.gesture if self._rec else "")
        if self._shown and gesture and not (self._blocked and not self._pinch):
            out.append(core.Message(self._rec.payload("end", gesture=gesture)))
        elif self._shown:
            out.append(core.Message(self._rec.payload("cancel")))
        self._reset_gesture()
        return out

    def _abort(self):
        out = []
        if self.fingers and self._shown:
            out.append(core.Message(self._rec.payload("cancel")))
        self._reset_gesture()
        return out
