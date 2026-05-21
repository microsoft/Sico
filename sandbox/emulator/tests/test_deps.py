# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

from app.deps import DeviceIndexMap


class TestDeviceIndexMap:
    def test_initially_empty(self):
        m = DeviceIndexMap()
        assert m.list_connected_indices() == []
        assert not m.has_index(0)
        assert m.get_serial(0) is None

    def test_manual_population(self):
        m = DeviceIndexMap()
        # Simulate what refresh() does internally
        m._index_to_serial = {0: "127.0.0.1:5554", 1: "127.0.0.1:5556", 2: None}
        m._loaded = True

        assert m.has_index(0)
        assert m.has_index(1)
        assert m.has_index(2)
        assert not m.has_index(3)

        assert m.get_serial(0) == "127.0.0.1:5554"
        assert m.get_serial(1) == "127.0.0.1:5556"
        assert m.get_serial(2) is None  # index exists but no serial

    def test_list_connected_excludes_none(self):
        m = DeviceIndexMap()
        m._index_to_serial = {0: "127.0.0.1:5554", 1: None, 2: "127.0.0.1:5558"}
        assert m.list_connected_indices() == [0, 2]

    def test_list_connected_sorted(self):
        m = DeviceIndexMap()
        m._index_to_serial = {3: "s3", 1: "s1", 5: "s5"}
        assert m.list_connected_indices() == [1, 3, 5]

    def test_thread_safety(self):
        """Verify no crash under concurrent access (basic smoke test)."""
        import threading

        m = DeviceIndexMap()
        errors = []

        def writer():
            try:
                for i in range(100):
                    m._lock.acquire()
                    m._index_to_serial[i % 5] = f"host:{5554 + i}"
                    m._lock.release()
            except Exception as e:
                errors.append(e)

        def reader():
            try:
                for _ in range(100):
                    m.list_connected_indices()
                    m.get_serial(0)
                    m.has_index(1)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer) for _ in range(3)]
        threads += [threading.Thread(target=reader) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Concurrent access errors: {errors}"
