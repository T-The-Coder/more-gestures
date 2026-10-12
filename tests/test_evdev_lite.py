"""evdev_lite: the ioctl numbers and structs against the kernel headers' values, and
the plain-Python device layer against a real uinput device when this user may make one."""

import os
import select
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import evdev_lite as ev  # noqa: E402
import gesture_core as core  # noqa: E402


class Numbers(unittest.TestCase):
    def test_ioctl_requests_match_the_headers(self):
        # Values from linux/input.h and linux/uinput.h as compiled on x86_64.
        self.assertEqual(ev.EVIOCGRAB, 0x40044590)
        self.assertEqual(ev.EVIOCGID, 0x80084502)
        self.assertEqual(ev.EVIOCGNAME(256), 0x81004506)
        self.assertEqual(ev.EVIOCGBIT(0, 4), 0x80044520)
        self.assertEqual(ev.EVIOCGABS(0x35), 0x80184575)
        self.assertEqual(ev.EVIOCGPROP(4), 0x80044509)
        self.assertEqual(ev.UI_DEV_CREATE, 0x5501)
        self.assertEqual(ev.UI_DEV_DESTROY, 0x5502)
        self.assertEqual(ev.UI_DEV_SETUP, 0x405C5503)
        self.assertEqual(ev.UI_ABS_SETUP, 0x401C5504)
        self.assertEqual(ev.UI_SET_EVBIT, 0x40045564)
        self.assertEqual(ev.UI_SET_PROPBIT, 0x4004556E)

    def test_struct_sizes(self):
        self.assertEqual(ev.EVENT.size, 24 if struct_long() == 8 else 16)
        self.assertEqual(ev.UINPUT_SETUP.size, 92)
        self.assertEqual(ev.UINPUT_ABS_SETUP.size, 28)

    def test_bits_and_event_parsing(self):
        self.assertEqual(ev._bits(bytes([0b101, 0, 0x80])), [0, 2, 23])
        raw = ev.EVENT.pack(1, 2, ev.EV_KEY, 273, 1) + ev.EVENT.pack(1, 3, 0, 0, 0) + b"\0" * 5
        events = ev.parse_events(raw)
        self.assertEqual([(e.type, e.code, e.value) for e in events], [(1, 273, 1), (0, 0, 0)])


def struct_long():
    import struct
    return struct.calcsize("@l")


@unittest.skipUnless(ev.access()["uinput"], "this user cannot create uinput devices")
class RoundTrip(unittest.TestCase):
    """A virtual mouse made here is found, read, cloned and grabbed like a real one."""

    def test_clone_and_events(self):
        caps = {ev.EV_KEY: [272, 273], ev.EV_REL: [0, 1]}
        src = ev.UInput(caps, core.VIRTUAL_NAME_PREFIX + " test mouse", input_props=[ev.INPUT_PROP_POINTING_STICK],
                        vendor=0x1234, product=0x5678, version=3, bustype=0x03)
        try:
            dev = wait_for(core.VIRTUAL_NAME_PREFIX + " test mouse")
            try:
                self.assertEqual(dev.info, ev.DeviceInfo(0x03, 0x1234, 0x5678, 3))
                self.assertEqual(dev.capabilities(), {ev.EV_KEY: [272, 273], ev.EV_REL: [0, 1]})
                self.assertIn(ev.INPUT_PROP_POINTING_STICK, dev.input_props())
                clone = ev.UInput.from_device(dev, name=core.VIRTUAL_NAME_PREFIX + " test clone")
                try:
                    copy = wait_for(core.VIRTUAL_NAME_PREFIX + " test clone")
                    try:
                        self.assertEqual(copy.info, dev.info)
                        self.assertEqual(copy.capabilities(), dev.capabilities())
                        self.assertEqual(copy.input_props(), dev.input_props())
                    finally:
                        copy.close()
                finally:
                    clone.close()
                dev.grab()
                src.write(ev.EV_KEY, 273, 1)
                src.syn()
                select.select([dev.fd], [], [], 1.0)
                got = [(e.type, e.code, e.value) for e in dev.read()]
                self.assertEqual(got, [(ev.EV_KEY, 273, 1), (ev.EV_SYN, ev.SYN_REPORT, 0)])
                src.write(ev.EV_KEY, 273, 0)
                src.syn()
                dev.ungrab()
            finally:
                dev.close()
        finally:
            src.close()

    def test_touchpad_axes_are_cloned(self):
        caps = {ev.EV_KEY: [0x14E], ev.EV_ABS: [0x35, 0x36]}  # BTN_TOOL_TRIPLETAP, MT X/Y
        info = {0x35: ev.AbsInfo(0, 0, 1000, 0, 0, 12), 0x36: ev.AbsInfo(0, 0, 600, 0, 0, 10)}
        src = ev.UInput(caps, core.VIRTUAL_NAME_PREFIX + " test pad", absinfo=info)
        try:
            dev = wait_for(core.VIRTUAL_NAME_PREFIX + " test pad")
            try:
                self.assertEqual(dev.absinfo(0x35), info[0x35])
                self.assertEqual(dev.absinfo(0x36).resolution, 10)
            finally:
                dev.close()
        finally:
            src.close()


def wait_for(name, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for path in ev.list_devices():
            try:
                dev = ev.InputDevice(path)
            except OSError:
                continue
            if dev.name == name:
                return dev
            dev.close()
        time.sleep(0.05)
    raise AssertionError(f"{name} did not appear")


if __name__ == "__main__":
    unittest.main()
