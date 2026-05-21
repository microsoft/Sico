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

"""Tests for app.storage.fs — StorageFS, SCMemoryFS, ChatFS, parse_skill_frontmatter."""

import pytest

from app.storage.fs import ChatFS, SCMemoryFS, StorageFS, parse_skill_frontmatter


# ===========================================================================
# parse_skill_frontmatter (pure function)
# ===========================================================================


class TestParseSkillFrontmatter:
    def test_full_frontmatter(self):
        content = "---\nname: MySkill\ndescription: Does something\n---\n# Body"
        result = parse_skill_frontmatter(content)
        assert result == {"name": "MySkill", "description": "Does something"}

    def test_no_frontmatter(self):
        assert parse_skill_frontmatter("# Just a heading") == {}

    def test_empty_string(self):
        assert parse_skill_frontmatter("") == {}

    def test_quoted_values(self):
        content = '---\nname: "Quoted Name"\ndescription: \'Single Quoted\'\n---'
        result = parse_skill_frontmatter(content)
        assert result["name"] == "Quoted Name"
        assert result["description"] == "Single Quoted"

    def test_skips_comments(self):
        content = "---\nname: Skill\n# this is a comment\ndescription: desc\n---"
        result = parse_skill_frontmatter(content)
        assert "name" in result
        assert "description" in result

    def test_multiline_yaml_description(self):
        content = (
            "---\n"
            "name: ai-3d-model\n"
            "description: >\n"
            "  AI 3D model generation skill for game assets, 3D printing, and PowerPoint. Use whenever the\n"
            "  user wants to generate a 3D model, create game-ready assets, prepare models for 3D printing,\n"
            "  make 3D content for presentations, or create figurines/chibi characters. Also trigger on\n"
            "    mentions of STL, GLB, FBX, Bambu Lab, manifold, polygon count, printer status, print monitor,\n"
            "    or any AI 3D generation tool. Covers the full flow: conversational requirement gathering →\n"
            "    style choices → generation → validation → delivery of a scene-compliant model file → ask\n"
            "    whether to connect Bambu printer for printing → optional print monitoring.\n"
            "---\n"
        )
        result = parse_skill_frontmatter(content)
        assert result["name"] == "ai-3d-model"
        assert "whenever the user" in result["description"]
        assert "optional print monitoring." in result["description"]


# ===========================================================================
# StorageFS
# ===========================================================================


class TestStorageFS:
    @pytest.fixture()
    def fs(self, tmp_path):
        return StorageFS(tmp_path, "skill")

    def test_write_and_read(self, fs):
        fs.write_text(1, "SKILL.md", "hello", project_id=10)
        content = fs.read_text(1, "SKILL.md", project_id=10)
        assert content == "hello"

    def test_read_nonexistent_raises(self, fs):
        with pytest.raises(FileNotFoundError):
            fs.read_text(999, "missing.txt", project_id=10)

    def test_roots_returns_all_scopes(self, fs):
        roots = fs.roots(project_id=1, agent_id="a1")
        assert len(roots) == 2
        scopes = {r[0] for r in roots}
        assert scopes == {"project", "agent"}

    def test_roots_empty_when_no_ids(self, fs):
        assert fs.roots() == []

    def test_delete_resource(self, fs):
        fs.write_text(1, "file.txt", "data", agent_id="a1")
        fs.delete_resource(1, agent_id="a1")
        with pytest.raises(FileNotFoundError):
            fs.read_text(1, "file.txt", agent_id="a1")

    def test_delete_nonexistent_is_noop(self, fs):
        # Should not raise
        fs.delete_resource(999, agent_id="a1")

    def test_validate_single_id_fails_with_none(self, fs):
        with pytest.raises(ValueError, match="exactly one"):
            fs.write_text(1, "f.txt", "x")  # no scope ID

    def test_validate_single_id_fails_with_multiple(self, fs):
        with pytest.raises(ValueError, match="exactly one"):
            fs.write_text(1, "f.txt", "x", project_id=1, agent_id="a1")

    def test_resolve_file_path(self, fs):
        fs.write_text(42, "README.md", "content", project_id=5)
        path = fs.resolve_file_path(42, "README.md", project_id=5)
        assert path.exists()
        assert path.name == "README.md"

    def test_resolve_file_path_missing(self, fs):
        with pytest.raises(FileNotFoundError):
            fs.resolve_file_path(42, "nope.md", project_id=5)


# ===========================================================================
# SCMemoryFS
# ===========================================================================


class TestSCMemoryFS:
    @pytest.fixture()
    def fs(self, tmp_path):
        return SCMemoryFS(tmp_path)

    def test_write_and_read(self, fs):
        fs.write_knowledge("user@example.com", 1, '[{"key": "value"}]')
        content = fs.read_knowledge("user@example.com", 1)
        assert '"key"' in content

    def test_read_nonexistent_returns_empty_array(self, fs):
        assert fs.read_knowledge("nobody", 999) == "[]"

    def test_exists(self, fs):
        assert not fs.exists("user@example.com", 1)
        fs.write_knowledge("user@example.com", 1, "[]")
        assert fs.exists("user@example.com", 1)

    def test_username_sanitization(self, fs):
        path = fs.get_knowledge_path("user@example.com", 1)
        assert "@" not in path.parts[-3]  # username part should be sanitized


# ===========================================================================
# ChatFS
# ===========================================================================


class TestChatFS:
    @pytest.fixture()
    def fs(self, tmp_path):
        return ChatFS(tmp_path)

    def test_write_and_read_file(self, fs):
        fs.write_file(1, "alice", "notes.txt", "hello world")
        content = fs.read_file(1, "alice", "notes.txt")
        assert content == "hello world"

    def test_read_nonexistent_raises(self, fs):
        with pytest.raises(FileNotFoundError):
            fs.read_file(1, "alice", "missing.txt")

    def test_delete_file(self, fs):
        fs.write_file(1, "alice", "temp.txt", "data")
        fs.delete_file(1, "alice", "temp.txt")
        with pytest.raises(FileNotFoundError):
            fs.read_file(1, "alice", "temp.txt")

    def test_delete_nonexistent_raises(self, fs):
        with pytest.raises(FileNotFoundError):
            fs.delete_file(1, "alice", "nope.txt")

    def test_path_traversal_blocked(self, fs):
        fs.write_file(1, "alice", "legit.txt", "ok")
        with pytest.raises(ValueError, match="within the workspace"):
            fs.delete_file(1, "alice", "../../etc/passwd")

    def test_path_traversal_prefix_collision_blocked(self, fs):
        workspace = fs.get_workspace_path(1, "alice")
        evil_workspace = workspace.parent / f"{workspace.name}_evil"
        evil_workspace.mkdir(parents=True, exist_ok=True)
        (evil_workspace / "escaped.txt").write_text("pwnd")

        with pytest.raises(ValueError, match="within the workspace"):
            fs.resolve_workspace_file(
                1,
                "alice",
                f"../{evil_workspace.name}/escaped.txt",
            )

    def test_list_files(self, fs):
        fs.write_file(1, "alice", "a.txt", "aaa")
        fs.write_file(1, "alice", "sub/b.txt", "bbbb")
        files = fs.list_files(1, "alice")
        paths = [f["path"] for f in files]
        assert "a.txt" in paths
        assert "sub/b.txt" in paths
        assert all("size_kb" in f for f in files)

    def test_list_files_empty_workspace(self, fs):
        assert fs.list_files(1, "nobody") == []

    def test_write_and_read_plan(self, fs):
        fs.plan.write(1, "alice", 100, '{"steps": []}')
        content = fs.plan.read(1, "alice", 100)
        assert "steps" in content

    def test_plan_exists(self, fs):
        assert not fs.plan.exists(1, "alice", 100)
        fs.plan.write(1, "alice", 100, "{}")
        assert fs.plan.exists(1, "alice", 100)

    def test_plan_cancelled_marker(self, fs):
        assert not fs.plan.is_cancelled(1, "alice", 100)
        fs.plan.write_cancelled_marker(1, "alice", 100)
        assert fs.plan.is_cancelled(1, "alice", 100)

    def test_workspace_path(self, fs):
        fs.get_workspace_path(1, "alice")
        fs.write_file(1, "alice", "ok.txt", "fine")
        with pytest.raises(ValueError, match="within the workspace"):
            fs.resolve_workspace_file(1, "alice", "../../etc/passwd")

    def test_plan_write_is_atomic(self, fs):
        """write_plan must use a temp+rename so a concurrent reader never sees a partial file."""
        fs.plan.write(1, "alice", 100, '{"a": 1}')
        # No leftover temp files (we use unique names like ``plan.json.<rand>.tmp``).
        plan_path = fs.plan._get_path(1, "alice", 100)
        leftovers = list(plan_path.parent.glob("plan.json.*"))
        assert plan_path.exists()
        assert leftovers == [], f"unexpected temp files: {leftovers}"

    @pytest.mark.asyncio
    async def test_plan_lock_release_then_reacquire(self, fs, _fake_cache):
        """After exiting the read-lock context, the same caller can acquire it again.

        With the Redis-backed lock we use one exclusive lock for both reads and writes,
        so this only verifies the release-then-reacquire path — not nested re-entrancy,
        which the lock does not support.
        """
        async with fs.plan.read_lock(1, "alice", 100, timeout=10):
            pass
        async with fs.plan.read_lock(1, "alice", 100, timeout=10):
            pass

    @pytest.mark.asyncio
    async def test_plan_write_lock_excludes_concurrent_tasks(self, fs, _fake_cache):
        """Concurrent asyncio tasks contending for the write lock must serialize their RMWs.

        Each task repeatedly performs a read-modify-write incrementing a counter in
        ``plan.json`` while holding ``plan_write_lock``. An ``await asyncio.sleep(0)``
        between read and write inside the critical section forces interleaving so a
        broken lock would surface as lost updates. With the lock working correctly
        the final value must equal ``num_tasks * iterations``.
        Backed by fakeredis so the test is hermetic and runs everywhere.
        """
        import asyncio as _asyncio
        import json as _json

        # Seed the plan file so workers start from a known state.
        fs.plan.write(1, "alice", 100, _json.dumps({"counter": 0}))

        num_tasks = 4
        iterations = 25

        async def worker() -> None:
            for _ in range(iterations):
                async with fs.plan.write_lock(1, "alice", 100, timeout=10):
                    data = _json.loads(fs.plan.read(1, "alice", 100))
                    # Force a context switch inside the critical section so a
                    # broken lock would let other tasks observe the stale value.
                    await _asyncio.sleep(0)
                    data["counter"] += 1
                    fs.plan.write(1, "alice", 100, _json.dumps(data))

        await _asyncio.wait_for(
            _asyncio.gather(*(worker() for _ in range(num_tasks))),
            timeout=60,
        )

        final = _json.loads(fs.plan.read(1, "alice", 100))
        expected = num_tasks * iterations
        assert final["counter"] == expected, (
            f"lost updates detected: expected {expected}, got {final['counter']}"
        )

    @pytest.mark.asyncio
    async def test_plan_lock_released_after_ttl(self, fs, _fake_cache):
        """If a holder dies without releasing, the lock TTL eventually frees it.

        We simulate a crashed holder by acquiring the lock at the Redis level and never
        releasing it; the entry is set with a 1-second TTL, so a fresh acquire should
        succeed once Redis evicts the key.

        Uses non-blocking acquires in a deadline loop so a regression that breaks TTL
        eviction surfaces as a bounded test failure rather than an indefinite hang
        (``Cache.lock`` has no max-wait).
        """
        import asyncio as _asyncio
        import time as _time

        from app.utils.cache import Cache

        cache = Cache.get_instance()
        lock_name = fs.plan._get_lock_name(1, "alice", 100)
        # Manually plant a lock entry with a tiny TTL, mimicking a crashed holder.
        await cache.try_acquire_lock(lock_name, timeout=1)

        # Poll non-blocking until the TTL evicts the planted key. Bounded by the
        # deadline so a broken TTL implementation can't hang the test.
        deadline = _time.monotonic() + 5.0
        while _time.monotonic() < deadline:
            acquired, value = await cache.try_acquire_lock(lock_name, timeout=1)
            if acquired:
                try:
                    return
                finally:
                    await cache.release_lock(lock_name, value)
            await _asyncio.sleep(0.1)
        pytest.fail("plan write_lock did not become available after the prior holder's TTL expired")


@pytest.fixture()
def _fake_cache():
    """Initialize ``Cache`` singleton with an in-memory fakeredis client for the test.

    ``Cache.__init__`` enforces singleton semantics and reads ``REDIS_CONNECTION``,
    so we bypass it here by constructing the object manually with a fakeredis client.
    """
    import fakeredis

    from app.utils.cache import Cache

    prev = Cache._instance
    inst = object.__new__(Cache)
    inst.redis = fakeredis.FakeAsyncRedis()
    Cache._instance = inst
    try:
        yield inst
    finally:
        Cache._instance = prev
