"""Verify image uploads stay byte-identical after Kitty zlib compression."""

import base64
import importlib.machinery
import importlib.util
import itertools
import os
import random
import re
import unittest
import zlib
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


def feed_in_pieces(data, seed, scale=1):
    compressor = module.Compressor(scale)
    rng = random.Random(seed)
    output, index = [], 0
    while index < len(data):
        size = rng.randint(1, 9000)
        output.append(compressor.feed(data[index:index + size]))
        index += size
    output.append(compressor.finish())
    return b"".join(output)


class CompressTests(unittest.TestCase):
    def test_raw_upload_is_compressed_without_changing_pixels_or_text_order(self):
        raw = bytes(range(256)) * 300 + b"\xff" * 400000
        header = b"a=t,t=d,f=32,s=100,v=1003,i=7,q=2"
        placement = APC + b"a=p,i=7,p=1,c=10,r=5,q=2" + ST
        stream = b"\x1b[?2026hbefore" + upload(header, raw) + placement + b"after\x1b[?2026l"
        for seed in range(5):
            with self.subTest(seed=seed):
                output = feed_in_pieces(stream, seed)
                text, images = decode(output)
                self.assertEqual(text, b"\x1b[?2026hbeforeafter\x1b[?2026l")
                (first, payload), placed = images
                self.assertIn(b"o=z", first.split(b","))
                self.assertEqual(zlib.decompress(payload), raw)
                self.assertEqual(placed[0], b"a=p,i=7,p=1,c=10,r=5,q=2")
                self.assertLess(len(output), len(stream) // 20)
                self.assertLess(output.index(placement), output.index(b"after"))

    def test_scale_samples_pixels_and_rewrites_matching_placements(self):
        width, height = 5, 3
        pixels = [bytes((x, y, 7, 255)) for y in range(height) for x in range(width)]
        header = b"a=t,t=d,f=32,s=5,v=3,i=9,q=2"
        placement = APC + b"a=p,i=9,p=1,c=10,r=5,w=5,h=3,q=2" + ST
        other = APC + b"a=p,i=8,p=1,c=10,r=5,w=5,h=3,q=2" + ST
        output = feed_in_pieces(upload(header, b"".join(pixels), chunk=8) + placement + other, 3, scale=2)
        _, images = decode(output)
        (first, payload), (placed, _), (unrelated, _) = images
        keys = module.controls(first)
        self.assertEqual((keys[b"s"], keys[b"v"]), (b"3", b"2"))
        expected = b"".join(pixels[y * width + x] for y in (0, 2) for x in (0, 2, 4))
        self.assertEqual(zlib.decompress(payload), expected)
        # The scaled image keeps its cell size; only its pixel source rect shrinks.
        self.assertEqual(placed, b"a=p,i=9,p=1,c=10,r=5,w=3,h=2,q=2")
        self.assertEqual(unrelated, b"a=p,i=8,p=1,c=10,r=5,w=5,h=3,q=2")

    def test_ineligible_or_interrupted_uploads_pass_through(self):
        raw = b"\x01\x02\x03\x04" * 3000
        for stream in (
            upload(b"a=t,t=d,f=100,i=1", raw),
            upload(b"a=t,t=d,f=32,o=z,i=1", zlib.compress(raw)),
            APC + b"a=t,t=t,f=32,i=1;" + base64.b64encode(b"/tmp/frame") + ST,
            APC + b"a=d,d=I,i=1,q=2" + ST,
        ):
            with self.subTest(stream=stream[:30]):
                self.assertEqual(feed_in_pieces(stream, 1), stream)
        first, rest = upload(b"a=t,t=d,f=32,i=2", raw).split(ST, 1)
        interrupted = first + ST + APC + b"a=d,i=2" + ST
        self.assertEqual(feed_in_pieces(interrupted, 2), interrupted)


class KittyModel:
    """The subset of a Kitty terminal Herdr's output relies on."""

    def __init__(self):
        self.images = {}
        self.placed_missing = 0
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
        elif action == b"d":
            self.images.pop(image, None)
        elif action == b"p":
            self.placed_missing += image not in self.images
        elif action == b"f":
            width, _, pixels = self.images[image]
            x, y, w, h = (int(keys[k]) for k in (b"x", b"y", b"s", b"v"))
            for row in range(h):
                start = ((y + row) * width + x) * 4
                pixels[start:start + w * 4] = data[row * w * 4:(row + 1) * w * 4]


def herdr_frame(image, raw, width, height, text=b""):
    """One Herdr frame: delete, upload, cursor move, then placement."""
    return (
        APC + b"a=d,d=I,i=" + image + b",q=2;" + ST
        + upload(b"a=t,t=d,f=32,s=%d,v=%d,i=%s,q=2" % (width, height, image), raw)
        + b"\x1b[2;3H" + APC + b"a=p,i=" + image + b",p=1,c=10,r=5,q=2;" + ST + text
    )


def drain(queue, limit=None):
    """Write queued output to a link that accepts at most `limit` more bytes."""
    output = bytearray()
    budget = [float("inf") if limit is None else limit]

    def link(fd, data):
        count = int(min(len(data), budget[0]))
        if not count:
            raise BlockingIOError
        output.extend(bytes(data[:count]))
        budget[0] -= count
        return count

    with patch.object(module.os, "write", link):
        while queue.size and budget[0]:
            if not queue.write(-1):
                break
    return bytes(output)


class QueueTests(unittest.TestCase):
    def test_unsent_frames_for_an_image_collapse_to_the_newest(self):
        compressor, queue = module.Compressor(), module.OutputQueue()
        stream = (
            herdr_frame(b"5", b"\x01\x02\x03\x04" * 1000, 100, 10, b"one")
            + herdr_frame(b"6", b"\x09\x09\x09\x09" * 1000, 100, 10, b"other")
            + herdr_frame(b"5", b"\x05\x06\x07\x08" * 1000, 100, 10, b"two")
        )
        queue.add(compressor.segments(stream))
        self.assertEqual(queue.dropped, 1)
        output = drain(queue)
        text, _ = decode(output)
        # Text and the other image survive; image 5 keeps only its newest frame.
        self.assertEqual(text, b"\x1b[2;3Hone\x1b[2;3Hother\x1b[2;3Htwo")
        model = KittyModel()
        model.feed(output)
        self.assertEqual(model.placed_missing, 0)
        self.assertEqual(bytes(model.images[b"5"][2]), b"\x05\x06\x07\x08" * 1000)
        self.assertEqual(bytes(model.images[b"6"][2]), b"\x09\x09\x09\x09" * 1000)

    def test_partially_written_upload_is_never_dropped(self):
        compressor, queue = module.Compressor(), module.OutputQueue()
        queue.add(compressor.segments(herdr_frame(b"5", b"\x01\x02\x03\x04" * 1000, 100, 10)))
        while queue.segments[0][1] is None or queue.segments[0][1][0] != "upload":
            queue.size -= len(queue.segments.pop(0)[0])
        queue.offset = 1  # The link has sent part of the first upload.
        queue.add(compressor.segments(herdr_frame(b"5", b"\x05\x06\x07\x08" * 1000, 100, 10)))
        self.assertEqual(queue.dropped, 0)
        self.assertTrue(queue.segments[0][0])


class PacingTests(unittest.TestCase):
    width, height = 40, 20

    def frame(self, value):
        return herdr_frame(b"9", bytes((value, value, value, 255)) * (self.width * self.height), self.width, self.height)

    def test_next_image_waits_for_the_terminal_and_only_the_newest_is_sent(self):
        compressor = module.Compressor(partial=True)
        queue = module.OutputQueue(compressor, paced=True)
        queue.add(compressor.segments(self.frame(1)))
        first = drain(queue)
        self.assertTrue(first.endswith(module.PING + b"\x1b[2;3H" + APC + b"a=p,i=9,p=1,c=10,r=5,q=2;" + ST))
        # Two newer frames arrive before the terminal answers.
        queue.add(compressor.segments(self.frame(2)))
        queue.add(compressor.segments(self.frame(3)))
        held = drain(queue)
        # The old image stays: neither the delete nor the upload is sent yet.
        self.assertNotIn(APC, held)
        self.assertFalse(queue.ready())
        # The reply is consumed here and never reaches Herdr.
        self.assertEqual(queue.replies(b"x" + module.PONG + b"y"), b"xy")
        self.assertTrue(queue.ready())
        model = KittyModel()
        model.feed(first + held + drain(queue))
        self.assertEqual(bytes(model.images[b"9"][2]), bytes((3, 3, 3, 255)) * (self.width * self.height))
        self.assertEqual(queue.dropped, 1)

    def test_herdr_status_requests_keep_their_replies(self):
        compressor = module.Compressor(partial=True)
        queue = module.OutputQueue(compressor, paced=True)
        queue.add(compressor.segments(module.PING + self.frame(1)))
        drain(queue)
        # The first reply answers Herdr's request, the second ours.
        self.assertEqual(queue.replies(module.PONG + module.PONG), module.PONG)
        self.assertFalse(queue.requests)

    def test_silent_terminal_stops_pacing_but_late_replies_are_removed(self):
        compressor = module.Compressor(partial=True)
        queue = module.OutputQueue(compressor, paced=True)
        clock = [0.0]
        with patch.object(module.time, "monotonic", lambda: clock[0]):
            queue.add(compressor.segments(self.frame(1)))
            drain(queue)
            queue.add(compressor.segments(self.frame(2)))
            self.assertFalse(queue.ready())
            clock[0] += module.PING_TIMEOUT + 1
            self.assertTrue(queue.ready())
            self.assertIn(b"a=t", drain(queue))
            self.assertFalse(queue.paced)
        self.assertEqual(queue.replies(module.PONG), b"")


class PartialEditTests(unittest.TestCase):
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

    def run_link(self, seed, partial, scale=1, step=None, paced=False):
        """Feed frames to the proxy while a slow link drains random amounts."""
        rng = random.Random(seed + 1)
        compressor = module.Compressor(scale, partial=partial)
        queue = module.OutputQueue(compressor, paced=paced)
        unanswered = 0
        model, sent, last = KittyModel(), 0, None
        for raw in self.frames(seed, 40):
            if rng.random() < 0.1:
                # Switching tabs deletes the image with no upload behind it.
                queue.add(compressor.segments(APC + b"a=d,d=I,i=9,q=2;" + ST + b"\x1b[Hother tab"))
            last = raw
            queue.add(compressor.segments(herdr_frame(b"9", raw, self.width, self.height)))
            queue.add(compressor.expired())
            output = drain(queue, limit=step or rng.randrange(1, 300))
            sent += len(output)
            model.feed(output)
            # The terminal answers status requests some time after receiving them.
            unanswered += output.count(module.PING)
            if unanswered and rng.random() < 0.5:
                self.assertEqual(queue.replies(module.PONG * unanswered), b"")
                unanswered = 0
        queue.add([(compressor.finish(), None)])
        while queue.size:
            output = drain(queue)
            sent += len(output)
            model.feed(output)
            queue.replies(module.PONG * (unanswered + output.count(module.PING)))
            unanswered = 0
        if scale > 1:
            last = module.downscale(last, self.width, self.height, 4, scale)[0]
        return model, last, sent, compressor, queue

    def test_terminal_ends_on_the_newest_frame_over_any_link_speed(self):
        dropped = 0
        for seed in range(160):
            for partial, scale, paced in itertools.product((False, True), (1, 2), (False, True)):
                with self.subTest(seed=seed, partial=partial, scale=scale, paced=paced):
                    model, last, _, _, queue = self.run_link(seed, partial, scale, paced=paced)
                    self.assertEqual(bytes(model.images[b"9"][2]), last)
                    self.assertEqual(model.placed_missing, 0)
                    self.assertFalse(queue.requests)
                    dropped += queue.dropped
        # The random link must be slow enough to exercise frame dropping.
        self.assertGreater(dropped, 50)

    def test_slowly_streamed_upload_still_becomes_an_edit(self):
        # Herdr streams a large upload over many PTY reads after its delete.
        compressor = module.Compressor(partial=True)
        queue = module.OutputQueue(compressor)
        frames = list(self.frames(5, 2))
        queue.add(compressor.segments(herdr_frame(b"9", frames[0], self.width, self.height)))
        drain(queue)
        stream = herdr_frame(b"9", frames[1], self.width, self.height)
        clock = [0.0]
        with patch.object(module.time, "monotonic", lambda: clock[0]):
            for index in range(0, len(stream), 512):
                queue.add(compressor.segments(stream[index:index + 512]))
                clock[0] += module.HOLD_SECONDS * 2
                queue.add(compressor.expired())
        self.assertEqual(compressor.edits, 1)
        model = KittyModel()
        model.images[b"9"] = [self.width, self.height, bytearray(frames[0])]
        model.feed(drain(queue))
        self.assertEqual(bytes(model.images[b"9"][2]), frames[1])

    def test_small_changes_send_edits_instead_of_whole_images(self):
        model, last, partial_bytes, compressor, _ = self.run_link(3, True, step=1 << 20)
        _, _, full_bytes, _, _ = self.run_link(3, False, step=1 << 20)
        self.assertEqual(bytes(model.images[b"9"][2]), last)
        self.assertGreater(compressor.edits, 20)
        self.assertLess(partial_bytes, full_bytes / 2)


if __name__ == "__main__":
    unittest.main()
