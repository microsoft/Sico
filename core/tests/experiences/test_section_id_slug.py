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
