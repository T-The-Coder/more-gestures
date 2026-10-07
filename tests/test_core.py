import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from gesture_core import (  # noqa: E402
    BTN_EXTRA, BTN_RIGHT, Config, Emit, Engine, Message, classify,
    EV_ABS, EV_KEY, EV_REL, EV_SYN, REL_X, REL_Y,
    GESTURE, IDLE, PASSED, SWALLOW, UNDECIDED,
)

SYN = Emit(EV_SYN, 0, 0)
DOWN = Emit(EV_KEY, BTN_RIGHT, 1)
UP = Emit(EV_KEY, BTN_RIGHT, 0)
CANDIDATE = Message({"type": "gesture-candidate"})


def press(e, t=0.0):
    return e.handle(t, EV_KEY, BTN_RIGHT, 1)


def release(e, t=0.0):
    return e.handle(t, EV_KEY, BTN_RIGHT, 0)


def move(e, dx=0, dy=0, t=0.0):
    out = []
    if dx:
        out += e.handle(t, EV_REL, REL_X, dx)
    if dy:
        out += e.handle(t, EV_REL, REL_Y, dy)
    return out


class ClassifyTest(unittest.TestCase):
    MOUSE = {EV_KEY: [BTN_RIGHT, 0x110], EV_REL: [REL_X, REL_Y, 8]}

    def test_mouse(self):
        self.assertEqual(classify("Mouse", self.MOUSE), "pointer")

    def test_missing_trigger_button(self):
        caps = {EV_KEY: [0x110], EV_REL: [REL_X, REL_Y]}
        self.assertIsNone(classify("Mouse", caps))
        caps[EV_KEY].append(BTN_EXTRA)
        self.assertEqual(classify("Mouse", caps, BTN_EXTRA), "pointer")

    def test_touchpad_with_abs_mt_is_ignored(self):
        caps = dict(self.MOUSE)
        caps[EV_ABS] = [(0x35, object()), (0x36, object())]
        self.assertIsNone(classify("Touchpad", caps))

    def test_abs_without_mt_is_fine(self):
        caps = dict(self.MOUSE)
        caps[EV_ABS] = [(0x00, object())]
        self.assertEqual(classify("Mouse", caps), "pointer")

    def test_own_virtual_device_is_excluded(self):
        self.assertIsNone(classify("more-gestures virtual (Mouse)", self.MOUSE))

    def test_no_rel_is_not_pointer(self):
        self.assertIsNone(classify("Tablet", {EV_KEY: [BTN_RIGHT]}))

    def test_keyboard(self):
        self.assertEqual(classify("Kbd", {EV_KEY: [30, 42, 29]}), "keyboard")

    def test_keyboard_mouse_combo_is_pointer_only(self):
        caps = dict(self.MOUSE)
        caps[EV_KEY] = [BTN_RIGHT, 30, 42]
        self.assertEqual(classify("Combo", caps), "pointer")


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.e = Engine(Config())

    def test_unrelated_events_pass_through(self):
        self.assertEqual(self.e.handle(0, EV_KEY, 0x110, 1), [Emit(EV_KEY, 0x110, 1)])
        self.assertEqual(move(self.e, 5, -3), [Emit(EV_REL, REL_X, 5), Emit(EV_REL, REL_Y, -3)])
        self.assertEqual(self.e.handle(0, EV_SYN, 0, 0), [SYN])
        self.assertEqual(self.e.state, IDLE)

    def test_press_is_held_back(self):
        self.assertEqual(press(self.e), [])
        self.assertEqual(self.e.state, UNDECIDED)

    def test_click_replays_press_and_release(self):
        press(self.e)
        self.assertEqual(release(self.e, 0.1), [DOWN, SYN, UP])
        self.assertEqual(self.e.state, IDLE)

    def test_small_motion_passes_and_still_clicks(self):
        press(self.e)
        self.assertEqual(move(self.e, 5, 5), [Emit(EV_REL, REL_X, 5), Emit(EV_REL, REL_Y, 5)])
        self.assertEqual(self.e.state, UNDECIDED)
        self.assertEqual(release(self.e, 0.1), [DOWN, SYN, UP])

    def test_motion_over_threshold_discards_press(self):
        press(self.e)
        out = move(self.e, 25)
        self.assertEqual(out, [Emit(EV_REL, REL_X, 25), CANDIDATE])
        self.assertEqual(self.e.state, GESTURE)
        self.assertEqual(release(self.e, 0.2), [])  # weder Druck noch Loslassen
        self.assertEqual(self.e.state, IDLE)

    def test_threshold_is_exclusive_and_diagonal(self):
        press(self.e)
        move(self.e, 20)
        self.assertEqual(self.e.state, UNDECIDED)
        move(self.e, 0, 1)
        self.assertEqual(self.e.state, GESTURE)

    def test_diagonal_accumulates(self):
        press(self.e)
        move(self.e, 15, 15)  # Betrag ~21
        self.assertEqual(self.e.state, GESTURE)

    def test_opposite_motion_cancels_out(self):
        press(self.e)
        move(self.e, 15)
        move(self.e, -15)
        move(self.e, 15)
        self.assertEqual(self.e.state, UNDECIDED)

    def test_motion_after_gesture_start_passes_without_second_candidate(self):
        press(self.e)
        move(self.e, 30)
        self.assertEqual(move(self.e, 30), [Emit(EV_REL, REL_X, 30)])

    def test_motion_without_button_is_not_accumulated(self):
        move(self.e, 500)
        press(self.e)
        self.assertEqual(self.e.state, UNDECIDED)

    def test_hold_replays_press_after_350ms(self):
        press(self.e, 1.0)
        self.assertEqual(self.e.deadline(), 1.35)
        self.assertEqual(self.e.tick(1.34), [])
        self.assertEqual(self.e.tick(1.35), [DOWN, SYN])
        self.assertEqual(self.e.state, PASSED)
        self.assertIsNone(self.e.deadline())

    def test_after_hold_motion_and_release_pass_through(self):
        press(self.e, 0)
        self.e.tick(0.4)
        self.assertEqual(move(self.e, 100), [Emit(EV_REL, REL_X, 100)])
        self.assertEqual(self.e.state, PASSED)
        self.assertEqual(release(self.e, 2.0), [UP])
        self.assertEqual(self.e.state, IDLE)

    def test_modifier_down_before_press_passes_immediately(self):
        self.e.set_modifiers(0, True)
        self.assertEqual(press(self.e), [DOWN])
        self.assertEqual(move(self.e, 100), [Emit(EV_REL, REL_X, 100)])
        self.assertEqual(release(self.e), [UP])
        self.assertEqual(self.e.state, IDLE)

    def test_modifier_after_press_flushes_held_press(self):
        press(self.e)
        self.assertEqual(self.e.set_modifiers(0.1, True), [DOWN, SYN])
        self.assertEqual(self.e.state, PASSED)
        self.assertEqual(release(self.e, 0.5), [UP])

    def test_modifier_during_gesture_changes_nothing(self):
        press(self.e)
        move(self.e, 30)
        self.assertEqual(self.e.set_modifiers(0.1, True), [])
        self.assertEqual(self.e.state, GESTURE)

    def test_modifier_released_mid_passed_press_still_releases(self):
        self.e.set_modifiers(0, True)
        press(self.e)
        self.e.set_modifiers(0.1, False)
        self.assertEqual(release(self.e), [UP])

    def test_release_without_press_passes(self):
        self.assertEqual(release(self.e), [UP])

    def test_emergency_resets_gesture_and_swallows_late_release(self):
        press(self.e, 0)
        move(self.e, 30)
        self.assertEqual(self.e.deadline(), 10.0)
        self.assertEqual(self.e.tick(9.9), [])
        self.assertEqual(self.e.tick(10.0), [Message({"type": "cancel"})])
        self.assertEqual(self.e.state, SWALLOW)
        self.assertEqual(release(self.e, 12), [])
        self.assertEqual(self.e.state, IDLE)

    def test_swallow_then_new_press_starts_fresh(self):
        press(self.e, 0)
        move(self.e, 30)
        self.e.tick(10)
        self.assertEqual(press(self.e, 11), [])
        self.assertEqual(self.e.state, UNDECIDED)
        self.assertEqual(release(self.e, 11.1), [DOWN, SYN, UP])

    def test_reset_after_dropped_events(self):
        press(self.e)
        self.e.reset()
        self.assertEqual(self.e.state, SWALLOW)
        self.assertEqual(release(self.e), [])
        press(self.e)
        self.e.tick(1)
        self.e.reset()
        self.assertEqual(release(self.e), [UP])

    def test_shutdown_releases_delivered_press_only(self):
        press(self.e)
        self.assertEqual(self.e.shutdown(), [])  # nie ausgeliefert: nichts loszulassen
        press(self.e)
        self.e.tick(1)
        self.assertEqual(self.e.shutdown(), [UP, SYN])
        self.assertEqual(self.e.state, IDLE)

    def test_other_trigger_button(self):
        e = Engine(Config(trigger=BTN_EXTRA))
        self.assertEqual(e.handle(0, EV_KEY, BTN_RIGHT, 1), [Emit(EV_KEY, BTN_RIGHT, 1)])
        self.assertEqual(e.handle(0, EV_KEY, BTN_EXTRA, 1), [])
        self.assertEqual(e.state, UNDECIDED)

    def test_duplicate_press_does_not_reset_timer(self):
        press(self.e, 0)
        press(self.e, 0.3)
        self.assertEqual(self.e.deadline(), 0.35)


if __name__ == "__main__":
    unittest.main()
