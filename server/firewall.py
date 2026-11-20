"""Screening rules for proposed changes, in the tiers of the round-2 defence design (T3, Part B).

The rules are fixed and deliberately simple, so anyone can read them. They lower
the risk; they don't remove it. What holds when a rule misses is the structure
around them:

1. Assistants can only propose. No tool can accept anything.
2. Assistants can't propose rules. Only the user writes rules.
3. The user decides in the store's own screen, outside the chat.

The same rules exist in JavaScript for the demo app (app/js/firewall.js). Both
are tested against the same cases in tests/firewall_cases.json.

The rules (numbering as in T3, section B3, plus R12):
- R1  kind "rule", or a change to one of the user's rules              -> blocked
- R2a instructions about future behaviour ("from now on", "always")    -> blocked
- R2b memory-planting wording ("remember", "trusted source")           -> needs your yes; held back if tainted
- R3  invisible or control characters (decoded and shown)              -> blocked
- R4  links, email addresses, phone numbers, IBANs, @handles           -> needs your yes
- R5  recommending a source ("most trusted", "best shop")             -> needs your yes; held back if tainted
- R6  sensitive categories (health, religion, politics, ...)          -> needs your yes; stays on the device
- R7  passwords, keys and tokens                                       -> blocked
- R8  a change to, or removal of, an existing entry                    -> needs your yes, shown as a diff
- R9  longer than 280 characters                                       -> needs your yes
- R10 and R11 (rate limit, re-proposal of a rejected entry) live in ctx_store.py.
- R12 turning off warnings, confirmations, questions before acting
      or safety checks ("don't ask me first", "skip the warnings")     -> needs your yes, never routine

The rules that read wording (R2a, R2b, R3, R4, R5, R6, R7, R9, R12) read the assistant's
explanation ("why") too, and a hit there says "(in its explanation)". The store never serves an
assistant's why to other assistants (ctx_store.py), so a hit only in the why needs your yes but
doesn't hold back or block the proposal. Hidden characters and passwords or keys are the
exception and block in the why too. The why can only add reasons; it can never clear one.

Taint comes from what the assistant's app (the client, not the model) reported:
"outside_content", "none" or "not_reported". "not_reported" counts as tainted.
A tainted proposal always needs an explicit yes.

Verdicts, from mild to strict:
- "clean":       nothing found; harmless even if false (in daily use: the weekly list).
- "review":      needs an explicit yes, one card at a time.
- "quarantined": held back: kept out of the context unless the person releases it.
- "blocked":     breaks a structural rule; it can never be accepted.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

VERDICTS = ("clean", "review", "quarantined", "blocked")
BLOCKING = ("rule_kind", "edits_rule", "instruction", "hidden", "secret")
APP_REPORTS = ("outside_content", "none", "not_reported")

# Order in which reasons are reported.
REASON_ORDER = [
    "rule_kind", "edits_rule", "hidden", "instruction", "secret",
    "plant", "recommend", "caution_off", "link", "email", "contact",
    "sensitive", "change", "remove", "long", "untrusted",
]

MAX_LENGTH = 280
OUTSIDE_PREFIX = "Its app reported outside content in this chat"
IN_WHY = " (in its explanation)"

_A = re.ASCII | re.IGNORECASE

# Reserved names (RFC 2606: .example, .test, .invalid) are included, so demo texts are caught too.
TLDS = (
    "com|eu|net|org|io|ai|app|be|nl|de|fr|uk|co|shop|store|info|biz|xyz|"
    "online|site|top|me|tv|link|click|news|example|test|invalid"
)
URL_RE = re.compile(r"\b(?:https?://|www\.)[^\s]+", _A)
DOMAIN_RE = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:" + TLDS + r")\b(?:/[^\s]*)?", _A
)
EMAIL_RE = re.compile(r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", _A)
PHONE_RE = re.compile(r"(?<![\w+])\+\d[\d\s().-]{7,}\d", _A)
IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")
HANDLE_RE = re.compile(r"(?<![\w@.])@[a-z0-9_]{2,30}\b", _A)

# R2a: wording that tells the assistant how to behave in future. ("instead", in T3's list,
# is left out: it would block ordinary preferences such as "prefers tea instead of coffee".)
INSTRUCTION_RE = re.compile(
    r"\bfrom now on\b|\balways\b|\bnever\b|\byou (?:must|should|will)\b|\bwhen i ask\b|"
    r"\bignore (?:all|any|the|previous|earlier|your|my)\b|\bmake sure\b|"
    r"\bin (?:every|all) (?:answers?|replies|responses)\b|\bevery time\b|\bwhenever\b",
    _A,
)

# R2b: memory-planting wording (Microsoft's hunting keywords, T3-16).
PLANT_RE = re.compile(
    r"\bremember\b|\btrusted sources?\b|\bauthoritative sources?\b|"
    r"\bin (?:all )?future (?:conversations|chats|answers)\b|\bcite\b",
    _A,
)

# R5: recommending a source, shop or provider.
RECOMMEND_RE = re.compile(
    r"\bmost trusted\b|\btrustworthy\b|\bauthoritative\b|\brecommended\b|"
    r"\b(?:best|official|reliable|go-to|preferred|top) (?:source|site|website|shop|store|supplier|vendor|provider)s?\b",
    _A,
)

# R12: turning off caution. Warnings, confirmations, questions before acting and safety checks
# protect the user, so a wish to drop them always needs the user's yes, even when it is worded
# as a harmless style preference. A wish for more caution can match too ("without asking her");
# it then costs one card.
CAUTION_RE = re.compile(
    r"\b(?:don[’']?t|do not|doesn[’']?t|does not|never|no need to|stop|hates?|dislikes?) "
    r"(?:(?:wants?|needs?|likes?|ha(?:ve|s)) (?:to )?(?:be )?|being )?"
    r"(?:ask(?:s|ed|ing)? (?:(?:me|her|him|them|you) )?(?:first|before|for (?:confirmation|permission|approval))|"
    r"(?:double-)?check(?:s|ed|ing)? with (?:me|her|him|them)|confirm(?:s|ed|ing|ation|ations)?|"
    r"warn(?:s|ed|ing|ings)?|questions? before)\b|"
    r"\bno need to ask\b|"
    r"\bwithout (?:first )?(?:asking|checking with|confirming|confirmation|a confirmation|any confirmation|"
    r"a warning|any warning|(?:any |safety )?(?:warnings|caveats|disclaimers)|safety checks?)\b|"
    r"\b(?:no|skip(?:s|ped|ping)?|turn(?:s|ed|ing)? off|switch(?:es|ed|ing)? off|disabl(?:e|es|ed|ing)) "
    r"(?:the |any |all |more )?(?:safety (?:checks?|warnings?|filters?|prompts?)|warnings|caveats|disclaimers|"
    r"confirmations|confirmation (?:questions?|prompts?|steps?|dialogs?|checks?|requests?)|questions? before)\b|"
    r"\bno questions asked\b",
    _A,
)

# R7: secrets.
SECRET_RE = re.compile(
    r"\b(?:sk|pk|rk)-[a-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[a-z0-9]{30,}|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|"
    r"\b(?:password|passwd|passcode|api[ _-]?key|secret|token)\s*(?:is|[:=])\s*\S+",
    _A,
)

# R6: special categories of personal data (GDPR Art. 9), as rough keyword lists.
SENSITIVE_RES = [
    (
        "health",
        re.compile(
            r"\b(?:coeliac|celiac|diabet\w*|depress\w*|anxiety|adhd|autis\w*|dyslexi\w*|"
            r"pregnan\w*|diagnos\w*|medication|therapy|therapist|illness|disease|"
            r"disabilit\w*|allerg\w*|cancer|hiv|mental health|migraine\w*)\b",
            _A,
        ),
    ),
    (
        "religious",
        re.compile(
            r"\b(?:religio\w*|church|mosque|synagogue|muslim|christian|jewish|"
            r"catholic|protestant|hindu|buddhist|atheist|prays?|ramadan|halal|kosher)\b",
            _A,
        ),
    ),
    (
        "political",
        re.compile(
            r"\b(?:political|politics|party member|member of the \w+ party|votes? for|"
            r"left-wing|right-wing)\b",
            _A,
        ),
    ),
    (
        "sexual orientation",
        re.compile(r"\b(?:gay|lesbian|bisexual|sexual orientation|transgender|queer)\b", _A),
    ),
    ("trade union", re.compile(r"\b(?:trade union|union member\w*)\b", _A)),
    ("ethnic", re.compile(r"\b(?:ethnic\w*|racial)\b", _A)),
    ("genetic", re.compile(r"\b(?:genetic\w*|dna test\w*)\b", _A)),
]

_ZERO_WIDTH = {0x200B, 0x200C, 0x200D, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xFEFF, 0x180E}


def _is_hidden(cp: int, ch: str) -> bool:
    if 0xE0000 <= cp <= 0xE007F:  # Unicode tag characters ("ASCII smuggling")
        return True
    if 0xE0100 <= cp <= 0xE01EF:  # variation selectors supplement
        return True
    if cp in _ZERO_WIDTH:
        return True
    if 0x202A <= cp <= 0x202E or 0x2066 <= cp <= 0x2069 or cp in (0x200E, 0x200F):
        return True  # bidirectional controls
    return unicodedata.category(ch) == "Cf"


def split_hidden(text: str) -> tuple[str, int, str]:
    """Return (visible text, number of hidden characters, decoded tag text)."""
    visible, decoded = [], []
    count = 0
    for ch in text:
        cp = ord(ch)
        if _is_hidden(cp, ch):
            count += 1
            if 0xE0020 <= cp <= 0xE007E:
                decoded.append(chr(cp - 0xE0000))
        else:
            visible.append(ch)
    return "".join(visible), count, "".join(decoded).strip()


def strip_hidden(text: str) -> str:
    return split_hidden(text)[0]


def to_tags(text: str) -> str:
    """Encode ASCII text as invisible tag characters. Used to build the demo's attack sample at run time."""
    return "".join(chr(0xE0000 + ord(c)) for c in text)


@dataclass
class Reason:
    code: str
    label: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "label": self.label}


@dataclass
class Screening:
    verdict: str
    reasons: list[Reason] = field(default_factory=list)
    hidden_text: str | None = None
    app_reported: str = "not_reported"

    @property
    def codes(self) -> list[str]:
        return [r.code for r in self.reasons]

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "verdict": self.verdict,
            "reasons": [r.to_dict() for r in self.reasons],
        }
        if self.hidden_text:
            out["hidden_text"] = self.hidden_text
        return out


def _quote(s: str) -> str:
    return "“" + s + "”"


def _unique(items: list[str]) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item.lower() not in [s.lower() for s in seen]:
            seen.append(item)
    return seen


def _words(matches: list[str]) -> str:
    return ", ".join(_quote(w) for w in _unique([m.strip().rstrip(":").strip() for m in matches]))


def app_report(proposal: dict[str, Any]) -> str:
    value = proposal.get("app_reported") or "not_reported"
    return value if value in APP_REPORTS else "not_reported"


@dataclass
class _Hit:
    """What one wording rule found in one field: "head: detail", or "head." and a tail."""

    head: str
    detail: str | None = None
    tail: str = ""


def _label(hit: _Hit, where: str = "") -> str:
    if hit.detail is not None:
        return f"{hit.head}: {hit.detail}{where}"
    return f"{hit.head}{where}.{hit.tail}"


def _scan(raw: str) -> tuple[dict[str, _Hit], str]:
    """Run the rules that read wording on one field. Returns the hits by code and the decoded hidden text."""
    hits: dict[str, _Hit] = {}

    # R3: hidden characters. The decoded text is screened along with the visible text.
    visible, n_hidden, decoded = split_hidden(raw)
    if n_hidden:
        hits["hidden"] = _Hit(f"Contains {n_hidden} hidden character{'s' if n_hidden != 1 else ''} you can’t see",
                              tail=f" They spell: {_quote(decoded)}" if decoded else "")
    text = visible + (" " + decoded if decoded else "")

    # R2a, R7, R2b, R5, R12
    instr = INSTRUCTION_RE.findall(text)
    if instr:
        hits["instruction"] = _Hit("Tells the assistant how to behave from now on", _words(instr))
    if SECRET_RE.search(text):
        hits["secret"] = _Hit("Looks like a password or a key")
    plant = PLANT_RE.findall(text)
    if plant:
        hits["plant"] = _Hit("Memory-planting wording", _words(plant))
    rec = RECOMMEND_RE.findall(text)
    if rec:
        hits["recommend"] = _Hit("Recommends a source", _words(rec))
    caution = CAUTION_RE.findall(text)
    if caution:
        hits["caution_off"] = _Hit("Turns off warnings or confirmations", _words(caution))

    # R4: links and contact details
    emails = EMAIL_RE.findall(text)
    if emails:
        hits["email"] = _Hit("Contains an email address", ", ".join(_unique(emails)))
    rest = EMAIL_RE.sub(" ", text)
    links = URL_RE.findall(rest) + DOMAIN_RE.findall(URL_RE.sub(" ", rest))
    if links:
        hits["link"] = _Hit("Contains a website", ", ".join(_unique([l.rstrip(".,;:!?)") for l in links])))
    contacts = PHONE_RE.findall(rest) + IBAN_RE.findall(rest) + HANDLE_RE.findall(rest)
    if contacts:
        hits["contact"] = _Hit("Contains a phone number, account number or handle",
                               ", ".join(_unique([c.strip() for c in contacts])))

    # R6: sensitive topics: an explicit yes, and the entry stays on this device
    cats = [name for name, rx in SENSITIVE_RES if rx.search(text)]
    if cats:
        hits["sensitive"] = _Hit(f"May reveal {' and '.join(cats)} information",
                                 tail=" If you accept it, it stays on this device.")

    # R9
    if len(visible) > MAX_LENGTH:
        hits["long"] = _Hit(f"Longer than {MAX_LENGTH} characters")
    return hits, decoded


def screen(proposal: dict[str, Any], entries: list[dict[str, Any]] | None = None) -> Screening:
    """Screen one proposal. `entries` is the current store, used to look up targets."""
    entries = entries or []
    found: dict[str, Reason] = {}

    op = proposal.get("op", "add")
    kind = proposal.get("kind", "fact")
    raw = proposal.get("text") or ""
    target = None
    if proposal.get("entry_id"):
        target = next((e for e in entries if e.get("id") == proposal["entry_id"]), None)

    # R1: structure. Assistants never write rules or change the user's rules.
    if kind == "rule":
        found["rule_kind"] = Reason("rule_kind", "Assistants can’t add rules. Only you write rules.")
    if target is not None and target.get("kind") == "rule":
        found["edits_rule"] = Reason("edits_rule", "Assistants can’t change your rules.")

    # The wording rules, on the text and on the assistant's explanation ("why").
    in_text, decoded = _scan(raw)
    in_why = _scan(proposal.get("why") or "")[0]
    only_in_why: set[str] = set()
    for code in REASON_ORDER:
        t, w = in_text.get(code), in_why.get(code)
        if t and w:
            label = _label(t)
            label += ("" if label.endswith(".") else ".") + " Also in its explanation" + (
                f": {w.detail}." if w.detail is not None else ".")
            found[code] = Reason(code, label)
        elif t:
            found[code] = Reason(code, _label(t))
        elif w:
            found[code] = Reason(code, _label(w, IN_WHY))
            only_in_why.add(code)

    # R8
    if op == "update":
        found["change"] = Reason("change", "Changes an existing entry.")
    if op == "remove":
        found["remove"] = Reason("remove", "Removes an entry.")

    # Taint: what the assistant's app reported. The store can't see what the model read.
    report = app_report(proposal)
    if report == "outside_content":
        detail = (proposal.get("app_detail") or "").strip()
        found["untrusted"] = Reason("untrusted", OUTSIDE_PREFIX + (f": {detail}." if detail else "."))
    elif report == "not_reported":
        found["untrusted"] = Reason(
            "untrusted", "Its app didn’t report what it had read, so the store treats it as untrusted."
        )

    reasons = [found[c] for c in REASON_ORDER if c in found]
    codes = set(found)
    tainted = report != "none"
    # A hit only in the why reaches no other assistant, so it needs a yes and no more.
    # Hidden characters and passwords or keys still block there.
    strict = codes - (only_in_why - {"hidden", "secret"})
    if strict & set(BLOCKING):
        verdict = "blocked"
    elif strict & {"plant", "recommend"} and tainted:
        verdict = "quarantined"
    elif codes:
        verdict = "review"
    else:
        verdict = "clean"
    return Screening(verdict=verdict, reasons=reasons, hidden_text=decoded or None, app_reported=report)


def _content_kind(detail: str) -> str:
    d = detail.lower()
    if re.search(r"attachment|\.pdf|\.docx?|e-?mail", d):
        return "an email attachment"
    if re.search(r"page|https?://|www\.|\.(?:" + TLDS + r")\b", d):
        return "a web page"
    return "outside content"


def reported_from_reasons(reasons: list[Any]) -> tuple[str, str | None]:
    """Recover what the app reported from the reasons, so a saved screening is enough."""
    for r in reasons:
        code = r["code"] if isinstance(r, dict) else r.code
        label = r["label"] if isinstance(r, dict) else r.label
        if code == "untrusted":
            if label.startswith(OUTSIDE_PREFIX):
                return "outside_content", (label[len(OUTSIDE_PREFIX):].lstrip(": ").rstrip(".") or None)
            return "not_reported", None
    return "none", None


def summary(screening: Screening, app_detail: str | None = None) -> str:
    """One plain-language line for the person, built only from what the store knows."""
    codes = set(screening.codes)
    report, detail_from_label = reported_from_reasons(screening.reasons)
    app_detail = app_detail or detail_from_label
    parts: list[str] = []
    if "rule_kind" in codes:
        parts.append("tries to add a rule")
    elif "edits_rule" in codes:
        parts.append("tries to change your rule")
    if "hidden" in codes:
        parts.append("carries hidden text")
    if "instruction" in codes and not ({"rule_kind", "edits_rule", "hidden"} & codes):
        parts.append("tells the assistant how to behave from now on")
    if "secret" in codes:
        parts.append("contains a password or key")
    if screening.verdict != "blocked":
        if {"plant", "recommend"} & codes and "link" in codes:
            parts.append("recommends a website as a trusted source")
        elif "recommend" in codes:
            parts.append("recommends a source")
        elif "plant" in codes:
            parts.append("tries to plant a memory")
        elif "link" in codes:
            parts.append("contains a website")
        if "caution_off" in codes:
            parts.append("turns off warnings or confirmations")
        if "change" in codes:
            parts.append("changes an existing entry")
        if "remove" in codes:
            parts.append("removes an entry")
        if "email" in codes:
            parts.append("adds an email address")
        if "contact" in codes:
            parts.append("adds contact or payment details")
        if "sensitive" in codes:
            parts.append("may be sensitive")
        if "long" in codes:
            parts.append("is long")
    if report == "outside_content":
        parts.append("its app reported reading " + _content_kind(app_detail or "") + " just before")
    elif report == "not_reported":
        parts.append("its app didn’t report what it had read")
    if not parts:
        return "No warnings."
    line = "; ".join(parts)
    return line[0].upper() + line[1:] + "."
