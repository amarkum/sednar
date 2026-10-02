"""sandbox.py: which jail a git command belongs to, and the jail's arguments. Making a real jail needs Linux
and bubblewrap; that part runs only where it works."""
from __future__ import annotations

import os
import subprocess

import pytest

from sednar import public_mode, sandbox


def test_a_path_belongs_to_the_user_folder_it_is_in(tmp_path):
    root = tmp_path / "users"
    (root / "amar-3f9c1a2b" / "proj").mkdir(parents=True)
    (root / ".cwd").mkdir()
    assert sandbox.user_dir_for(str(root / "amar-3f9c1a2b" / "proj"), str(root)) == os.path.realpath(root / "amar-3f9c1a2b")
    assert sandbox.user_dir_for(str(root / "amar-3f9c1a2b"), str(root)) == os.path.realpath(root / "amar-3f9c1a2b")
    assert sandbox.user_dir_for(str(root), str(root)) is None
    assert sandbox.user_dir_for(str(root / ".cwd"), str(root)) is None
    assert sandbox.user_dir_for(str(tmp_path), str(root)) is None


def test_a_link_out_of_a_user_folder_does_not_count_as_inside(tmp_path):
    root = tmp_path / "users"
    (root / "amar-3f9c1a2b").mkdir(parents=True)
    (root / "amar-3f9c1a2b" / "out").symlink_to(tmp_path)
    assert sandbox.user_dir_for(str(root / "amar-3f9c1a2b" / "out"), str(root)) is None


def test_git_arguments_name_the_folder_and_the_subcommand(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert sandbox._git_workdir(["-C", "/x/y", "status"]) == "/x/y"
    assert sandbox._git_workdir(["--no-pager", "log", "-C"]) == str(tmp_path)
    assert sandbox._git_subcommand(["-C", "/x", "-c", "a=b", "--no-pager", "grep", "-n"]) == "grep"
    assert sandbox._git_subcommand(["clone", "--depth", "1", "--", "https://x/y", "/t"]) == "clone"


def test_a_terminal_is_named_after_its_user():
    assert public_mode._display_name("amar-3f9c1a2b") == "amar"
    assert public_mode._display_name("mary-jane-0011aabb") == "mary-jane"
    assert public_mode._display_name("0123456789abcdef0123456789abcdef") == "user"


@pytest.mark.skipif(not sandbox.works(), reason="needs Linux with bubblewrap and user namespaces")
def test_the_terminal_sees_only_its_own_folder_and_no_network(tmp_path):
    mine, other = tmp_path / "amar-3f9c1a2b", tmp_path / "bob-0011aabb"
    (mine / "proj").mkdir(parents=True)
    other.mkdir()
    (other / "secret.txt").write_text("bob's")
    argv, fds = sandbox.terminal(str(mine), "amar", str(mine / "proj"))
    script = ("whoami; pwd; ls /home; cat %s 2>/dev/null || echo no-secret; "
              "python3 -c \"import socket; socket.create_connection(('1.1.1.1', 80), timeout=3)\" 2>/dev/null || echo no-network; "
              "echo hi > made.txt" % (other / "secret.txt"))
    try:
        out = subprocess.run(argv[:-3] + ["/bin/bash", "-c", script], capture_output=True, text=True,
                             pass_fds=tuple(fds.values()), timeout=30).stdout.split()
    finally:
        for fd in fds.values():
            os.close(fd)
    assert out == ["amar", "/home/amar/proj", "amar", "no-secret", "no-network"]
    assert (mine / "proj" / "made.txt").read_text() == "hi\n"
