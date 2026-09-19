#!/usr/bin/env python3
"""Open isolated BIY backend/frontend/tools tabs in iTerm2 via AppleScript."""

import argparse
import json
import shlex
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def commands():
    root = shlex.quote(str(ROOT))
    return [
        (
            "BIY · Django :8017",
            f"cd {root} && .venv/bin/python backend/manage.py runserver 127.0.0.1:8017",
        ),
        ("BIY · React :5178", f"cd {root}/frontend && npm run dev -- --strictPort"),
        ("BIY · Tools", f"cd {root} && source .venv/bin/activate"),
    ]


def preflight():
    missing = [
        name
        for name in [".env", ".venv/bin/python", "frontend/node_modules"]
        if not (ROOT / name).exists()
    ]
    if missing:
        raise SystemExit("Missing setup: " + ", ".join(missing) + ". See README.md.")
    subprocess.run(
        ["/bin/zsh", "-lc", "command -v node >/dev/null && command -v npm >/dev/null"], check=True
    )
    subprocess.run(
        [str(ROOT / ".venv/bin/python"), str(ROOT / "backend/manage.py"), "check"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [
            str(ROOT / ".venv/bin/python"),
            str(ROOT / "backend/manage.py"),
            "shell",
            "-c",
            'from django.db import connection; connection.ensure_connection(); print("PostgreSQL is ready.")',
        ],
        cwd=ROOT,
        check=True,
    )
    for port in [8017, 5178]:
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(
                    f"Port {port} is already in use. Keep the existing BIY session or stop it before launching; no processes were killed."
                )


def applescript():
    # JSON double-quote escaping is also valid for these AppleScript string literals.
    def quote(text):
        return json.dumps(text, ensure_ascii=False)

    lines = [
        'tell application "iTerm2"',
        "activate",
        "set biyWindow to (create window with default profile)",
        "tell biyWindow",
    ]
    for i, (title, command) in enumerate(commands()):
        if i:
            lines.append("create tab with default profile")
        lines += [
            "tell current session of current tab",
            f"set name to {quote(title)}",
            f"write text {quote(command)}",
            "end tell",
        ]
    lines += ["end tell", "end tell"]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the script without opening iTerm or starting services.",
    )
    args = parser.parse_args()
    if args.dry_run:
        print(applescript())
        return
    if not shutil.which("osascript"):
        raise SystemExit("This launcher needs macOS and iTerm2.")
    preflight()
    subprocess.run(["osascript", "-"], input=applescript(), text=True, check=True)
    deadline = time.monotonic() + 20
    ready = False
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:5178/api/session", timeout=1) as response:
                ready = response.status == 200
            if ready:
                break
        except (OSError, urllib.error.URLError):
            time.sleep(0.3)
    if ready:
        subprocess.run(["open", "http://127.0.0.1:5178/"], check=True)
    else:
        print("The servers are still starting. Check the iTerm tabs, then open the URL below.")
    print("BIY is starting in three iTerm tabs. Web: http://127.0.0.1:5178/")


if __name__ == "__main__":
    main()
