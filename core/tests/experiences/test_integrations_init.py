
def test_default_parser_registered_on_import() -> None:
    import app.experiences.integrations as integrations
    from app.experiences.integrations.default_parser import parse_trajectory

    # Any skill resolves to the default parser unless it registers a custom one.
    assert integrations.get_dw_parser("android-tester") is parse_trajectory
    assert integrations.get_dw_parser("some-other-dw") is parse_trajectory
