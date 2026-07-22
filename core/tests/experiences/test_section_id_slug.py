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

"""Generated bullet-ID prefix derivation + citation regex tolerance."""

from app.experiences.playbook import Playbook
from app.experiences.roles import extract_cited_bullet_ids


def test_generated_id_uses_first_word_of_section():
    pb = Playbook()
    bullet = pb.add_bullet(section="Edge Search", content="Do X")
    assert bullet.id == "edge-00001"
    assert pb.get_bullet(bullet.id) is not None


def test_generated_id_strips_non_alphanumerics_from_prefix():
    pb = Playbook()
    bullet = pb.add_bullet(section="interactive/browser", content="Do Y")
    assert bullet.id == "interactivebrowser-00001"


def test_generated_id_falls_back_to_general_for_blank_section():
    pb = Playbook()
    assert pb.add_bullet(section="///", content="Do Z").id == "general-00001"
    assert pb.add_bullet(section="   ", content="Do W").id == "general-00002"


def test_extract_cited_bullet_ids_supports_legacy_slash_ids():
    text = "Following [interactive/browser-00009] and [verification-00003]."
    assert extract_cited_bullet_ids(text) == [
        "interactive/browser-00009",
        "verification-00003",
    ]


def test_extract_cited_bullet_ids_still_matches_plain_ids():
    text = "Use [general-00042] then [geo-00003]."
    assert extract_cited_bullet_ids(text) == ["general-00042", "geo-00003"]
