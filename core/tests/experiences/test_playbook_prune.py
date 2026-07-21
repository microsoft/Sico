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

"""Value-based playbook pruning: disposable cleanup + keep-score cutoff (hard-delete)."""

from datetime import UTC, datetime, timedelta

from app.experiences.playbook import Playbook, RetentionPolicy


def _iso(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()


def _add(pb, content, *, helpful=0, harmful=0, neutral=0, created_days=0.0, updated_days=0.0):
    b = pb.add_bullet(section="general", content=content)
    b.helpful, b.harmful, b.neutral = helpful, harmful, neutral
    b.created_at = _iso(created_days)
    b.updated_at = _iso(updated_days)
    return b


def _prune(pb, cap):
    return pb.prune(RetentionPolicy(max_bullets=cap, cold_after_days=7.0))


def test_noop_under_cap():
    pb = Playbook()
    _add(pb, "x", helpful=1)
    _add(pb, "y", helpful=1)
    assert _prune(pb, 5) == 0
    assert len(pb.bullets()) == 2


def test_disposable_drops_net_negative_and_cold_not_fresh():
    pb = Playbook()
    bad = _add(pb, "bad", harmful=5)                              # net-negative
    cold = _add(pb, "cold", created_days=30, updated_days=30)     # no feedback + untouched long
    fresh = _add(pb, "fresh", created_days=30, updated_days=0)    # old, but just updated -> NOT cold
    good = _add(pb, "good", helpful=2)
    # 4 active, cap=2: disposable drops bad + cold -> 2 active == cap, cutoff no-op
    removed = _prune(pb, 2)
    assert removed == 2
    assert pb.get_bullet(bad.id) is None
    assert pb.get_bullet(cold.id) is None
    assert pb.get_bullet(fresh.id) is not None
    assert pb.get_bullet(good.id) is not None


def test_cutoff_drops_lowest_hit_rate_when_all_good():
    pb = Playbook()
    high = _add(pb, "high", helpful=10)
    mid = _add(pb, "mid", helpful=5)
    low = _add(pb, "low", helpful=1)
    # none disposable, equal recency -> cutoff drops the lowest hit-rate
    assert _prune(pb, 2) == 1
    assert pb.get_bullet(low.id) is None
    assert pb.get_bullet(high.id) is not None
    assert pb.get_bullet(mid.id) is not None


def test_cutoff_evicts_stale_among_equal_value():
    pb = Playbook()
    keep = _add(pb, "keep", helpful=9)
    recent = _add(pb, "recent", helpful=5, updated_days=1)
    stale = _add(pb, "stale", helpful=5, updated_days=60)
    # equal hit-rate (5/0) -> staleness decides: the staler entry is evicted.
    assert _prune(pb, 2) == 1
    assert pb.get_bullet(stale.id) is None
    assert pb.get_bullet(recent.id) is not None
    assert pb.get_bullet(keep.id) is not None


def test_cutoff_staleness_sinks_slightly_higher_value():
    pb = Playbook()
    _add(pb, "anchor", helpful=10)                             # clearly kept
    fresh_lower = _add(pb, "fresh", helpful=3, updated_days=0)
    stale_higher = _add(pb, "stale", helpful=4, updated_days=60)
    # cap=2 -> evict 1; the staleness discount pulls the higher-value but
    # 60-day-idle entry below the slightly-lower-value but fresh one.
    assert _prune(pb, 2) == 1
    assert pb.get_bullet(stale_higher.id) is None
    assert pb.get_bullet(fresh_lower.id) is not None


def test_hard_delete_removes_entirely():
    pb = Playbook()
    _add(pb, "g1", helpful=3)
    _add(pb, "g2", helpful=3)
    drop = _add(pb, "drop", helpful=1)
    _prune(pb, 2)
    assert len(pb.bullets()) == 2                       # active capped
    assert len(pb.bullets(include_invalid=True)) == 2   # gone for good, not retained
    assert pb.get_bullet(drop.id) is None
