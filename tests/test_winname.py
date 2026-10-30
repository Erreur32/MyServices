from msv.machines.winname import windows_name


def test_windows_10_with_a_windows_11_build():
    assert windows_name("Microsoft Windows 10 Pro", "22631") == "Microsoft Windows 11 Pro 23H2"
    assert windows_name("Microsoft Windows 10 Pro", 19045) == "Microsoft Windows 10 Pro 22H2"
    assert windows_name("Microsoft Windows 10 Pro", 19999) == "Microsoft Windows 10 Pro"


def test_server_without_year_gets_it_from_the_build():
    assert windows_name("Microsoft Windows Server Standard", "20348") == "Microsoft Windows Server 2022 Standard"
    assert windows_name("Microsoft Windows Server 2019 Standard", "17763") == "Microsoft Windows Server 2019 Standard"


def test_untouched_cases():
    assert windows_name("Debian GNU/Linux 13", "22631") == "Debian GNU/Linux 13"
    assert windows_name("Microsoft Windows 10 Pro", None) == "Microsoft Windows 10 Pro"
    assert windows_name(None, "1") is None
