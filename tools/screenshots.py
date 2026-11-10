"""Take screenshots of every demo screen with headless Chrome.

Each shot opens app/index.html with ?shot=1 (fresh state, no motion) and an
optional &do=... list of actions, at 1920x1080 and 1366x768. Chrome runs with a
throwaway profile in a temporary folder, so your own Chrome profile is never
touched, and each Chrome process exits after its screenshot.

Run from demo/:  python3 -I tools/screenshots.py [--out screenshots] [--only proposals]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1]
APP = DEMO / "app" / "index.html"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# name, screen id, actions (each action is "verb:arg:arg"; values may contain commas)
SHOTS = [
    ("1-context", "context", []),
    ("2-assistants", "assistants", []),
    ("3a-proposal-routine", "proposals", ["select:p04"]),
    ("3b-proposal-correction", "proposals", ["accept:p04", "select:p05"]),
    ("3c-proposal-held-back", "proposals", ["accept:p04", "accept:p05", "select:p06"]),
    ("3d-proposal-blocked-rule", "proposals", ["accept:p04", "accept:p05", "reject:p06", "select:p07"]),
    ("3e-proposal-hidden-text", "proposals", ["accept:p04", "accept:p05", "reject:p06", "dismiss:p07", "select:p08"]),
    ("3f-proposal-clean-twin", "proposals", ["accept:p04", "accept:p05", "reject:p06", "dismiss:p07", "dismiss:p08", "select:p09"]),
    ("3g-proposal-contact-change", "proposals", ["accept:p04", "accept:p05", "reject:p06", "dismiss:p07", "dismiss:p08", "accept:p09", "select:p10"]),
    ("3h-proposals-all-handled", "proposals", ["accept:p04", "accept:p05", "reject:p06", "dismiss:p07", "dismiss:p08", "accept:p09", "reject:p10"]),
    ("4a-same-you", "same-you", ["accept:p05"]),
    ("4b-same-you-signoff-edited", "same-you", ["accept:p05", "signoff:Kind regards, Sofie"]),
    ("4c-same-you-without-context", "same-you", ["context:off"]),
    ("4d-same-you-b-without-work-scope", "same-you", ["accept:p05", "scope:assistant-b:work:off"]),
    ("4e-same-you-after-a-planted-contact", "same-you", ["accept:p05", "accept:p10"]),
    ("5a-connect", "connect", []),
    ("5b-connect-sign-in", "connect", ["connect:1"]),
    ("5c-connect-consent", "connect", ["connect:2"]),
    ("5d-connect-done", "connect", ["connect:2", "allow"]),
    ("2b-assistants-after-connect", "assistants", ["accept:p04", "connect:2", "allow"]),
    ("6-history", "history", ["accept:p04", "accept:p05", "reject:p06", "accept:p09", "signoff:Kind regards, Sofie"]),
    ("6b-history-after-undo", "history", ["accept:p04", "accept:p05", "accept:p09", "signoff:Kind regards, Sofie", "undo:last"]),
    ("6c-history-undo-assistant-b", "history", ["accept:p04", "accept:p05", "accept:p09", "undo-assistant:assistant-b"]),
    ("1b-context-after-demo", "context", ["accept:p04", "accept:p05", "accept:p09", "signoff:Kind regards, Sofie"]),
]
SIZES = [(1920, 1080), (1366, 768)]


def url_for(screen: str, actions: list[str]) -> str:
    query = "shot=1"
    if actions:
        query += "&do=" + ",".join(
            ":".join(urllib.parse.quote(part, safe="") for part in step.split(":")) for step in actions
        )
    return APP.as_uri() + "?" + query + "#" + screen


def shoot(url: str, out: Path, size: tuple[int, int], profile: Path) -> list[str]:
    cmd = [
        CHROME,
        "--headless=new",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--enable-logging=stderr",
        "--v=0",
        f"--window-size={size[0]},{size[1]}",
        "--virtual-time-budget=1500",
        f"--screenshot={out}",
        url,
    ]
    run = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    problems = [
        line for line in run.stderr.splitlines()
        if ("CONSOLE" in line and ("Uncaught" in line or "Error" in line)) or "Uncaught" in line
    ]
    if not out.exists():
        problems.append(f"no screenshot written (exit {run.returncode})")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(DEMO / "screenshots"))
    ap.add_argument("--only", help="only shots whose name contains this text")
    ap.add_argument("--small-only", action="store_true", help="only 1366x768")
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="ctx-demo-chrome-"))
    failures = 0
    try:
        for name, screen, actions in SHOTS:
            if args.only and args.only not in name:
                continue
            for size in SIZES:
                if args.small_only and size != (1366, 768):
                    continue
                file = out_dir / f"{name}_{size[0]}x{size[1]}.png"
                if file.exists():
                    file.unlink()
                problems = shoot(url_for(screen, actions), file, size, profile)
                status = "ok" if not problems else "PROBLEM"
                print(f"{status:8} {file.name}")
                for p in problems:
                    failures += 1
                    print("         " + p)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
