"""Verify kitty-compress keeps the terminal showing Herdr's latest pane images."""

import base64
import importlib.machinery
import importlib.util
import itertools
import random
import re
import struct
import unittest
import zlib
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader(
    "kitty_compress", str(Path(__file__).with_name("kitty-compress"))
)
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)

APC, ST = b"\x1b_G", b"\x1b\\"


def upload(header, raw, chunk=4096):
    encoded = base64.b64encode(raw)
    parts = [encoded[i:i + chunk] for i in range(0, len(encoded), chunk)]
    output = []
    for index, part in enumerate(parts):
        more = b"1" if index < len(parts) - 1 else b"0"
        control = header + b",m=" + more if index == 0 else b"m=" + more
        output.append(APC + control + b";" + part + ST)
    return b"".join(output)


def decode(stream):
    """Return (non-graphics bytes, [(first control, decoded payload)])."""
    text, images, pending = [], [], None
    while stream:
        start = stream.find(APC)
        if start < 0:
            text.append(stream)
            break
        text.append(stream[:start])
        end = stream.find(ST, start)
        header, _, payload = stream[start + 3:end].partition(b";")
        stream = stream[end + 2:]
        if pending is None:
            pending = [header, payload]
        else:
            pending[1] += payload
        if b"m=1" not in header.split(b","):
            images.append((pending[0], base64.b64decode(pending[1])))
            pending = None
    return b"".join(text), images


@contextmanager
def clock():
    """A controllable monotonic clock for the module under test."""
    now = [1000.0]
    with patch.object(module.time, "monotonic", lambda: now[0]):
        yield now


def drain(queue, limit=None):
    """Write queued output to a link that accepts at most `limit` more bytes."""
    output = bytearray()

    def send(data):
        count = len(data) if limit is None else min(len(data), limit - len(output))
        if not count:
            raise BlockingIOError
        output.extend(data[:count])
        return count

    while queue.pending_bytes and (limit is None or len(output) < limit):
        if not queue.write(send):
            break
    return bytes(output)


def proxy(stream, partial=False):
    """Pass Herdr output through an unthrottled image lifecycle."""
    queue = module.ImageLifecycle(partial=partial)
    queue.receive(stream)
    queue.finish()
    return drain(queue)


class KittyModel:
    """The subset of a Kitty terminal Herdr's output relies on."""

    def __init__(self):
        self.images = {}
        self.scratch = {}
        self.placements = self.placed_missing = self.edits = 0
        self.pending = None
        self.buffer = b""

    def feed(self, stream):
        # Output arrives in arbitrary pieces; keep an unfinished command.
        self.buffer += stream
        cut = self.buffer.rfind(ST) + len(ST) if ST in self.buffer else 0
        complete, self.buffer = self.buffer[:cut], self.buffer[cut:]
        for header, payload in re.findall(rb"\x1b_G([^;\x1b]*);?([^\x1b]*)\x1b\\", complete):
            keys = module.controls(header)
            if self.pending is not None:
                self.pending[1].append(payload)
                if keys.get(b"m") != b"1":
                    first, parts = self.pending
                    self.pending = None
                    self.apply(first, b"".join(parts))
                continue
            if keys.get(b"m") == b"1":
                self.pending = (keys, [payload])
                continue
            self.apply(keys, payload)

    def apply(self, keys, payload):
        action, image = keys.get(b"a", b"t"), keys.get(b"i")
        data = base64.b64decode(payload) if payload else b""
        if keys.get(b"o") == b"z":
            data = zlib.decompress(data)
        if action == b"t":
            self.images[image] = [int(keys[b"s"]), int(keys[b"v"]), bytearray(data)]
            self.scratch.pop(image, None)
        elif action == b"d" and keys.get(b"d") == b"I":
            self.images.pop(image, None)
            self.scratch.pop(image, None)
        elif action == b"d" and keys.get(b"d") == b"f":
            assert keys[b"r"] == b"2"
            del self.scratch[image]
        elif action == b"p":
            self.placements += 1
            self.placed_missing += image not in self.images
        elif action == b"f":
            self.edits += 1
            width, height, root = self.images[image]
            if keys.get(b"r", b"0") == b"0":
                assert image not in self.scratch and keys[b"c"] == b"1"
                self.scratch[image] = bytearray(root)
            pixels = root if keys.get(b"r") == b"1" else self.scratch[image]
            x, y, w, h = (int(keys[k]) for k in (b"x", b"y", b"s", b"v"))
            assert x + w <= width and y + h <= height and len(data) == w * h * 4
            for row in range(h):
                start = ((y + row) * width + x) * 4
                pixels[start:start + w * 4] = data[row * w * 4:(row + 1) * w * 4]
        elif action == b"c":
            width, height, root = self.images[image]
            src, dst = (root if keys[k] == b"1" else self.scratch[image] for k in (b"r", b"c"))
            x, y, left, top = (int(keys[k]) for k in (b"x", b"y", b"X", b"Y"))
            w, h = int(keys[b"w"]) or width, int(keys[b"h"]) or height
            assert src is not dst and keys[b"C"] == b"1"
            assert max(x, left) + w <= width and max(y, top) + h <= height
            for row in range(h):
                start, end = ((row + dy) * width + dx for dx, dy in ((left, top), (x, y)))
                dst[end * 4:(end + w) * 4] = src[start * 4:(start + w) * 4]


def herdr_frame(image, raw, width, height, text=b""):
    """One Herdr frame: delete, upload, cursor move, then placement."""
    return (
        APC + b"a=d,d=I,i=" + image + b",q=2;" + ST
        + upload(b"a=t,t=d,f=32,s=%d,v=%d,i=%s,q=2" % (width, height, image), raw)
        + b"\x1b[2;3H" + APC + b"a=p,i=" + image + b",p=1,c=10,r=5,q=2;" + ST + text
    )


class Link:
    """A terminal on the far end of a link: shows output and answers requests."""

    def __init__(self, queue):
        self.queue, self.model, self.tail, self.unanswered = queue, KittyModel(), b"", 0

    def receive(self, limit=None, answer=True):
        output = drain(self.queue, limit)
        self.model.feed(output)
        self.unanswered += (self.tail + output).count(module.PING)
        self.tail = (self.tail + output)[-(len(module.PING) - 1):]
        if answer and self.unanswered:
            assert self.queue.terminal_input(module.PONG * self.unanswered) == b""
            self.unanswered = 0
        return output

    def settle(self, now):
        """Let motion end and everything, including sharp redraws, arrive."""
        for _ in range(10):
            now[0] += module.REFINE_DELAY + module.MOTION_HOLD
            self.queue.tick()
            self.receive()


class CompressTests(unittest.TestCase):
    def test_raw_upload_is_compressed_without_changing_pixels_or_text_order(self):
        raw = bytes(range(256)) * 300 + b"\xff" * 400000
        header = b"a=t,t=d,f=32,s=100,v=1003,i=7,q=2"
        placement = APC + b"a=p,i=7,p=1,c=10,r=5,q=2" + ST
        stream = b"\x1b[?2026hbefore" + upload(header, raw) + placement + b"after\x1b[?2026l"
        output = proxy(stream)
        text, images = decode(output)
        self.assertEqual(text, b"\x1b[?2026hbeforeafter\x1b[?2026l")
        (first, payload), placed = images
        self.assertIn(b"o=z", first.split(b","))
        self.assertEqual(zlib.decompress(payload), raw)
        self.assertEqual(placed[0], b"a=p,i=7,p=1,c=10,r=5,q=2")
        self.assertLess(len(output), len(stream) // 20)
        self.assertLess(output.index(placement), output.index(b"after"))

    def test_split_reads_produce_the_same_output(self):
        raw = bytes(range(256)) * 300
        stream = b"a" + upload(b"a=t,t=d,f=32,s=100,v=192,i=7,q=2", raw) + b"b"
        for seed in range(5):
            rng = random.Random(seed)
            queue = module.ImageLifecycle()
            index = 0
            while index < len(stream):
                size = rng.randint(1, 9000)
                queue.receive(stream[index:index + size])
                index += size
            queue.finish()
            with self.subTest(seed=seed):
                self.assertEqual(drain(queue), proxy(stream))

    def test_ineligible_or_interrupted_uploads_pass_through(self):
        raw = b"\x01\x02\x03\x04" * 3000
        for stream in (
            upload(b"a=t,t=d,f=100,i=1", raw),
            upload(b"a=t,t=d,f=32,o=z,i=1", zlib.compress(raw)),
            APC + b"a=t,t=t,f=32,i=1;" + base64.b64encode(b"/tmp/frame") + ST,
            APC + b"a=d,d=I,i=1,q=2" + ST,
        ):
            with self.subTest(stream=stream[:30]):
                self.assertEqual(proxy(stream), stream)
        first, rest = upload(b"a=t,t=d,f=32,i=2", raw).split(ST, 1)
        interrupted = first + ST + APC + b"a=d,i=2" + ST
        self.assertEqual(proxy(interrupted), interrupted)


class ImageOrderingTests(unittest.TestCase):
    def test_unsent_frames_for_an_image_collapse_to_the_newest(self):
        queue = module.ImageLifecycle()
        stream = (
            herdr_frame(b"5", b"\x01\x02\x03\x04" * 1000, 100, 10, b"one")
            + herdr_frame(b"6", b"\x09\x09\x09\x09" * 1000, 100, 10, b"other")
            + herdr_frame(b"5", b"\x05\x06\x07\x08" * 1000, 100, 10, b"two")
        )
        queue.receive(stream)
        output = drain(queue)
        self.assertEqual(output.count(b"a=p,i=5,"), 1)
        text, _ = decode(output)
        # Text and the other image survive; image 5 keeps only its newest frame.
        self.assertEqual(text, b"\x1b[2;3Hone\x1b[2;3Hother\x1b[2;3Htwo")
        model = KittyModel()
        model.feed(output)
        self.assertEqual(model.placed_missing, 0)
        self.assertEqual(bytes(model.images[b"5"][2]), b"\x05\x06\x07\x08" * 1000)
        self.assertEqual(bytes(model.images[b"6"][2]), b"\x09\x09\x09\x09" * 1000)

    def test_partly_written_frame_completes_before_a_newer_one(self):
        queue = module.ImageLifecycle()
        first = random.Random(2).randbytes(4000)
        newest = b"\x05\x06\x07\x08" * 1000
        queue.receive(herdr_frame(b"5", first, 100, 10))
        prefix = drain(queue, limit=300)
        self.assertIn(b"a=t", prefix)
        self.assertNotIn(ST, prefix.split(b"a=t", 1)[1])  # Upload is incomplete.
        queue.receive(herdr_frame(b"5", newest, 100, 10))
        output = prefix + drain(queue)
        _, commands = decode(output)
        uploads = [zlib.decompress(payload) for header, payload in commands if header.startswith(b"a=t,")]
        self.assertEqual(uploads, [first, newest])
        model = KittyModel()
        model.feed(output)
        self.assertEqual(bytes(model.images[b"5"][2]), newest)
        self.assertEqual(model.placed_missing, 0)

    def test_hide_and_reveal_during_a_partial_write_show_the_newest_frame(self):
        queue = module.ImageLifecycle(partial=True)
        first = random.Random(2).randbytes(4000)
        newest = b"\x05\x06\x07\x08" + first[4:]
        queue.receive(herdr_frame(b"5", first, 100, 10))
        prefix = drain(queue, limit=300)
        self.assertIn(b"a=t", prefix)
        self.assertNotIn(ST, prefix.split(b"a=t", 1)[1])
        queue.receive(APC + b"a=d,d=I,i=5,q=2;" + ST + b"\x1b[Hother tab")
        queue.receive(herdr_frame(b"5", bytes(4000), 100, 10))
        queue.receive(herdr_frame(b"5", newest, 100, 10))
        output = prefix + drain(queue)
        placement = b"a=p,i=5,"
        hide = output.index(b"a=d,d=i,i=5,")
        self.assertEqual(output.count(placement), 2)
        self.assertLess(output.index(placement), hide)
        self.assertLess(hide, output.rindex(placement))
        model = KittyModel()
        model.feed(output)
        self.assertEqual(bytes(model.images[b"5"][2]), newest)
        self.assertEqual(model.placed_missing, 0)


class PacingTests(unittest.TestCase):
    width, height = 40, 20

    def pixels(self, value):
        return bytes((value, value, value, 255)) * (self.width * self.height)

    def frame(self, value):
        return herdr_frame(b"9", self.pixels(value), self.width, self.height)

    def test_next_image_waits_for_the_terminal_and_only_the_newest_is_sent(self):
        queue = module.ImageLifecycle(partial=True, paced=True, window=0)
        link = Link(queue)
        with clock() as now:
            queue.receive(self.frame(8))
            first = link.receive(answer=False)
            self.assertTrue(first.endswith(module.PING + b"\x1b[2;3H" + APC + b"a=p,i=9,p=1,c=10,r=5,q=2;" + ST))
            # Two newer frames arrive before the terminal answers.
            queue.receive(self.frame(16))
            queue.receive(self.frame(24))
            # The old image stays: nothing for the newer frames is sent yet.
            self.assertNotIn(APC, link.receive(answer=False))
            self.assertFalse(queue.poll()[0])
            # The reply is consumed here and never reaches Herdr.
            self.assertEqual(queue.terminal_input(b"x" + module.PONG + b"y"), b"xy")
            link.unanswered = 0
            self.assertTrue(queue.poll()[0])
            self.assertEqual(link.receive().count(b"a=p,i=9,"), 1)
            link.settle(now)
        self.assertEqual(bytes(link.model.images[b"9"][2]), self.pixels(24))

    def test_herdr_status_requests_keep_their_replies(self):
        queue = module.ImageLifecycle(partial=True, paced=True)
        queue.receive(module.PING + self.frame(1))
        drain(queue)
        # The first reply answers Herdr's request, the second ours.
        self.assertEqual(queue.terminal_input(module.PONG + module.PONG), module.PONG)
        self.assertEqual(queue.terminal_input(module.PONG), module.PONG)

    def test_silent_terminal_stops_pacing_but_late_replies_are_removed(self):
        queue = module.ImageLifecycle(partial=True, paced=True, window=0)
        with clock() as now:
            queue.receive(self.frame(1))
            drain(queue)
            queue.receive(self.frame(2))
            self.assertFalse(queue.poll()[0])
            now[0] += module.PING_TIMEOUT + 1
            self.assertTrue(queue.poll()[0])
            output = drain(queue)
            self.assertIn(b"a=t", output)
            self.assertNotIn(module.PING, output)
        self.assertEqual(queue.terminal_input(module.PONG), b"")
        self.assertEqual(queue.terminal_input(module.PONG), module.PONG)

    def test_slow_reply_from_an_answering_terminal_keeps_pacing(self):
        queue = module.ImageLifecycle(partial=True, paced=True, window=0)
        with clock() as now:
            queue.receive(self.frame(1))
            drain(queue)
            queue.terminal_input(module.PONG)
            queue.receive(self.frame(2))
            drain(queue)
            # A burst delays this reply well past the no-reply timeout.
            queue.receive(self.frame(3))
            now[0] += module.PING_TIMEOUT + 1
            self.assertFalse(queue.poll()[0])
            queue.terminal_input(module.PONG)
            self.assertIn(b"a=t", drain(queue))
            # A reply that never arrives stops blocking frames, not pacing.
            queue.receive(self.frame(4))
            now[0] += module.SLOW_REPLY + 1
            self.assertTrue(queue.poll()[0])
            self.assertIn(module.PING, drain(queue))

    def test_small_updates_fit_the_window_but_large_frames_wait(self):
        width, height = 128, 80
        queue = module.ImageLifecycle(partial=True, paced=True, window=4096)
        rng = random.Random(1)
        noise = bytes(rng.getrandbits(8) for _ in range(width * height * 4))
        queue.receive(herdr_frame(b"9", noise, width, height))
        drain(queue)
        queue.terminal_input(module.PONG)
        # One-pixel changes are tiny edits; each goes out while earlier ones
        # are still unanswered.
        for value in (0, 1):
            changed = bytes((value, 0, 0, 255)) + noise[4:]
            queue.receive(herdr_frame(b"9", changed, width, height))
            self.assertIn(b"a=f", drain(queue))
        # A whole new incompressible frame exceeds the window and waits.
        other = bytes(rng.getrandbits(8) for _ in range(width * height * 4))
        queue.receive(herdr_frame(b"9", other, width, height))
        self.assertNotIn(APC, drain(queue))
        queue.terminal_input(module.PONG * 2)
        self.assertIn(b"a=t", drain(queue))


class ScrollTests(unittest.TestCase):
    width, height = 192, 192

    def page(self, start, seed=6):
        """A moving body, stationary header and sidebar, and moving scrollbar."""
        rng = random.Random(seed)
        rows = [rng.randbytes((self.width - 12) * 4) for _ in range(self.height + 64)]
        sidebar = b"\xff" * 12 * 4
        return b"".join(rows[y] + sidebar if y < 9 else rows[start + y] + sidebar[:-4] + bytes((y == 40 + start,)) * 4
                        for y in range(self.height))

    def test_scrolls_send_exact_pixels_before_the_terminal_answers(self):
        queue = module.ImageLifecycle(partial=True, paced=True, scroll_copy=True)
        link = Link(queue)
        with clock():
            first = self.page(12)
            queue.receive(herdr_frame(b"9", first, self.width, self.height))
            link.receive()
            for start in (16, 20, 16):
                raw = self.page(start)
                queue.receive(herdr_frame(b"9", raw, self.width, self.height))
                # Stop after the scratch copy, before repairs or the final copy.
                prefix = link.receive(limit=200, answer=False)
                self.assertIn(b"a=c", prefix)
                self.assertEqual(bytes(link.model.images[b"9"][2]), first)
                output = link.receive(answer=False)
                self.assertLess(len(prefix + output), 8 * 1024)
                self.assertEqual(bytes(link.model.images[b"9"][2]), raw)
                self.assertFalse(link.model.scratch)
                first = raw
            self.assertEqual(link.unanswered, 3)
            self.assertEqual(link.model.placed_missing, 0)

    def test_scroll_reuses_coarse_pixels_then_sharpens_the_latest_frame(self):
        queue = module.ImageLifecycle(partial=True, paced=True, scroll_copy=True)
        link = Link(queue)

        def enqueue(start):
            raw = self.page(start)
            queue.receive(herdr_frame(b"9", raw, self.width, self.height))
            return raw

        with clock() as now:
            enqueue(0)
            link.receive()
            sharp = enqueue(32)
            self.assertIn(b"a=c", link.receive(answer=False))
            coarse = bytes(link.model.images[b"9"][2])
            self.assertNotEqual(coarse, sharp)
            enqueue(36)
            latest = enqueue(40)
            output = link.receive()
            self.assertIn(b"a=c", output)
            self.assertEqual(output.count(b"a=p,i=9,"), 1)
            # The skipped frame is not the base. Pixels in the newly exposed
            # band from the last sent frame are still coarse after shifting.
            stride, y = self.width * 4, self.height - 18
            shown = bytes(link.model.images[b"9"][2])
            self.assertEqual(shown[y * stride:(y + 1) * stride], coarse[(y + 8) * stride:(y + 9) * stride])
            self.assertNotEqual(shown, latest)
            link.settle(now)
        self.assertEqual(bytes(link.model.images[b"9"][2]), latest)

    def test_scrolls_stop_sending_when_unanswered_bytes_fill_the_window(self):
        queue = module.ImageLifecycle(partial=True, paced=True, scroll_copy=True)
        link = Link(queue)
        with clock():
            queue.receive(herdr_frame(b"9", self.page(0), self.width, self.height))
            link.receive()
            sent = 0
            for i in range(32):
                raw = self.page(4 * (1 + i % 2))
                queue.receive(herdr_frame(b"9", raw, self.width, self.height))
                sent += len(link.receive(answer=False))
            self.assertGreater(sent, 32 * 1024)  # More than ordinary edits can pipeline.
            self.assertLessEqual(sent, 64 * 1024 + 2048)  # Placement/text bytes aren't gated.
            latest = self.page(12)
            queue.receive(herdr_frame(b"9", latest, self.width, self.height))
            self.assertNotIn(b"a=c", link.receive(answer=False))
            link.receive()  # Acknowledge the in-flight deltas.
            self.assertIn(b"a=c", link.receive())
            self.assertEqual(bytes(link.model.images[b"9"][2]), latest)

    def test_unrelated_content_keeps_the_existing_whole_frame_path(self):
        queue = module.ImageLifecycle(partial=True, scroll_copy=True)
        link = Link(queue)
        for seed in (20, 70):
            raw = self.page(0, seed)
            queue.receive(herdr_frame(b"9", raw, self.width, self.height))
            output = link.receive()
            self.assertNotIn(b"a=c", output)
            self.assertEqual(bytes(link.model.images[b"9"][2]), raw)


class MotionTests(unittest.TestCase):
    width, height = 64, 48

    def test_frames_in_motion_are_coarse_then_sharpened(self):
        rng = random.Random(4)
        frames = [bytes(rng.getrandbits(8) for _ in range(self.width * self.height * 4)) for _ in range(3)]
        queue = module.ImageLifecycle(partial=True, paced=True, window=0)
        link = Link(queue)
        with clock() as now:
            queue.receive(herdr_frame(b"9", frames[0], self.width, self.height))
            link.receive(answer=False)
            # The next frames arrive while the first is unanswered: motion.
            for raw in frames[1:]:
                queue.receive(herdr_frame(b"9", raw, self.width, self.height))
            link.receive()  # Answers the first frame's request.
            link.receive()
            coarse = module.coarse(frames[2], self.width, self.height, 4)
            self.assertEqual(bytes(link.model.images[b"9"][2]), coarse)
            # With no new I/O, the advertised timeout wakes the sharp redraw.
            writable, timeout = queue.poll()
            self.assertFalse(writable)
            self.assertIsNotNone(timeout)
            now[0] += timeout + 0.001
            queue.tick()
            link.receive()
        self.assertEqual(bytes(link.model.images[b"9"][2]), frames[2])

    def test_coarse_frames_are_much_smaller(self):
        # A photo-like gradient with slight noise in every channel.
        rng = random.Random(4)
        raw = b"".join(
            bytes((x * 3 + rng.randrange(6), y * 4 + rng.randrange(6), 128 + rng.randrange(6), 255))
            for y in range(self.height) for x in range(self.width)
        )
        full = len(zlib.compress(raw, 6))
        coarse = len(zlib.compress(module.coarse(raw, self.width, self.height, 4), 6))
        self.assertLess(coarse, full / 2)


class HiddenImageTests(unittest.TestCase):
    width, height = 40, 20

    def pixels(self, value):
        return bytes((value, value, value, 255)) * (self.width * self.height)

    def test_hidden_image_keeps_its_pixels_and_returns_as_an_edit(self):
        queue = module.ImageLifecycle(partial=True)
        model = KittyModel()
        queue.receive(herdr_frame(b"9", self.pixels(1), self.width, self.height))
        model.feed(drain(queue))
        # Herdr deletes the image when its tab is hidden; only placements go.
        queue.receive(APC + b"a=d,d=I,i=9,q=2;" + ST + b"\x1b[Hother tab")
        hidden = drain(queue)
        self.assertIn(b"a=d,d=i,i=9", hidden)
        model.feed(hidden)
        self.assertIn(b"9", model.images)
        # Showing the tab again re-uploads the same pixels: nothing to send.
        queue.receive(herdr_frame(b"9", self.pixels(1), self.width, self.height))
        shown = drain(queue)
        self.assertNotIn(b"a=t", shown)
        self.assertNotIn(b"a=f", shown)
        self.assertIn(b"a=p,i=9,", shown)
        model.feed(shown)
        self.assertEqual(model.placed_missing, 0)

    def test_held_delete_wakes_the_link_without_more_herdr_output(self):
        queue = module.ImageLifecycle(partial=True)
        with clock() as now:
            queue.receive(herdr_frame(b"9", self.pixels(1), self.width, self.height))
            drain(queue)
            queue.receive(APC + b"a=d,d=I,i=9,q=2;" + ST)
            writable, timeout = queue.poll()
            self.assertFalse(writable)
            self.assertIsNotNone(timeout)
            queue.tick()
            self.assertEqual(drain(queue), b"")
            now[0] += timeout + 0.001
            queue.tick()
            self.assertIn(b"a=d,d=i,i=9,", drain(queue))

    def test_oldest_hidden_image_is_deleted_and_later_sent_whole(self):
        queue = module.ImageLifecycle(partial=True)
        model = KittyModel()
        with patch.object(module, "MAX_HIDDEN", 1):
            for image in (b"7", b"8"):
                queue.receive(herdr_frame(image, self.pixels(1), self.width, self.height))
                queue.receive(APC + b"a=d,d=I,i=" + image + b",q=2;" + ST + b"\x1b[Hother")
            model.feed(drain(queue))
            self.assertNotIn(b"7", model.images)
            self.assertIn(b"8", model.images)
            queue.receive(herdr_frame(b"7", self.pixels(1), self.width, self.height))
            shown = drain(queue)
        self.assertIn(b"a=t", shown)
        model.feed(shown)
        self.assertEqual(model.placed_missing, 0)


class ScalingTests(unittest.TestCase):
    def test_reported_pixel_size_shrinks_but_cells_do_not(self):
        size = struct.pack("HHHH", 37, 88, 2200, 1813)
        self.assertEqual(struct.unpack("HHHH", module.scaled_size(size, 2)), (37, 88, 1100, 906))

    def test_pixel_mouse_and_size_replies_are_scaled_only_when_reported_in_pixels(self):
        scaler = module.InputScaler(2)
        cell_mouse = b"\x1b[<0;10;20M"
        self.assertEqual(scaler.input(cell_mouse), cell_mouse)
        scaler.output(b"\x1b[?1006h\x1b[?1016h")
        self.assertEqual(scaler.input(b"a\x1b[<0;101;41Mb\x1b[<0;2;2m"), b"a\x1b[<0;51;21Mb\x1b[<0;1;1m")
        self.assertEqual(scaler.input(b"\x1b[6;49;25t"), b"\x1b[6;24;12t")
        scaler.output(b"\x1b[?1016l")
        self.assertEqual(scaler.input(cell_mouse), cell_mouse)

    def test_split_reports_are_joined_but_escape_is_not_held(self):
        scaler = module.InputScaler(2)
        scaler.output(b"\x1b[?1016h")
        self.assertEqual(scaler.input(b"x\x1b[<0;10"), b"x")
        self.assertEqual(scaler.input(b"1;41M"), b"\x1b[<0;51;21M")
        self.assertEqual(scaler.input(b"\x1b"), b"\x1b")


class LinkTests(unittest.TestCase):
    width, height = 80, 40

    def frames(self, seed, count):
        rng = random.Random(seed)
        pixels = bytearray(bytes((250, 250, 250, 255)) * (self.width * self.height))
        for _ in range(count):
            if rng.random() < 0.15:
                # A scroll-like change of most rows.
                pixels = pixels[self.width * 4 * 7:] + pixels[:self.width * 4 * 7]
            else:
                x, y = rng.randrange(self.width - 6), rng.randrange(self.height - 4)
                color = bytes((rng.randrange(256), rng.randrange(256), rng.randrange(256), 255))
                for row in range(rng.randrange(1, 4)):
                    start = ((y + row) * self.width + x) * 4
                    pixels[start:start + 20] = color * 5
            yield bytes(pixels)

    def run_link(self, seed, partial, step=None, paced=False, window=module.WINDOW):
        """Feed frames to the proxy while a slow link drains random amounts."""
        rng = random.Random(seed + 1)
        queue = module.ImageLifecycle(partial=partial, paced=paced, window=window)
        link, sent, last = Link(queue), 0, None
        with clock() as now:
            for raw in self.frames(seed, 40):
                now[0] += rng.random() * 0.2
                if rng.random() < 0.1:
                    # Switching tabs deletes the image with no upload behind it.
                    queue.receive(APC + b"a=d,d=I,i=9,q=2;" + ST + b"\x1b[Hother tab")
                last = raw
                queue.receive(herdr_frame(b"9", raw, self.width, self.height))
                queue.tick()
                # The terminal answers status requests some time after receiving them.
                sent += len(link.receive(limit=step or rng.randrange(1, 300), answer=rng.random() < 0.5))
            queue.finish()
            link.receive()
            link.settle(now)
        return link, last, sent

    def test_terminal_ends_on_the_newest_frame_over_any_link_speed(self):
        skipped_runs = 0
        for seed in range(120):
            for partial, paced, window in itertools.product((False, True), (False, True), (0, 2000)):
                with self.subTest(seed=seed, partial=partial, paced=paced, window=window):
                    link, last, _ = self.run_link(seed, partial, paced=paced, window=window)
                    self.assertEqual(bytes(link.model.images[b"9"][2]), last)
                    self.assertEqual(link.model.placed_missing, 0)
                    self.assertFalse(link.unanswered)
                    skipped_runs += link.model.placements < 40
        # Confirm the random link is slow enough to skip some frames.
        self.assertGreater(skipped_runs, 50)

    def test_slowly_streamed_upload_still_becomes_an_edit(self):
        # Herdr streams a large upload over many PTY reads after its delete.
        queue = module.ImageLifecycle(partial=True)
        frames = list(self.frames(5, 2))
        queue.receive(herdr_frame(b"9", frames[0], self.width, self.height))
        drain(queue)
        stream = herdr_frame(b"9", frames[1], self.width, self.height)
        with clock() as now:
            for index in range(0, len(stream), 512):
                queue.receive(stream[index:index + 512])
                now[0] += module.HOLD_SECONDS * 2
                queue.tick()
        output = drain(queue)
        self.assertIn(b"a=f,i=9,", output)
        model = KittyModel()
        model.images[b"9"] = [self.width, self.height, bytearray(frames[0])]
        model.feed(output)
        self.assertEqual(bytes(model.images[b"9"][2]), frames[1])

    def test_small_changes_send_edits_instead_of_whole_images(self):
        link, last, partial_bytes = self.run_link(3, True, step=1 << 20)
        _, _, full_bytes = self.run_link(3, False, step=1 << 20)
        self.assertEqual(bytes(link.model.images[b"9"][2]), last)
        self.assertGreater(link.model.edits, 20)
        self.assertLess(partial_bytes, full_bytes / 2)


if __name__ == "__main__":
    unittest.main()
