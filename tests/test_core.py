import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from gesture_core import (  # noqa: E402
    BTN_EXTRA, BTN_LEFT, BTN_RIGHT, Config, Emit, Engine, Message, Recognizer,
    classify, parse_command, update_config,
    EV_ABS, EV_KEY, EV_REL, EV_SYN, REL_WHEEL, REL_WHEEL_HI_RES, REL_X, REL_Y,
    GESTURE, IDLE, PASSED, SWALLOW, UNDECIDED,
)

SYN = Emit(EV_SYN, 0, 0)
DOWN = Emit(EV_KEY, BTN_RIGHT, 1)
UP = Emit(EV_KEY, BTN_RIGHT, 0)


def press(e, t=0.0):
    return e.handle(t, EV_KEY, BTN_RIGHT, 1)


def release(e, t=0.0):
    return e.handle(t, EV_KEY, BTN_RIGHT, 0)


def move(e, dx=0, dy=0, t=0.0):
    """Ein Paket (REL_X, REL_Y, SYN_REPORT) senden; das SYN fehlt in der Rückgabe."""
    out = []
    if dx:
        out += e.handle(t, EV_REL, REL_X, dx)
    if dy:
        out += e.handle(t, EV_REL, REL_Y, dy)
    out += e.handle(t, EV_SYN, 0, 0)
    return [a for a in out if a != SYN]


def payloads(actions):
    return [a.payload for a in actions if isinstance(a, Message)]


def types(actions):
    return [p["type"] for p in payloads(actions)]


def left(e, value, t=0.0):
    return e.handle(t, EV_KEY, BTN_LEFT, value)


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

    def test_pointing_stick_skipped_unless_included(self):
        self.assertIsNone(classify("TrackPoint", self.MOUSE, pointing_stick=True))
        self.assertEqual(classify("TrackPoint", self.MOUSE, pointing_stick=True,
                                  include_sticks=True), "pointer")

    def test_rocker_off_by_default(self):
        self.assertFalse(Config().rocker)

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
        self.assertEqual(out[0], Emit(EV_REL, REL_X, 25))
        self.assertEqual(types(out), ["start", "segment"])
        self.assertEqual(self.e.state, GESTURE)
        out = release(self.e, 0.2)
        self.assertEqual(types(out), ["end"])  # weder Druck noch Loslassen an die App
        self.assertFalse([a for a in out if isinstance(a, Emit)])
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

    def test_motion_after_gesture_start_passes_without_second_start(self):
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

    def test_release_ends_gesture_with_source_and_gesture(self):
        press(self.e)
        move(self.e, 30)
        self.assertEqual(payloads(release(self.e, 0.2)),
                         [{"type": "end", "source": "mouse", "gesture": "R"}])

    def test_release_without_segment_cancels(self):
        press(self.e)
        move(self.e, 15, 15)  # Diagonale: Schwelle erreicht, aber kein Segment
        self.assertEqual(self.e.state, GESTURE)
        self.assertEqual(payloads(release(self.e, 0.2)), [{"type": "cancel", "source": "mouse"}])

    def test_release_without_press_passes(self):
        self.assertEqual(release(self.e), [UP])

    def test_emergency_resets_gesture_and_swallows_late_release(self):
        press(self.e, 0)
        move(self.e, 30)
        self.assertEqual(self.e.deadline(), 10.0)
        self.assertEqual(self.e.tick(9.9), [])
        self.assertEqual(payloads(self.e.tick(10.0)), [{"type": "cancel", "source": "mouse"}])
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


def feed_all(rec, steps, t0=0.0, dt=0.01):
    """Schritte (dx, dy) einspeisen, alle Payloads sammeln."""
    out = []
    for i, (dx, dy) in enumerate(steps):
        out += rec.feed(t0 + i * dt, dx, dy)
    return out


def line(dx, dy, n):
    return [(dx, dy)] * n


def segs(out):
    return [p["dirs"] for p in out if p["type"] == "segment"]


class RecognizerTest(unittest.TestCase):
    def setUp(self):
        self.rec = Recognizer(Config(threshold=20))

    def run_path(self, steps, **kw):
        out = feed_all(self.rec, steps, **kw)
        return self.rec.gesture, out

    def test_four_directions(self):
        for steps, want in [(line(5, 0, 6), "R"), (line(-5, 0, 6), "L"),
                            (line(0, 5, 6), "D"), (line(0, -5, 6), "U")]:
            rec = Recognizer(Config(threshold=20))
            feed_all(rec, steps)
            self.assertEqual(rec.gesture, want)

    def test_start_precedes_first_segment(self):
        _, out = self.run_path(line(5, 0, 6))
        self.assertEqual([p["type"] for p in out if p["type"] != "progress"], ["start", "segment"])
        self.assertEqual(out[0], {"type": "start", "source": "mouse"})

    def test_same_directions_merge(self):
        gesture, out = self.run_path(line(5, 0, 40))
        self.assertEqual(gesture, "R")
        self.assertEqual(segs(out), ["R"])

    def test_corner_down_right(self):
        gesture, out = self.run_path(line(0, 5, 6) + line(5, 0, 6))
        self.assertEqual(gesture, "DR")
        self.assertEqual(segs(out), ["D", "DR"])

    def test_max_four_segments(self):
        path = line(5, 0, 6) + line(0, 5, 6) + line(-5, 0, 6) + line(0, -5, 6) + line(5, 0, 6)
        gesture, _ = self.run_path(path)
        self.assertEqual(gesture, "RDLU")

    def test_reversal_needs_full_threshold(self):
        # R weit, dann 15 zurück (unter 20): kein L
        gesture, _ = self.run_path(line(5, 0, 10) + line(-5, 0, 3))
        self.assertEqual(gesture, "R")

    def test_real_reversal_is_recognized(self):
        gesture, _ = self.run_path(line(5, 0, 10) + line(-5, 0, 6))
        self.assertEqual(gesture, "RL")

    def test_jitter_against_direction_is_absorbed(self):
        # Zittern um den Extrempunkt: nach jedem Rückschritt geht es wieder vor
        path = line(5, 0, 6)
        for _ in range(30):
            path += [(-6, 0), (7, 0)]
        gesture, _ = self.run_path(path)
        self.assertEqual(gesture, "R")

    def test_jittery_line_with_cross_noise(self):
        # Rechts mit Querrauschen (±3) und gelegentlichem Rückschritt
        noise = [3, -2, 1, -3, 2, 0, -1, 3, -3, 2]
        path = [(6, noise[i % 10]) for i in range(60)]
        path[15] = (-2, 3)
        path[40] = (-3, -3)
        gesture, _ = self.run_path(path)
        self.assertEqual(gesture, "R")

    def test_shallow_slope_stays_one_segment(self):
        # ~17° Neigung über 400 Einheiten: die Querachse darf nicht zu D anwachsen
        gesture, _ = self.run_path(line(10, 3, 40))
        self.assertEqual(gesture, "R")

    def test_steep_slope_picks_dominant_axis(self):
        gesture, _ = self.run_path(line(3, 10, 10))
        self.assertEqual(gesture, "D")

    def test_pure_diagonal_is_ambiguous(self):
        gesture, out = self.run_path(line(5, 5, 30))
        self.assertEqual(gesture, "")
        self.assertEqual(out[0]["type"], "start")  # Schwelle erreicht, Druck ist verworfen
        self.assertEqual(segs(out), [])

    def test_diagonal_then_straight_resolves(self):
        gesture, _ = self.run_path(line(5, 5, 4) + line(5, 0, 12))
        self.assertEqual(gesture, "R")

    def test_zigzag_below_threshold_does_nothing(self):
        rec = Recognizer(Config(threshold=20))
        self.assertEqual(feed_all(rec, [(8, 0), (-8, 0)] * 20), [])
        self.assertFalse(rec.started)

    def test_threshold_is_a_parameter_in_any_unit(self):
        # Trackpad: 12 mm je Segment, Deltas in Bruchteilen von mm
        rec = Recognizer(Config(threshold=12.0), source="touchpad", extra={"fingers": 3})
        out = feed_all(rec, line(0.5, 0, 30))
        self.assertEqual(rec.gesture, "R")
        self.assertEqual(out[0], {"type": "start", "source": "touchpad", "fingers": 3})

    def test_threshold_change_applies_live(self):
        cfg = Config(threshold=100)
        rec = Recognizer(cfg)
        feed_all(rec, line(5, 0, 6))
        self.assertEqual(rec.gesture, "")
        cfg.threshold = 20
        feed_all(rec, line(5, 0, 1), t0=1)
        self.assertEqual(rec.gesture, "R")

    def test_progress_grows_toward_threshold(self):
        _, out = self.run_path(line(0, 5, 6) + line(4, 0, 4), dt=0.05)
        prog = [p for p in out if p["type"] == "progress"]
        self.assertTrue(prog)
        self.assertTrue(all(p["dir"] == "R" for p in prog))
        ratios = [p["ratio"] for p in prog]
        self.assertEqual(ratios, sorted(ratios))
        self.assertLessEqual(ratios[-1], 1.0)

    def test_no_progress_along_current_segment(self):
        _, out = self.run_path(line(5, 0, 30), dt=0.05)
        self.assertEqual([p for p in out if p["type"] == "progress"], [])

    def test_progress_rate_limited_to_30hz(self):
        rec = Recognizer(Config(threshold=1000))
        rec.feed(0, 0, 1500)  # D, gestartet
        out = feed_all(rec, line(1, 0, 400), dt=0.001)  # 0,4 s in 1-ms-Schritten
        prog = [p for p in out if p["type"] == "progress"]
        self.assertGreater(len(prog), 3)
        self.assertLessEqual(len(prog), 13)  # 0,4 s * 30 Hz + 1

    def test_progress_payload_shape(self):
        rec = Recognizer(Config(threshold=20))
        feed_all(rec, line(0, 5, 6))  # D, gestartet
        out = rec.feed(10.0, 8, 0)
        self.assertEqual(out, [{"type": "progress", "source": "mouse", "dir": "R", "ratio": 0.4}])

    def test_reset_clears_everything(self):
        feed_all(self.rec, line(5, 0, 6))
        self.rec.reset()
        self.assertFalse(self.rec.started)
        self.assertEqual(self.rec.gesture, "")


class EngineGestureTest(unittest.TestCase):
    def setUp(self):
        self.e = Engine(Config())
        self.out = []

    def drag(self, steps, t=0.0):
        for dx, dy in steps:
            self.out += move(self.e, dx, dy, t)

    def test_full_sequence_of_events(self):
        press(self.e)
        self.drag(line(0, 5, 6) + line(5, 0, 6))
        self.out += release(self.e, 0.3)
        kinds = [(p["type"], p.get("dirs") or p.get("gesture")) for p in payloads(self.out)
                 if p["type"] != "progress"]
        self.assertEqual(kinds, [("start", None), ("segment", "D"), ("segment", "DR"), ("end", "DR")])
        self.assertEqual(self.e.state, IDLE)

    def test_x_and_y_events_of_one_frame_count_as_one_step(self):
        # 15/15 im selben Paket ist eine Diagonale, nicht zuerst 15 R und dann D
        press(self.e)
        self.drag([(15, 15)])
        self.assertEqual(types(self.out), ["start"])

    def test_motion_is_forwarded_during_gesture(self):
        press(self.e)
        self.drag([(30, 0)])
        self.assertEqual(self.out[0], Emit(EV_REL, REL_X, 30))

    def test_gesture_never_replays_the_press(self):
        press(self.e, 0)
        self.drag(line(0, 5, 6))
        self.assertEqual(self.e.tick(0.5), [])  # Haltezeit ist im GESTURE-Zustand egal
        self.assertEqual([a for a in release(self.e, 0.6) if isinstance(a, Emit)], [])

    def test_last_motion_before_release_counts(self):
        # Bewegung und Loslassen im selben Paket: erst das Segment, dann end
        press(self.e)
        self.e.handle(0, EV_REL, REL_X, 30)
        self.assertEqual(types(release(self.e, 0.1)), ["start", "segment", "end"])

    def test_new_press_resets_path(self):
        press(self.e)
        self.drag(line(5, 0, 6))
        release(self.e)
        press(self.e, 1)
        self.drag(line(0, -5, 6))
        self.assertEqual(payloads(release(self.e, 1.2))[-1]["gesture"], "U")

    def test_press_without_motion_after_gesture_still_clicks(self):
        press(self.e)
        self.drag(line(5, 0, 6))
        release(self.e)
        press(self.e, 1)
        self.assertEqual(release(self.e, 1.1), [DOWN, SYN, UP])


class WheelTest(unittest.TestCase):
    def setUp(self):
        self.e = Engine(Config())

    def wheel(self, value, hires=True, t=0.0):
        out = []
        if hires:
            out += self.e.handle(t, EV_REL, REL_WHEEL_HI_RES, value * 120)
        out += self.e.handle(t, EV_REL, REL_WHEEL, value)
        return out

    def test_wheel_while_trigger_held(self):
        press(self.e)
        out = self.wheel(1)
        self.assertEqual(payloads(out), [{"type": "wheel", "dir": "up"}])
        self.assertEqual([a for a in out if isinstance(a, Emit)], [])  # Rad nicht weiterreichen
        self.assertEqual(payloads(self.wheel(-1)), [{"type": "wheel", "dir": "down"}])

    def test_wheel_discards_press(self):
        press(self.e)
        self.wheel(1)
        self.assertEqual(self.e.state, GESTURE)
        self.assertEqual(release(self.e, 0.1), [])  # kein Rechtsklick, kein end
        self.assertEqual(self.e.state, IDLE)

    def test_wheel_without_trigger_passes(self):
        self.assertEqual(self.wheel(1, hires=False), [Emit(EV_REL, REL_WHEEL, 1)])

    def test_wheel_after_replayed_press_passes(self):
        # Rechts lange halten (Kontextmenü), dort scrollen: Rad gehört der Anwendung
        press(self.e, 0)
        self.e.tick(0.5)
        self.assertEqual(self.wheel(1, hires=False, t=1), [Emit(EV_REL, REL_WHEEL, 1)])

    def test_wheel_after_segment_cancels_path(self):
        press(self.e)
        move(self.e, 30)
        self.assertEqual(types(self.wheel(1, hires=False)), ["cancel", "wheel"])
        self.assertEqual(release(self.e, 0.2), [])  # kein end mehr

    def test_motion_after_wheel_is_not_recognized(self):
        press(self.e)
        self.wheel(1)
        self.assertEqual(types(move(self.e, 50)), [])
        self.assertEqual(release(self.e), [])

    def test_wheel_at_bypass_passes(self):
        self.e.set_passthrough(0, True)
        press(self.e)
        self.assertEqual(self.wheel(1, hires=False), [Emit(EV_REL, REL_WHEEL, 1)])

    def test_multi_step_value(self):
        press(self.e)
        self.assertEqual(types(self.wheel(3, hires=False)), ["wheel"] * 3)


class RockerTest(unittest.TestCase):
    def setUp(self):
        self.e = Engine(Config(rocker=True))

    def test_left_click_while_trigger_held(self):
        press(self.e)
        out = left(self.e, 1)
        self.assertEqual(payloads(out), [{"type": "rocker", "side": "left"}])
        self.assertEqual([a for a in out if isinstance(a, Emit)], [])
        self.assertEqual(left(self.e, 0), [])  # Loslassen ebenfalls geschluckt
        self.assertEqual(release(self.e, 0.2), [])  # und kein Rechtsklick
        self.assertEqual(self.e.state, IDLE)

    def test_repeated_rocker_while_held(self):
        press(self.e)
        for _ in range(3):
            self.assertEqual(types(left(self.e, 1)), ["rocker"])
            left(self.e, 0)

    def test_trigger_click_while_left_held(self):
        self.assertEqual(left(self.e, 1), [Emit(EV_KEY, BTN_LEFT, 1)])  # Links geht normal durch
        self.assertEqual(payloads(press(self.e)), [{"type": "rocker", "side": "right"}])
        self.assertEqual(release(self.e, 0.1), [])
        self.assertEqual(left(self.e, 0), [Emit(EV_KEY, BTN_LEFT, 0)])
        self.assertEqual(self.e.state, IDLE)

    def test_left_released_before_trigger_is_plain_click(self):
        left(self.e, 1)
        left(self.e, 0)
        press(self.e)
        self.assertEqual(release(self.e, 0.1), [DOWN, SYN, UP])

    def test_rocker_after_segment_cancels_path(self):
        press(self.e)
        move(self.e, 30)
        self.assertEqual(types(left(self.e, 1)), ["cancel", "rocker"])
        left(self.e, 0)
        self.assertEqual(release(self.e, 0.2), [])

    def test_left_click_after_replayed_press_passes(self):
        # Kontextmenü ist offen (Druck nachgesendet): Linksklick wählt einen Eintrag
        press(self.e, 0)
        self.e.tick(0.5)
        self.assertEqual(left(self.e, 1), [Emit(EV_KEY, BTN_LEFT, 1)])
        self.assertEqual(left(self.e, 0), [Emit(EV_KEY, BTN_LEFT, 0)])

    def test_rocker_can_be_disabled(self):
        e = Engine(Config(rocker=False))
        press(e)
        self.assertEqual(left(e, 1), [Emit(EV_KEY, BTN_LEFT, 1)])
        left(e, 0)
        release(e, 0.1)
        left(e, 1)
        self.assertEqual(press(e), [])
        self.assertEqual(e.state, UNDECIDED)

    def test_modifier_disables_rocker(self):
        self.e.set_modifiers(0, True)
        left(self.e, 1)
        self.assertEqual(press(self.e), [DOWN])


class PassthroughTest(unittest.TestCase):
    def test_pass_on_forwards_everything(self):
        e = Engine(Config())
        e.set_passthrough(0, True)
        self.assertEqual(press(e), [DOWN])
        self.assertEqual(move(e, 100), [Emit(EV_REL, REL_X, 100)])
        self.assertEqual(release(e), [UP])

    def test_pass_on_flushes_held_press(self):
        e = Engine(Config())
        press(e)
        self.assertEqual(e.set_passthrough(0.1, True), [DOWN, SYN])
        self.assertEqual(e.state, PASSED)

    def test_pass_on_leaves_running_gesture_alone(self):
        e = Engine(Config())
        press(e)
        move(e, 30)
        self.assertEqual(e.set_passthrough(0.1, True), [])
        self.assertEqual(types(release(e)), ["end"])

    def test_pass_off_restores_recognition(self):
        e = Engine(Config())
        e.set_passthrough(0, True)
        e.set_passthrough(0, False)
        self.assertEqual(press(e), [])
        self.assertEqual(e.state, UNDECIDED)

    def test_pass_and_modifier_are_independent(self):
        e = Engine(Config())
        e.set_passthrough(0, True)
        e.set_modifiers(0, True)
        e.set_modifiers(0, False)
        self.assertTrue(e.bypass)


class CommandTest(unittest.TestCase):
    def test_pass(self):
        self.assertEqual(parse_command("pass on\n"), ("pass", True))
        self.assertEqual(parse_command("pass off"), ("pass", False))
        self.assertIsNone(parse_command("pass maybe"))

    def test_config(self):
        self.assertEqual(parse_command('config {"threshold": 30}'), ("config", {"threshold": 30}))

    def test_garbage(self):
        for text in ("", "config", "config {", "config [1]", "config 5", "bogus", "pass"):
            self.assertIsNone(parse_command(text), text)

    def test_update_config(self):
        cfg = Config()
        self.assertEqual(update_config(cfg, {"threshold": 35, "hold_ms": 500, "rocker": False}), [])
        self.assertEqual((cfg.threshold, cfg.hold_time, cfg.rocker), (35.0, 0.5, False))

    def test_update_config_rejects_invalid_values_only(self):
        cfg = Config()
        rejected = update_config(cfg, {"threshold": 0, "hold_ms": "fast", "rocker": 1,
                                       "unknown": 1})
        self.assertEqual(sorted(rejected), ["hold_ms", "rocker", "threshold", "unknown"])
        self.assertEqual(cfg, Config())

    def test_update_config_keeps_valid_entries_next_to_invalid_ones(self):
        cfg = Config()
        self.assertEqual(update_config(cfg, {"threshold": 40, "hold_ms": -1}), ["hold_ms"])
        self.assertEqual(cfg.threshold, 40.0)

    def test_update_config_rejects_bool_and_nan_numbers(self):
        cfg = Config()
        self.assertEqual(sorted(update_config(cfg, {"threshold": True, "hold_ms": float("nan")})),
                         ["hold_ms", "threshold"])

    def test_config_reaches_running_engine(self):
        cfg = Config()
        e = Engine(cfg)
        update_config(cfg, {"threshold": 60})
        press(e)
        move(e, 30)
        self.assertEqual(e.state, UNDECIDED)
        move(e, 40)
        self.assertEqual(e.state, GESTURE)

    def test_hold_time_change_moves_deadline(self):
        cfg = Config()
        e = Engine(cfg)
        press(e, 1.0)
        update_config(cfg, {"hold_ms": 100})
        self.assertEqual(e.deadline(), 1.1)


if __name__ == "__main__":
    unittest.main()


class RingTest(unittest.TestCase):
    """Double click with the second press held opens the workspace ring."""

    def setUp(self):
        self.e = Engine(Config(ring=True))

    def test_double_click_hold_opens_and_closes_ring(self):
        press(self.e, 0.0)
        self.assertEqual(release(self.e, 0.05), [])  # first click held back
        self.assertEqual(payloads(press(self.e, 0.15)), [{"type": "ring", "phase": "open"}])
        move(self.e, 80, 0, 0.3)  # pointer moves on, no line gesture
        self.assertEqual(payloads(release(self.e, 0.5)), [{"type": "ring", "phase": "close"}])
        self.assertEqual(self.e.state, "idle")

    def test_single_click_is_replayed_after_double_time(self):
        press(self.e, 0.0)
        release(self.e, 0.05)
        self.assertEqual(self.e.tick(0.2), [])
        out = self.e.tick(0.31)
        self.assertEqual([a for a in out if isinstance(a, Emit) and a.etype == EV_KEY],
                         [Emit(EV_KEY, BTN_RIGHT, 1), Emit(EV_KEY, BTN_RIGHT, 0)])

    def test_other_button_flushes_held_click_first(self):
        press(self.e, 0.0)
        release(self.e, 0.05)
        out = left(self.e, 1, 0.1)
        keys = [(a.code, a.value) for a in out if isinstance(a, Emit) and a.etype == EV_KEY]
        self.assertEqual(keys, [(BTN_RIGHT, 1), (BTN_RIGHT, 0), (BTN_LEFT, 1)])

    def test_ring_swallows_wheel(self):
        press(self.e, 0.0)
        release(self.e, 0.05)
        press(self.e, 0.1)
        self.assertEqual(self.e.handle(0.2, EV_REL, REL_WHEEL, 1), [])

    def test_modifier_releases_held_click(self):
        press(self.e, 0.0)
        release(self.e, 0.05)
        out = self.e.set_modifiers(0.1, True)
        self.assertEqual(len([a for a in out if isinstance(a, Emit) and a.etype == EV_KEY]), 2)

    def test_ring_off_keeps_immediate_click(self):
        e = Engine(Config(ring=False))
        press(e, 0.0)
        self.assertEqual(len(release(e, 0.05)), 3)

    def test_gesture_still_works_with_ring_on(self):
        press(self.e, 0.0)
        for i in range(10):
            move(self.e, -10, 0, 0.01 * i)
        self.assertEqual(payloads(release(self.e, 0.3))[-1]["gesture"], "L")

    def test_config_keys(self):
        cfg = Config()
        self.assertEqual(update_config(cfg, {"ring": True, "double_ms": 300}), [])
        self.assertTrue(cfg.ring)
        self.assertAlmostEqual(cfg.double_time, 0.3)
        self.assertEqual(update_config(cfg, {"double_ms": 5000}), ["double_ms"])
