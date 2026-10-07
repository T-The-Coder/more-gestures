import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import touchpad_core as tp  # noqa: E402
from touchpad_core import (  # noqa: E402
    EV_ABS, EV_KEY, EV_SYN, ABS_MT_SLOT, ABS_MT_POSITION_X, ABS_MT_POSITION_Y,
    ABS_MT_TRACKING_ID, BTN_TOOL_TRIPLETAP, BTN_TOOL_QUADTAP, BTN_TOOL_DOUBLETAP,
    TouchpadEngine, TouchpadSettings, update_settings, classify_touchpad,
)

TOOL = {2: BTN_TOOL_DOUBLETAP, 3: BTN_TOOL_TRIPLETAP, 4: BTN_TOOL_QUADTAP}


class Pad:
    """Drives a TouchpadEngine like a kernel would (resolution 10 units/mm)."""

    def __init__(self, settings=None):
        self.e = TouchpadEngine(settings or TouchpadSettings(), 10, 10)
        self.t = 0.0
        self.out = []

    def frame(self, events):
        self.t += 0.01
        for ev in events:
            self.out += self.e.handle(self.t, *ev)
        self.out += self.e.handle(self.t, EV_SYN, 0, 0)

    def down(self, fingers, x=500, y=500, gap=100):
        ev = []
        for i in range(fingers):
            ev += [(EV_ABS, ABS_MT_SLOT, i), (EV_ABS, ABS_MT_TRACKING_ID, 100 + i),
                   (EV_ABS, ABS_MT_POSITION_X, x + i * gap), (EV_ABS, ABS_MT_POSITION_Y, y)]
        ev.append((EV_KEY, TOOL[fingers], 1))
        self.frame(ev)
        self.pos = [[x + i * gap, y] for i in range(fingers)]

    def move(self, dx, dy, steps=10):
        for _ in range(steps):
            ev = []
            for i, p in enumerate(self.pos):
                p[0] += dx / steps
                p[1] += dy / steps
                ev += [(EV_ABS, ABS_MT_SLOT, i), (EV_ABS, ABS_MT_POSITION_X, round(p[0])),
                       (EV_ABS, ABS_MT_POSITION_Y, round(p[1]))]
            self.frame(ev)

    def pinch(self, factor, steps=10):
        cx = sum(p[0] for p in self.pos) / len(self.pos)
        cy = sum(p[1] for p in self.pos) / len(self.pos)
        start = [list(p) for p in self.pos]
        for s in range(1, steps + 1):
            f = 1 + (factor - 1) * s / steps
            ev = []
            for i, p in enumerate(self.pos):
                p[0] = cx + (start[i][0] - cx) * f
                p[1] = cy + (start[i][1] - cy) * f
                ev += [(EV_ABS, ABS_MT_SLOT, i), (EV_ABS, ABS_MT_POSITION_X, round(p[0])),
                       (EV_ABS, ABS_MT_POSITION_Y, round(p[1]))]
            self.frame(ev)

    def up(self, fingers):
        ev = []
        for i in range(fingers):
            ev += [(EV_ABS, ABS_MT_SLOT, i), (EV_ABS, ABS_MT_TRACKING_ID, -1)]
        ev.append((EV_KEY, TOOL[fingers], 0))
        self.frame(ev)

    def payloads(self):
        return [m.payload for m in self.out]

    def types(self):
        return [m.payload["type"] for m in self.out]


class LineTest(unittest.TestCase):
    def test_three_finger_left(self):
        p = Pad()
        p.down(3)
        p.move(-300, 0)  # 30 mm
        p.up(3)
        end = p.payloads()[-1]
        self.assertEqual(end, {"type": "end", "source": "touchpad", "fingers": 3, "gesture": "L"})
        self.assertEqual(p.types()[0], "start")

    def test_shape_down_right_with_four(self):
        p = Pad()
        p.down(4)
        p.move(0, 300)
        p.move(300, 0)
        p.up(4)
        self.assertEqual(p.payloads()[-1]["gesture"], "DR")
        self.assertEqual(p.payloads()[-1]["fingers"], 4)

    def test_short_move_sends_nothing(self):
        p = Pad()
        p.down(3)
        p.move(-50, 0)  # 5 mm < 12 mm threshold
        p.up(3)
        self.assertEqual(p.out, [])

    def test_two_fingers_are_scrolling_not_ours(self):
        p = Pad()
        p.down(2)
        p.move(0, 400)
        p.up(2)
        self.assertEqual(p.out, [])

    def test_extra_finger_cancels(self):
        p = Pad()
        p.down(3)
        p.move(-300, 0)
        p.frame([(EV_ABS, ABS_MT_SLOT, 3), (EV_ABS, ABS_MT_TRACKING_ID, 200),
                 (EV_ABS, ABS_MT_POSITION_X, 900), (EV_ABS, ABS_MT_POSITION_Y, 500),
                 (EV_KEY, BTN_TOOL_TRIPLETAP, 0), (EV_KEY, BTN_TOOL_QUADTAP, 1)])
        self.assertEqual(p.types()[-1], "cancel")

    def test_disabled_finger_count_is_ignored(self):
        p = Pad(TouchpadSettings(fingers=(4,)))
        p.down(3)
        p.move(-300, 0)
        p.up(3)
        self.assertEqual(p.out, [])


class NativeTest(unittest.TestCase):
    def test_native_swipe_never_shows(self):
        p = Pad(TouchpadSettings(native={4: {"L", "R"}}))
        p.down(4)
        p.move(-300, 0)
        p.up(4)
        self.assertEqual(p.out, [])

    def test_unclaimed_direction_still_works(self):
        p = Pad(TouchpadSettings(native={4: {"L", "R"}}))
        p.down(4)
        p.move(0, 300)
        p.up(4)
        self.assertEqual(p.payloads()[-1]["gesture"], "D")

    def test_claim_is_per_finger_count(self):
        p = Pad(TouchpadSettings(native={4: {"L", "R"}}))
        p.down(3)
        p.move(-300, 0)
        p.up(3)
        self.assertEqual(p.payloads()[-1]["gesture"], "L")


class PinchTest(unittest.TestCase):
    def test_pinch_in(self):
        p = Pad()
        p.down(4, gap=150)
        p.pinch(0.5)
        p.up(4)
        self.assertEqual(p.payloads()[-1]["gesture"], "pinchin")

    def test_pinch_out(self):
        p = Pad()
        p.down(4, gap=100)
        p.pinch(1.8)
        p.up(4)
        self.assertEqual(p.payloads()[-1]["gesture"], "pinchout")

    def test_motion_after_pinch_is_ignored(self):
        p = Pad()
        p.down(4, gap=150)
        p.pinch(0.5)
        p.move(-300, 0)
        p.up(4)
        self.assertEqual(p.payloads()[-1]["gesture"], "pinchin")


class PassTest(unittest.TestCase):
    def test_passthrough_silences(self):
        p = Pad()
        p.e.set_passthrough(True)
        p.down(3)
        p.move(-300, 0)
        p.up(3)
        self.assertEqual(p.out, [])

    def test_passthrough_mid_gesture_cancels(self):
        p = Pad()
        p.down(3)
        p.move(-300, 0)
        out = p.e.set_passthrough(True)
        self.assertEqual([m.payload["type"] for m in out], ["cancel"])


class SettingsTest(unittest.TestCase):
    def test_update(self):
        s = TouchpadSettings()
        rejected = update_settings(s, {"threshold_mm": 20, "fingers": [3], "native": {"4": ["L", "R"]},
                                       "bogus": 1, "pinch_ratio": 5})
        self.assertEqual(s.threshold_mm, 20.0)
        self.assertEqual(s.fingers, (3,))
        self.assertEqual(s.native, {4: {"L", "R"}})
        self.assertEqual(sorted(rejected), ["bogus", "pinch_ratio"])

    def test_bad_native_rejected_whole(self):
        s = TouchpadSettings(native={4: {"L"}})
        self.assertEqual(update_settings(s, {"native": {"4": ["X"]}}), ["native"])
        self.assertEqual(s.native, {4: {"L"}})

    def test_classify(self):
        caps = {EV_ABS: [(ABS_MT_POSITION_X, None), (ABS_MT_POSITION_Y, None)],
                EV_KEY: [BTN_TOOL_TRIPLETAP]}
        self.assertTrue(classify_touchpad(caps))
        self.assertFalse(classify_touchpad(caps, props=[tp.INPUT_PROP_DIRECT]))
        self.assertFalse(classify_touchpad({EV_ABS: [ABS_MT_POSITION_X], EV_KEY: []}))


if __name__ == "__main__":
    unittest.main()
