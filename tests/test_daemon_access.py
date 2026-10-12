"""The daemon before and after the one-time setup: a device it may not open or clone
yet is tried again on the next scan (logged once), so gestures start working seconds
after the setup command, without a restart. Devices are faked; nothing is opened."""

import errno
import importlib.machinery
import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stderr

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
_loader = importlib.machinery.SourceFileLoader("gesture_daemon", os.path.join(HERE, "..", "bin", "gesture-daemon"))
_spec = importlib.util.spec_from_loader("gesture_daemon", _loader)
daemon_mod = importlib.util.module_from_spec(_spec)
_loader.exec_module(daemon_mod)
evdev = daemon_mod.evdev


class FakeMouse:
    name = "Test Mouse"
    path = "/dev/input/event90"
    fd = 90
    info = evdev.DeviceInfo(3, 1, 2, 1)

    def capabilities(self):
        return {evdev.EV_KEY: [272, 273, 274], evdev.EV_REL: [0, 1, 8]}

    def input_props(self):
        return []

    def grab(self):
        pass

    def close(self):
        pass


class Access(unittest.TestCase):
    def setUp(self):
        self.saved = (evdev.list_devices, evdev.InputDevice, evdev.UInput.from_device)
        evdev.list_devices = lambda: ["/dev/input/event90"]
        args = daemon_mod.parse_args([])
        self.d = daemon_mod.Daemon(args)
        self.d.sel.register = lambda *a, **k: None

    def tearDown(self):
        evdev.list_devices, evdev.InputDevice, evdev.UInput.from_device = self.saved

    def test_unreadable_device_is_retried_and_logged_once(self):
        def denied(path):
            raise PermissionError(errno.EACCES, "Permission denied", path)
        evdev.InputDevice = denied
        err = io.StringIO()
        with redirect_stderr(err):
            self.d.scan()
            self.d.scan()
        self.assertEqual(err.getvalue().count("cannot open"), 1)
        self.assertNotIn("/dev/input/event90", self.d.rejected)
        # The setup ran: the next scan opens and grabs it.
        evdev.InputDevice = lambda path: FakeMouse()
        evdev.UInput.from_device = classmethod(lambda cls, dev, **kw: object())
        with redirect_stderr(io.StringIO()):
            self.d.scan()
        self.assertIn("/dev/input/event90", self.d.pointers)
        self.assertNotIn("/dev/input/event90", self.d.denied)

    def test_missing_uinput_is_retried(self):
        evdev.InputDevice = lambda path: FakeMouse()

        def no_uinput(cls, dev, **kw):
            raise PermissionError(errno.EACCES, "Permission denied", "/dev/uinput")
        evdev.UInput.from_device = classmethod(no_uinput)
        err = io.StringIO()
        with redirect_stderr(err):
            self.d.scan()
            self.d.scan()
        self.assertEqual(err.getvalue().count("cannot clone"), 1)
        self.assertNotIn("/dev/input/event90", self.d.rejected)
        self.assertNotIn("/dev/input/event90", self.d.pointers)
        evdev.UInput.from_device = classmethod(lambda cls, dev, **kw: object())
        with redirect_stderr(io.StringIO()):
            self.d.scan()
        self.assertIn("/dev/input/event90", self.d.pointers)

    def test_other_grab_errors_still_reject(self):
        evdev.InputDevice = lambda path: FakeMouse()

        def busy(cls, dev, **kw):
            raise OSError(errno.EBUSY, "Device or resource busy")
        evdev.UInput.from_device = classmethod(busy)
        with redirect_stderr(io.StringIO()):
            self.d.scan()
        self.assertIn("/dev/input/event90", self.d.rejected)


if __name__ == "__main__":
    unittest.main()
