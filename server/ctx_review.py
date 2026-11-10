"""Review proposals and manage the context store: the user's side, out of the model's reach.

Examples (run from demo/):
  .venv/bin/python -I server/ctx_review.py              list what is waiting
  .venv/bin/python -I server/ctx_review.py review       go through each proposal and decide
  .venv/bin/python -I server/ctx_review.py show p06     one proposal with its diff and warnings
  .venv/bin/python -I server/ctx_review.py accept p04   accept (quarantined ones need --force)
  .venv/bin/python -I server/ctx_review.py reject p06
  .venv/bin/python -I server/ctx_review.py history      every applied change, newest first
  .venv/bin/python -I server/ctx_review.py undo h06     undo one change
  .venv/bin/python -I server/ctx_review.py undo-assistant assistant-b --since 2026-11-19
  .venv/bin/python -I server/ctx_review.py entries      the context as assistants may see it
  .venv/bin/python -I server/ctx_review.py reads        who read what, and when
  .venv/bin/python -I server/ctx_review.py reset        restore the demo store from store/seed/
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

import firewall  # noqa: E402
from ctx_store import DEFAULT_STORE, Store, StoreError  # noqa: E402

TZ = ZoneInfo("Europe/Brussels")
COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR else text


def bold(t: str) -> str:
    return c(t, "1")


def dim(t: str) -> str:
    return c(t, "2")


VERDICT_STYLE = {
    "clean": ("routine", "32"),
    "review": ("needs your yes", "36"),
    "quarantined": ("HELD BACK", "33;1"),
    "blocked": ("BLOCKED", "31;1"),
}

APP_REPORT = {
    "outside_content": "its app reported outside content in this chat",
    "none": "its app reported that it read nothing from outside",
    "not_reported": "its app did not report what it read (treated as untrusted)",
}


def when(iso: str) -> str:
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ)
    return t.strftime("%d %b %H:%M")


def names(store: Store) -> dict[str, str]:
    out = {c_["id"]: c_["name"] for c_ in store.load("connectors")["connectors"]}
    out["user"] = "you"
    return out


def show_text(text: str, demo_hidden: str | None = None) -> str:
    if demo_hidden:  # the demo's attack sample: kept as plain text, built into hidden characters when used
        text = text + firewall.to_tags(demo_hidden)
    visible, n, decoded = firewall.split_hidden(text)
    if not n:
        return visible
    marker = c(f" [+{n} hidden characters]", "31;1")
    return visible + marker + (f"\n      {c('hidden text:', '31')} {decoded}" if decoded else "")


def word_diff(old: str, new: str) -> str:
    a, b = old.split(), new.split()
    out: list[str] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b).get_opcodes():
        if op == "equal":
            out.extend(a[i1:i2])
        if op in ("delete", "replace"):
            out.append(c("[-" + " ".join(a[i1:i2]) + "-]", "31"))
        if op in ("insert", "replace"):
            out.append(c("{+" + " ".join(b[j1:j2]) + "+}", "32"))
    return " ".join(out)


def proposal_line(p: dict[str, Any], who: dict[str, str]) -> str:
    label, code = VERDICT_STYLE[p["screening"]["verdict"]]
    status = p["status"].replace("_", "-") if p["status"] not in ("pending",) else label
    text = firewall.strip_hidden(p["text"])
    if len(text) > 64:
        text = text[:61] + "..."
    return f"  {bold(p['id'])}  {c(status.ljust(14), code)} {who.get(p['connector'], p['connector']).ljust(12)} {p['op'].ljust(6)} {text}"


def print_proposal(store: Store, p: dict[str, Any]) -> None:
    who = names(store)
    label, code = VERDICT_STYLE[p["screening"]["verdict"]]
    print(f"\n{bold(p['id'])}  from {bold(who.get(p['connector'], p['connector']))} (its own connection), {when(p['received'])}"
          f"  {dim('client says it is: ' + p['client_reported_name']) if p.get('client_reported_name') else ''}")
    print(f"  {p['op']} {p['kind']} ({p.get('basis', 'inferred')})   status: {p['status']}   screening: {c(label, code)}")
    report = APP_REPORT.get(p.get("app_reported") or "not_reported", APP_REPORT["not_reported"])
    print(f"  {report}" + (f": {p['app_detail']}" if p.get("app_detail") else ""))
    if p["op"] == "add":
        print(f"  {c('+ new entry:', '32')} {show_text(p['text'], p.get('demo_hidden'))}")
    else:
        entry = next((e for e in store.entries(include_removed=True) if e["id"] == p["entry_id"]), None)
        old = entry["text"] if entry else "?"
        if p["op"] == "update":
            print(f"  change {p['entry_id']}: {word_diff(old, firewall.strip_hidden(p['text']))}")
            _, n, decoded = firewall.split_hidden(p["text"])
            if n:
                print("  " + show_text(p["text"]))
        else:
            print(f"  {c('- remove ' + p['entry_id'] + ':', '31')} {old}")
    if p.get("why"):
        print(f"  its explanation (not checked): {firewall.strip_hidden(p['why'])}")
    if p["screening"]["reasons"]:
        print("  warnings:")
        for r in p["screening"]["reasons"]:
            print(f"    - {r['label']}")
    else:
        print(f"  warnings: {dim('none')}")


def cmd_list(store: Store, args: argparse.Namespace) -> None:
    who = names(store)
    ps = store.proposals()
    waiting = [p for p in ps if p["status"] == "pending"]
    blocked = [p for p in ps if p["status"] in ("blocked", "auto_rejected")]
    print(bold(f"{len(waiting)} proposal(s) waiting for you") + dim(f"   store: {store.folder}"))
    for p in waiting:
        print(proposal_line(p, who))
    if blocked:
        print(bold(f"\n{len(blocked)} blocked attempt(s)") + dim(" (rules, instructions, hidden text, secrets, repeats)"))
        for p in blocked:
            print(proposal_line(p, who))
    if args.all:
        done = [p for p in ps if p["status"] in ("accepted", "rejected")]
        print(bold(f"\n{len(done)} handled"))
        for p in done:
            print(proposal_line(p, who))
    if waiting:
        print(dim("\nNext: 'review' to decide one by one, or 'show <id>'."))


def cmd_show(store: Store, args: argparse.Namespace) -> None:
    p = next((p for p in store.proposals() if p["id"] == args.id), None)
    if not p:
        raise StoreError(f"No proposal with id '{args.id}'.")
    print_proposal(store, p)


def cmd_accept(store: Store, args: argparse.Namespace) -> None:
    ev = store.accept(args.id, edited_text=args.edit, force=args.force, scope=args.scope)
    print(f"Accepted {args.id}: {ev['action']} {ev['entry_id']}  (history {ev['id']}; undo with 'undo {ev['id']}')")


def cmd_reject(store: Store, args: argparse.Namespace) -> None:
    store.reject(args.id)
    print(f"Rejected {args.id}. It stays in the record; nothing was changed.")


def cmd_review(store: Store, args: argparse.Namespace) -> None:
    waiting = [p for p in store.proposals() if p["status"] == "pending"]
    if not waiting:
        print("Nothing is waiting for you.")
        return
    for p in waiting:
        print_proposal(store, p)
        verdict = p["screening"]["verdict"]
        options = "[a]ccept  [e]dit  [r]eject  [s]kip  [q]uit"
        while True:
            try:
                answer = input(f"  {options} > ").strip().lower()
            except EOFError:
                print()
                return
            if answer in ("q", "quit"):
                return
            if answer in ("s", "skip", ""):
                break
            if answer in ("r", "reject"):
                store.reject(p["id"])
                print(c("  rejected", "31"))
                break
            if answer in ("a", "accept", "e", "edit"):
                edited = None
                if answer.startswith("e"):
                    edited = input("  new text > ").strip() or None
                force = False
                if verdict == "blocked":
                    print(c("  Blocked proposals can never be accepted.", "31"))
                    continue
                if verdict == "quarantined":
                    confirm = input(c("  This proposal is held back. Type 'yes' to release it anyway > ", "33")).strip()
                    if confirm != "yes":
                        continue
                    force = True
                try:
                    ev = store.accept(p["id"], edited_text=edited, force=force)
                except StoreError as exc:
                    print(c(f"  {exc}", "31"))
                    continue
                print(c(f"  accepted ({ev['id']})", "32"))
                break


def cmd_history(store: Store, args: argparse.Namespace) -> None:
    who = names(store)
    for h in reversed(store.history()):
        snap = h["after"] or h["before"] or {}
        text = firewall.strip_hidden(snap.get("text", ""))
        undone = c(f"  undone by {h['undone_by']}", "33") if h.get("undone_by") else ""
        if h["action"] == "undo":
            by = f"undone by you (undoes {h['undoes']})"
        elif h["proposed_by"] == "user":
            by = "by you"
        else:
            by = f"proposed by {who.get(h['proposed_by'], h['proposed_by'])}, approved by you"
        print(f"  {bold(h['id'])}  {when(h['at'])}  {h['action'].ljust(6)} {h['entry_id']}  {by}{undone}")
        print(f"        {dim(text)}")


def cmd_undo(store: Store, args: argparse.Namespace) -> None:
    ev = store.undo(args.id)
    print(f"Undid {args.id} (history {ev['id']}).")


def cmd_undo_assistant(store: Store, args: argparse.Namespace) -> None:
    done = store.undo_connector(args.connector, args.since)
    who = names(store).get(args.connector, args.connector)
    print(f"Undid {len(done)} change(s) proposed by {who}" + (f" since {args.since}" if args.since else "") + ".")


def cmd_entries(store: Store, args: argparse.Namespace) -> None:
    who = names(store)
    for e in store.entries():
        if args.scope and args.scope not in e["scope"]:
            continue
        prov = e["provenance"]
        src = "stated by you" if prov["proposed_by"] == "user" else f"{prov['basis']} by {who.get(prov['proposed_by'])}"
        lock = c(" [stays on this device]", "33") if e.get("sensitivity") == "sensitive" else ""
        print(f"  {bold(e['id'])}  {e['kind'].ljust(10)} {show_text(e['text'])}{lock}")
        print(f"        {dim(src + ' | ' + ', '.join(e['scope']) + ' | added ' + when(e['added']) + ' | why: ' + (e.get('why') or '-'))}")


def cmd_reads(store: Store, args: argparse.Namespace) -> None:
    who = names(store)
    for r in reversed(store.load("reads")["reads"]):
        if args.connector and r["connector"] != args.connector:
            continue
        print(f"  {when(r['at'])}  {who.get(r['connector'], r['connector']).ljust(12)} read {r['count']} entries "
              f"({', '.join(r['scopes'])})")


def cmd_reset(store: Store, args: argparse.Namespace) -> None:
    if not args.yes:
        answer = input(f"Restore the demo store in {store.folder} from seed/? Your changes there are lost. [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            print("Nothing changed.")
            return
    store.reset()
    print("The store is back to the demo's starting point.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Review proposals for your context store.")
    ap.add_argument("--store", default=os.environ.get("CTX_STORE", str(DEFAULT_STORE)))
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("list", help="what is waiting (default)")
    p.add_argument("--all", action="store_true", help="also show handled proposals")
    sub.add_parser("review", help="decide one by one")
    p = sub.add_parser("show"); p.add_argument("id")
    p = sub.add_parser("accept"); p.add_argument("id")
    p.add_argument("--edit", metavar="TEXT", help="accept with your own wording")
    p.add_argument("--force", action="store_true", help="accept a quarantined proposal")
    p.add_argument("--scope", nargs="+", choices=["work", "personal"])
    p = sub.add_parser("reject"); p.add_argument("id")
    sub.add_parser("history")
    p = sub.add_parser("undo"); p.add_argument("id")
    p = sub.add_parser("undo-assistant", help="undo every change one assistant proposed")
    p.add_argument("connector")
    p.add_argument("--since", metavar="YYYY-MM-DD", help="only changes on or after this date")
    p = sub.add_parser("entries"); p.add_argument("--scope", choices=["work", "personal"])
    p = sub.add_parser("reads"); p.add_argument("--connector")
    p = sub.add_parser("reset"); p.add_argument("--yes", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd is None:
        args.cmd, args.all = "list", False
    try:
        store = Store(args.store)
        {
            "list": cmd_list, "review": cmd_review, "show": cmd_show, "accept": cmd_accept,
            "reject": cmd_reject, "history": cmd_history, "undo": cmd_undo, "undo-assistant": cmd_undo_assistant,
            "entries": cmd_entries,
            "reads": cmd_reads, "reset": cmd_reset,
        }[args.cmd](store, args)
    except StoreError as exc:
        print(c(f"error: {exc}", "31"), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
