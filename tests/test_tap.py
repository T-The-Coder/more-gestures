import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from tap_core import (  # noqa: E402
    EV_ABS, EV_KEY, ABS_MT_SLOT, ABS_MT_TRACKING_ID, ABS_MT_POSITION_X, ABS_MT_POSITION_Y,
    BTN_LEFT, Axis, TapFilter, TapSettings, update_settings,
)

BTN_TOUCH = 0x14A

# 100 x 50 mm pad at 10 units/mm.
AX = Axis(0, 1000, 10)
AY = Axis(0, 500, 10)
POS = {"tl": (50, 50), "tr": (950, 50), "bl": (50, 450), "br": (950, 450), "mid": (500, 250)}


class Pad:
    def __init__(self, bound=("tl2", "tr2", "bl2", "br2", "tl3")):
        self.f = TapFilter(TapSettings(enabled=True, bound=set(bound)), AX, AY)
        self.t = 0.0
        self.out = []
        self.msgs = []
        self.tid = 100

    def send(self, events, dt=0.01):
        self.t += dt
        frames, msgs = self.f.tick(self.t)
        self.out += frames
        self.msgs += msgs
        frames, msgs = self.f.frame(self.t, events)
        self.out += frames
        self.msgs += msgs

    def wait(self, dt):
        self.t += dt
        frames, msgs = self.f.tick(self.t)
        self.out += frames
        self.msgs += msgs

    def tap(self, where, slot=0, hold=0.05, move=0):
        x, y = POS[where]
        self.tid += 1
        self.send([(EV_ABS, ABS_MT_SLOT, slot), (EV_ABS, ABS_MT_TRACKING_ID, self.tid),
                   (EV_ABS, ABS_MT_POSITION_X, x), (EV_ABS, ABS_MT_POSITION_Y, y),
                   (EV_KEY, BTN_TOUCH, 1)])
        if move:
            self.send([(EV_ABS, ABS_MT_POSITION_X, x + move)], dt=hold / 2)
        self.send([(EV_ABS, ABS_MT_TRACKING_ID, -1), (EV_KEY, BTN_TOUCH, 0)], dt=hold)

    def gestures(self):
        return [m["gesture"] for m in self.msgs]


class TapTest(unittest.TestCase):
    def test_double_tap_corner_is_swallowed(self):
        p = Pad()
        p.tap("tl")
        p.tap("tl")
        p.wait(0.5)
        self.assertEqual(p.gestures(), ["tl2"])
        self.assertEqual(p.out, [])

    def test_triple_tap(self):
        p = Pad()
        for _ in range(3):
            p.tap("tl")
        p.wait(0.5)
        self.assertEqual(p.gestures(), ["tl3"])

    def test_unbound_count_is_replayed(self):
        p = Pad()
        p.tap("tr")  # tr1 is not bound
        p.wait(0.5)
        self.assertEqual(p.msgs, [])
        self.assertEqual(len(p.out), 2)  # touch down and up, replayed in order
        self.assertIn((EV_ABS, ABS_MT_TRACKING_ID, -1), p.out[-1])

    def test_middle_tap_passes_at_once(self):
        p = Pad()
        p.tap("mid")
        self.assertEqual(len(p.out), 2)
        self.assertEqual(p.msgs, [])

    def test_corner_without_binding_passes_at_once(self):
        p = Pad(bound=("tl2",))
        p.tap("br")
        self.assertEqual(len(p.out), 2)

    def test_moving_touch_is_released(self):
        p = Pad()
        p.tap("tl", move=100)  # 10 mm: a swipe, not a tap
        self.assertEqual(p.msgs, [])
        self.assertEqual(len(p.out), 3)

    def test_long_touch_is_released_by_tick(self):
        p = Pad()
        x, y = POS["tl"]
        p.send([(EV_ABS, ABS_MT_TRACKING_ID, 5), (EV_ABS, ABS_MT_POSITION_X, x), (EV_ABS, ABS_MT_POSITION_Y, y)])
        self.assertEqual(p.out, [])
        p.wait(0.3)
        self.assertEqual(len(p.out), 1)

    def test_physical_click_is_released(self):
        p = Pad()
        x, y = POS["tl"]
        p.send([(EV_ABS, ABS_MT_TRACKING_ID, 5), (EV_ABS, ABS_MT_POSITION_X, x), (EV_ABS, ABS_MT_POSITION_Y, y)])
        p.send([(EV_KEY, BTN_LEFT, 1)])
        self.assertEqual(len(p.out), 2)

    def test_tap_elsewhere_ends_sequence(self):
        p = Pad()
        p.tap("tl")
        p.tap("tl")
        p.tap("mid")
        self.assertEqual(p.gestures(), ["tl2"])
        self.assertEqual(len(p.out), 2)  # only the middle tap

    def test_different_corner_finalizes_first(self):
        p = Pad()
        p.tap("tl")
        p.tap("tl")
        p.tap("tr")
        p.tap("tr")
        p.wait(0.5)
        self.assertEqual(p.gestures(), ["tl2", "tr2"])

    def test_disabled_passes_everything(self):
        p = Pad()
        p.f.settings.enabled = False
        p.tap("tl")
        p.tap("tl")
        self.assertEqual(len(p.out), 4)
        self.assertEqual(p.msgs, [])

    def test_passthrough(self):
        p = Pad()
        p.tap("tl")
        out = p.f.set_passthrough(True)
        self.assertEqual(len(out), 2)  # held tap goes out
        p.tap("tl")
        p.tap("tl")
        self.assertEqual(p.msgs, [])


class SlotTest(unittest.TestCase):
    def test_slot_restored_after_swallowed_slot_change(self):
        p = Pad()
        # A finger rests in slot 0 in the middle (a normal touch, forwarded).
        p.send([(EV_ABS, ABS_MT_SLOT, 0), (EV_ABS, ABS_MT_TRACKING_ID, 1),
                (EV_ABS, ABS_MT_POSITION_X, 500), (EV_ABS, ABS_MT_POSITION_Y, 250)])
        p.send([(EV_ABS, ABS_MT_TRACKING_ID, -1)])
        # Corner double tap in slot 1, swallowed.
        p.tap("tl", slot=1)
        p.tap("tl", slot=1)
        p.wait(0.5)
        n = len(p.out)
        # The kernel switches back to slot 0 explicitly here...
        p.send([(EV_ABS, ABS_MT_SLOT, 0), (EV_ABS, ABS_MT_TRACKING_ID, 9),
                (EV_ABS, ABS_MT_POSITION_X, 500), (EV_ABS, ABS_MT_POSITION_Y, 250)])
        # ...but a later frame in slot 0 without ABS_MT_SLOT must still be right.
        p.send([(EV_ABS, ABS_MT_POSITION_X, 510)])
        self.assertEqual(p.out[n][0], (EV_ABS, ABS_MT_SLOT, 0))
        self.assertEqual(p.out[n + 1], [(EV_ABS, ABS_MT_POSITION_X, 510)])

    def test_slot_prefixed_when_swallowed_frame_changed_it(self):
        p = Pad()
        p.tap("tl", slot=1)
        p.tap("tl", slot=1)
        p.wait(0.5)
        # The kernel's current slot is 1 now (it never switched back); libinput saw no
        # change from 0. The next frame touches slot 1 without naming it.
        p.send([(EV_ABS, ABS_MT_TRACKING_ID, 7), (EV_ABS, ABS_MT_POSITION_X, 500),
                (EV_ABS, ABS_MT_POSITION_Y, 250)])
        self.assertEqual(p.out[-1][0], (EV_ABS, ABS_MT_SLOT, 1))


class SettingsTest(unittest.TestCase):
    def test_update(self):
        s = TapSettings()
        bad = update_settings(s, {"enabled": True, "corner_mm": 20, "bound": ["tl2", "br3"], "x": 1})
        self.assertTrue(s.enabled)
        self.assertEqual(s.corner_mm, 20.0)
        self.assertEqual(s.bound, {"tl2", "br3"})
        self.assertEqual(bad, ["x"])
        self.assertEqual(update_settings(s, {"bound": ["zz9"]}), ["bound"])


if __name__ == "__main__":
    unittest.main()
