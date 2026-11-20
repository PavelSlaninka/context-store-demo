"""The context store: plain JSON files in one folder, shared by the MCP server and the review CLI.

Files (the same format the demo app uses):
- entries.json     the user's context entries (the system of record)
- proposals.json   changes proposed by assistants, waiting for the user
- history.json     every applied change, with who proposed and who approved it
- connectors.json  the assistants the user has connected, and what each may read
- reads.json       a log of every read

Writes are atomic (write a temporary file, then rename) and serialised with a
lock file, so the server and the CLI can run at the same time.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import firewall

DEMO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_STORE = DEMO_DIR / "store"
FILES = ("entries", "proposals", "history", "connectors", "reads")


class StoreError(Exception):
    """A request the store refuses, with a message for the user or the assistant."""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Store:
    def __init__(self, folder: Path | str = DEFAULT_STORE) -> None:
        self.folder = Path(folder).resolve()
        if not (self.folder / "entries.json").exists():
            raise StoreError(f"No store at {self.folder} (entries.json is missing).")

    # ---- files ---------------------------------------------------------------

    @contextlib.contextmanager
    def locked(self) -> Iterator[None]:
        with open(self.folder / ".lock", "a+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)

    def load(self, name: str) -> Any:
        path = self.folder / f"{name}.json"
        if not path.exists():
            return {"connectors": []} if name == "connectors" else {name: []}
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, name: str, data: Any) -> None:
        path = self.folder / f"{name}.json"
        fd, tmp = tempfile.mkstemp(dir=self.folder, prefix=f".{name}.", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=True)
            fh.write("\n")
        os.replace(tmp, path)

    def entries(self, include_removed: bool = False) -> list[dict[str, Any]]:
        items = self.load("entries")["entries"]
        return items if include_removed else [e for e in items if e.get("status") == "active"]

    def proposals(self) -> list[dict[str, Any]]:
        return self.load("proposals")["proposals"]

    def history(self) -> list[dict[str, Any]]:
        return self.load("history")["history"]

    def connector(self, connector_id: str) -> dict[str, Any]:
        for c in self.load("connectors")["connectors"]:
            if c["id"] == connector_id:
                return c
        known = ", ".join(c["id"] for c in self.load("connectors")["connectors"])
        raise StoreError(f"Unknown connector '{connector_id}'. Known connectors: {known}.")

    # ---- reading -------------------------------------------------------------

    def read_for(self, connector: dict[str, Any], scopes: list[str] | None, kinds: list[str] | None) -> dict[str, Any]:
        """Entries one connector may read, filtered by the scopes and kinds it asks for. Logs the read."""
        granted = [s for s in connector.get("scopes", []) if scopes is None or s in scopes]
        out, withheld_sensitive, outside = [], 0, 0
        names = {c["id"]: c["name"] for c in self.load("connectors")["connectors"]}
        for e in self.entries():
            if kinds is not None and e["kind"] not in kinds:
                continue
            if not set(e["scope"]) & set(granted):
                outside += 1
                continue
            if e.get("sensitivity") == "sensitive" and not (
                connector.get("location") == "this-device" and connector.get("may_read_sensitive")
            ):
                withheld_sensitive += 1
                continue
            out.append(
                {
                    "id": e["id"],
                    "kind": e["kind"],
                    # Only visible text is served, even if an approved entry still held hidden characters.
                    "text": firewall.strip_hidden(e["text"]),
                    # The why is served only if the user wrote it. An assistant's why is for the user's card.
                    "why": firewall.strip_hidden(e.get("why") or "") if why_by_user(e) else "",
                    "scope": e["scope"],
                    "source": describe_source(e, names),
                    "added": e["added"],
                }
            )
        with self.locked():
            log = self.load("reads")
            log["reads"].append(
                {
                    "at": now_iso(),
                    "connector": connector["id"],
                    "scopes": granted,
                    "entry_ids": [e["id"] for e in out],
                    "count": len(out),
                }
            )
            self.save("reads", log)
        return {"entries": out, "granted_scopes": granted, "withheld_sensitive": withheld_sensitive, "outside_scope": outside}

    # ---- proposing -------------------------------------------------------------

    def propose(self, connector: dict[str, Any], proposal: dict[str, Any]) -> dict[str, Any]:
        """Screen and store one proposal. Raises StoreError if it is refused before screening.

        proposal["app_reported"] must come from the client channel (the request's _meta),
        never from the model's tool arguments. The server takes care of that.
        """
        if connector.get("status") != "active" or not connector.get("may_propose", False):
            raise StoreError("This connector may not propose changes. The user has paused it or turned proposals off.")
        op = proposal["op"]
        if op in ("update", "remove"):
            if not proposal.get("entry_id"):
                raise StoreError(f"An '{op}' proposal needs entry_id.")
            if proposal["entry_id"] not in {e["id"] for e in self.entries()}:
                raise StoreError(f"There is no active entry '{proposal['entry_id']}'.")
        elif proposal.get("entry_id"):
            raise StoreError("An 'add' proposal must not name an entry_id.")
        if not (proposal.get("text") or "").strip():
            raise StoreError("The proposal has no text.")

        with self.locked():
            data = self.load("proposals")
            today = now_iso()[:10]
            sent_today = [p for p in data["proposals"] if p["connector"] == connector["id"] and p["received"][:10] == today]
            limit = int(connector.get("daily_limit", 20))
            if len(sent_today) >= limit:  # R10
                raise StoreError(f"Daily limit reached: {limit} proposals per day for this connector.")

            # R11: a text the person rejected or removed before is not asked about again.
            fp = fingerprint(proposal["text"])
            rejected = {fingerprint(p["text"]) for p in data["proposals"] if p["status"] in ("rejected", "auto_rejected")}
            removed = {fingerprint(e["text"]) for e in self.entries(include_removed=True) if e.get("status") == "removed"}
            repeat = fp in rejected or fp in removed

            screening = firewall.screen(proposal, self.entries())
            status = "auto_rejected" if repeat else "blocked" if screening.verdict == "blocked" else "pending"
            record = {
                "id": _next_id("p", [p["id"] for p in data["proposals"]]),
                "connector": connector["id"],
                "received": now_iso(),
                "op": op,
                "entry_id": proposal.get("entry_id"),
                "kind": proposal["kind"],
                "text": proposal["text"],
                "why": proposal.get("why"),
                "scope": proposal.get("scope") or list(connector.get("scopes", [])),
                "basis": proposal.get("basis", "inferred"),
                "app_reported": firewall.app_report(proposal),
                "app_detail": proposal.get("app_detail"),
                "client_reported_name": proposal.get("client_reported_name"),
                "screening": screening.to_dict(),
                "status": status,
                "decided": None,
            }
            data["proposals"].append(record)
            self.save("proposals", data)
        return record

    # ---- the user's decisions (never reachable from the MCP server) ---------------

    def accept(self, proposal_id: str, edited_text: str | None = None, force: bool = False,
               scope: list[str] | None = None) -> dict[str, Any]:
        with self.locked():
            pdata = self.load("proposals")
            p = _find(pdata["proposals"], proposal_id, "proposal")
            if p["status"] != "pending":
                raise StoreError(f"Proposal {proposal_id} is {p['status']}, not pending.")
            verdict = p["screening"]["verdict"]
            if verdict == "blocked":
                raise StoreError("Blocked proposals can never be accepted.")
            if verdict == "quarantined" and not force:
                raise StoreError("This proposal is held back (quarantined). Read the reasons; release it only with --force.")

            edata = self.load("entries")
            sensitive = any(r["code"] == "sensitive" for r in p["screening"]["reasons"])
            text = edited_text if edited_text is not None else p["text"]
            at = now_iso()
            before = None
            if p["op"] == "add":
                entry = {
                    "id": _next_id("e", [e["id"] for e in edata["entries"]]),
                    "kind": p["kind"],
                    "text": text,
                    "why": p.get("why"),
                    "scope": scope or p.get("scope") or ["work"],
                    "sensitivity": "sensitive" if sensitive else "normal",
                    "provenance": {
                        "basis": p.get("basis", "inferred"),
                        "proposed_by": p["connector"],
                        "approved_by": "user",
                        "proposal_id": p["id"],
                        "edited_by_user": edited_text is not None,
                    },
                    "added": at,
                    "updated": None,
                    "status": "active",
                }
                edata["entries"].append(entry)
                after = entry
            else:
                entry = _find(edata["entries"], p["entry_id"], "entry")
                before = json.loads(json.dumps(entry))
                if p["op"] == "update":
                    entry["text"] = text
                    if p.get("why"):
                        entry["why"] = p["why"]
                    if scope:
                        entry["scope"] = scope
                    entry["updated"] = at
                    entry["provenance"]["last_change"] = {"proposed_by": p["connector"], "approved_by": "user", "proposal_id": p["id"]}
                    after = entry
                else:  # remove: keep a tombstone so the entry id is never reused
                    entry["status"] = "removed"
                    entry["updated"] = at
                    after = None
            p["status"] = "accepted"
            p["decided"] = at
            event = self._event(p["op"], entry["id"], before, after, p["connector"], p["id"], at)
            self.save("entries", edata)
            self.save("proposals", pdata)
        return event

    def reject(self, proposal_id: str) -> dict[str, Any]:
        with self.locked():
            pdata = self.load("proposals")
            p = _find(pdata["proposals"], proposal_id, "proposal")
            if p["status"] != "pending":
                raise StoreError(f"Proposal {proposal_id} is {p['status']}, not pending.")
            p["status"] = "rejected"
            p["decided"] = now_iso()
            self.save("proposals", pdata)
        return p

    def undo(self, history_id: str) -> dict[str, Any]:
        with self.locked():
            hdata = self.load("history")
            ev = _find(hdata["history"], history_id, "history event")
            if ev["action"] == "undo":
                raise StoreError("An undo can't be undone here; apply the change again instead.")
            if ev.get("undone_by"):
                raise StoreError(f"{history_id} was already undone by {ev['undone_by']}.")
            if history_id not in undoable_ids(hdata["history"]):
                raise StoreError("A newer change to this entry depends on it. Undo the newer change first.")
            edata = self.load("entries")
            entry = _find(edata["entries"], ev["entry_id"], "entry")
            at = now_iso()
            before = json.loads(json.dumps(entry))
            if ev["action"] == "add":
                entry["status"] = "removed"
                entry["updated"] = at
                after = None
            else:  # update or remove: restore the earlier version
                restored = json.loads(json.dumps(ev["before"]))
                entry.clear()
                entry.update(restored)
                after = entry
            self.save("entries", edata)
            new = self._event("undo", ev["entry_id"], before, after, "user", None, at, hdata=hdata, undoes=history_id)
            ev["undone_by"] = new["id"]
            self.save("history", hdata)
        return new

    def undo_connector(self, connector_id: str, since: str | None = None) -> list[dict[str, Any]]:
        """Undo every change a connector proposed (since a date, YYYY-MM-DD), newest first."""
        done: list[dict[str, Any]] = []
        while True:
            history = self.history()
            tops = undoable_ids(history)
            todo = [h for h in reversed(history)
                    if h["proposed_by"] == connector_id and h["action"] != "undo" and not h.get("undone_by")
                    and h["id"] in tops and (since is None or h["at"][:10] >= since)]
            if not todo:
                return done
            done.append(self.undo(todo[0]["id"]))

    def _event(self, action: str, entry_id: str, before: Any, after: Any, proposed_by: str,
               proposal_id: str | None, at: str, hdata: dict[str, Any] | None = None,
               undoes: str | None = None) -> dict[str, Any]:
        own = hdata is None
        hdata = hdata if hdata is not None else self.load("history")
        event = {
            "id": _next_id("h", [h["id"] for h in hdata["history"]]),
            "at": at,
            "action": action,
            "entry_id": entry_id,
            "before": before,
            "after": after,
            "proposed_by": proposed_by,
            "approved_by": "user",
            "proposal_id": proposal_id,
            "undoes": undoes,
            "undone_by": None,
        }
        hdata["history"].append(event)
        if own:
            self.save("history", hdata)
        return event

    def reset(self) -> None:
        """Restore the demo store from store/seed/."""
        seed = self.folder / "seed"
        if not seed.is_dir():
            raise StoreError(f"No seed folder at {seed}.")
        with self.locked():
            for name in FILES:
                src = seed / f"{name}.json"
                if src.exists():
                    shutil.copyfile(src, self.folder / f"{name}.json")


def undoable_ids(history: list[dict[str, Any]]) -> set[str]:
    """The newest change to each entry that is still in effect. Only those can be undone,
    so an undo never skips over a later change (like reverting the top commit)."""
    stacks: dict[str, list[str]] = {}
    for h in history:
        stack = stacks.setdefault(h["entry_id"], [])
        if h["action"] == "undo":
            if h.get("undoes") in stack:
                stack.remove(h["undoes"])
        else:
            stack.append(h["id"])
    return {stack[-1] for stack in stacks.values() if stack}


def fingerprint(text: str) -> str:
    """Normalised text, for R11: lower case, visible characters only, no punctuation."""
    visible = firewall.strip_hidden(text).lower()
    return " ".join("".join(ch if ch.isalnum() or ch.isspace() else " " for ch in visible).split())


def why_by_user(entry: dict[str, Any]) -> bool:
    """True if the user wrote the entry's why, so it may be served to assistants.

    An assistant's why is its explanation for the user's card, and other assistants never get it.
    An entry the user added keeps their why until the user accepts an assistant's change to it.
    After that the why may be the assistant's, so it is kept back. Undo brings the user's why back.
    """
    prov = entry.get("provenance") or {}
    if (prov.get("proposed_by") or "user") != "user":
        return False
    return ((prov.get("last_change") or {}).get("proposed_by") or "user") == "user"


def describe_source(entry: dict[str, Any], names: dict[str, str]) -> str:
    prov = entry.get("provenance", {})
    by = prov.get("proposed_by", "user")
    if by == "user":
        return "stated by the user"
    who = names.get(by, by)
    if prov.get("basis") == "stated":
        return f"stated by the user to {who}, approved by the user"
    return f"{prov.get('basis', 'inferred')} by {who}, approved by the user"


def _find(items: list[dict[str, Any]], item_id: str, what: str) -> dict[str, Any]:
    for item in items:
        if item["id"] == item_id:
            return item
    raise StoreError(f"No {what} with id '{item_id}'.")


def _next_id(prefix: str, existing: list[str]) -> str:
    nums = [int(x[len(prefix):]) for x in existing if x.startswith(prefix) and x[len(prefix):].isdigit()]
    return f"{prefix}{(max(nums) + 1) if nums else 1:02d}"
