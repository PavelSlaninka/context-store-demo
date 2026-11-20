/*
 * Screening rules for proposed changes, in the tiers of the round-2 defence design (T3, Part B).
 *
 * A port of server/firewall.py. Both are tested against the same cases in
 * tests/firewall_cases.json, so the app and the MCP server give the same verdicts,
 * in the same words.
 *
 * The rules lower the risk; the structure prevents the harm: assistants can only
 * propose, can't propose rules, and only the person accepts, outside the chat.
 *
 * Verdicts: clean (routine), review (needs your yes), quarantined (held back), blocked.
 * Taint comes from what the assistant's app reported: outside_content, none or
 * not_reported. "not_reported" counts as tainted.
 *
 * The rules that read wording also read the assistant's explanation ("why"), and a hit there
 * says "(in its explanation)". No other assistant ever gets an assistant's why, so a hit only
 * in the why needs your yes but doesn't hold back or block the proposal. Hidden characters
 * and passwords or keys are the exception and block in the why too.
 */
(function (global) {
  "use strict";

  var VERDICTS = ["clean", "review", "quarantined", "blocked"];
  var BLOCKING = ["rule_kind", "edits_rule", "instruction", "hidden", "secret"];
  var APP_REPORTS = ["outside_content", "none", "not_reported"];
  var REASON_ORDER = [
    "rule_kind", "edits_rule", "hidden", "instruction", "secret",
    "plant", "recommend", "caution_off", "link", "email", "contact",
    "sensitive", "change", "remove", "long", "untrusted"
  ];
  var MAX_LENGTH = 280;
  var OUTSIDE_PREFIX = "Its app reported outside content in this chat";
  var IN_WHY = " (in its explanation)";

  var TLDS =
    "com|eu|net|org|io|ai|app|be|nl|de|fr|uk|co|shop|store|info|biz|xyz|" +
    "online|site|top|me|tv|link|click|news|example|test|invalid";
  var URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+/gi;
  var DOMAIN_RE = new RegExp(
    "\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:" + TLDS + ")\\b(?:/[^\\s]*)?",
    "gi"
  );
  var EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
  var PHONE_RE = /(?<![\w+])\+\d[\d\s().-]{7,}\d/gi;
  var IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
  var HANDLE_RE = /(?<![\w@.])@[a-z0-9_]{2,30}\b/gi;

  var INSTRUCTION_RE = new RegExp(
    "\\bfrom now on\\b|\\balways\\b|\\bnever\\b|\\byou (?:must|should|will)\\b|\\bwhen i ask\\b|" +
      "\\bignore (?:all|any|the|previous|earlier|your|my)\\b|\\bmake sure\\b|" +
      "\\bin (?:every|all) (?:answers?|replies|responses)\\b|\\bevery time\\b|\\bwhenever\\b",
    "gi"
  );
  var PLANT_RE = new RegExp(
    "\\bremember\\b|\\btrusted sources?\\b|\\bauthoritative sources?\\b|" +
      "\\bin (?:all )?future (?:conversations|chats|answers)\\b|\\bcite\\b",
    "gi"
  );
  var RECOMMEND_RE = new RegExp(
    "\\bmost trusted\\b|\\btrustworthy\\b|\\bauthoritative\\b|\\brecommended\\b|" +
      "\\b(?:best|official|reliable|go-to|preferred|top) (?:source|site|website|shop|store|supplier|vendor|provider)s?\\b",
    "gi"
  );
  // R12: turning off warnings, confirmations, questions before acting or safety checks.
  var CAUTION_RE = new RegExp(
    "\\b(?:don[’']?t|do not|doesn[’']?t|does not|never|no need to|stop|hates?|dislikes?) " +
      "(?:(?:wants?|needs?|likes?|ha(?:ve|s)) (?:to )?(?:be )?|being )?" +
      "(?:ask(?:s|ed|ing)? (?:(?:me|her|him|them|you) )?(?:first|before|for (?:confirmation|permission|approval))|" +
      "(?:double-)?check(?:s|ed|ing)? with (?:me|her|him|them)|confirm(?:s|ed|ing|ation|ations)?|" +
      "warn(?:s|ed|ing|ings)?|questions? before)\\b|" +
      "\\bno need to ask\\b|" +
      "\\bwithout (?:first )?(?:asking|checking with|confirming|confirmation|a confirmation|any confirmation|" +
      "a warning|any warning|(?:any |safety )?(?:warnings|caveats|disclaimers)|safety checks?)\\b|" +
      "\\b(?:no|skip(?:s|ped|ping)?|turn(?:s|ed|ing)? off|switch(?:es|ed|ing)? off|disabl(?:e|es|ed|ing)) " +
      "(?:the |any |all |more )?(?:safety (?:checks?|warnings?|filters?|prompts?)|warnings|caveats|disclaimers|" +
      "confirmations|confirmation (?:questions?|prompts?|steps?|dialogs?|checks?|requests?)|questions? before)\\b|" +
      "\\bno questions asked\\b",
    "gi"
  );
  var SECRET_RE = new RegExp(
    "\\b(?:sk|pk|rk)-[a-z0-9_-]{16,}|\\bAKIA[0-9A-Z]{16}\\b|\\bgh[pousr]_[a-z0-9]{30,}|" +
      "-----BEGIN [A-Z ]*PRIVATE KEY-----|" +
      "\\b(?:password|passwd|passcode|api[ _-]?key|secret|token)\\s*(?:is|[:=])\\s*\\S+",
    "i"
  );

  var SENSITIVE_RES = [
    ["health", new RegExp(
      "\\b(?:coeliac|celiac|diabet\\w*|depress\\w*|anxiety|adhd|autis\\w*|dyslexi\\w*|" +
        "pregnan\\w*|diagnos\\w*|medication|therapy|therapist|illness|disease|" +
        "disabilit\\w*|allerg\\w*|cancer|hiv|mental health|migraine\\w*)\\b", "i")],
    ["religious", new RegExp(
      "\\b(?:religio\\w*|church|mosque|synagogue|muslim|christian|jewish|" +
        "catholic|protestant|hindu|buddhist|atheist|prays?|ramadan|halal|kosher)\\b", "i")],
    ["political", new RegExp(
      "\\b(?:political|politics|party member|member of the \\w+ party|votes? for|" +
        "left-wing|right-wing)\\b", "i")],
    ["sexual orientation", /\b(?:gay|lesbian|bisexual|sexual orientation|transgender|queer)\b/i],
    ["trade union", /\b(?:trade union|union member\w*)\b/i],
    ["ethnic", /\b(?:ethnic\w*|racial)\b/i],
    ["genetic", /\b(?:genetic\w*|dna test\w*)\b/i]
  ];

  var ZERO_WIDTH = [0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x180e];
  var CF_RE = /^\p{Cf}$/u;

  function isHidden(cp, ch) {
    if (cp >= 0xe0000 && cp <= 0xe007f) return true;
    if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
    if (ZERO_WIDTH.indexOf(cp) !== -1) return true;
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f) return true;
    return CF_RE.test(ch);
  }

  /** Returns {visible, count, decoded}. */
  function splitHidden(text) {
    var visible = "", decoded = "", count = 0;
    for (var ch of String(text || "")) {
      var cp = ch.codePointAt(0);
      if (isHidden(cp, ch)) {
        count += 1;
        if (cp >= 0xe0020 && cp <= 0xe007e) decoded += String.fromCodePoint(cp - 0xe0000);
      } else {
        visible += ch;
      }
    }
    return { visible: visible, count: count, decoded: decoded.trim() };
  }

  function stripHidden(text) { return splitHidden(text).visible; }

  /** Encode ASCII text as invisible tag characters: used to build the demo's attack sample at run time. */
  function toTags(text) {
    return Array.from(String(text)).map(function (c) { return String.fromCodePoint(0xe0000 + c.codePointAt(0)); }).join("");
  }

  function quote(s) { return "“" + s + "”"; }

  function unique(items) {
    var out = [], lower = [];
    items.forEach(function (item) {
      if (lower.indexOf(item.toLowerCase()) === -1) { out.push(item); lower.push(item.toLowerCase()); }
    });
    return out;
  }

  function all(re, text) {
    re.lastIndex = 0;
    return text.match(re) || [];
  }

  function wordsOf(matches) {
    return unique(matches.map(function (m) { return m.trim().replace(/:+$/, "").trim(); })).map(quote).join(", ");
  }

  function appReport(proposal) {
    var v = proposal.app_reported || "not_reported";
    return APP_REPORTS.indexOf(v) !== -1 ? v : "not_reported";
  }

  // What one wording rule found in one field: "head: detail", or "head." and a tail.
  function hit(head, detail, tail) {
    return { head: head, detail: detail === undefined ? null : detail, tail: tail || "" };
  }

  function labelOf(h, where) {
    where = where || "";
    if (h.detail !== null) return h.head + ": " + h.detail + where;
    return h.head + where + "." + h.tail;
  }

  /** Run the rules that read wording on one field. Returns {hits, decoded}. */
  function scan(raw) {
    var hits = {};

    // R3: hidden characters. The decoded text is screened along with the visible text.
    var hidden = splitHidden(raw);
    if (hidden.count) {
      hits.hidden = hit("Contains " + hidden.count + " hidden character" + (hidden.count !== 1 ? "s" : "") + " you can’t see",
        null, hidden.decoded ? " They spell: " + quote(hidden.decoded) : "");
    }
    var text = hidden.visible + (hidden.decoded ? " " + hidden.decoded : "");

    var instr = all(INSTRUCTION_RE, text);
    if (instr.length) hits.instruction = hit("Tells the assistant how to behave from now on", wordsOf(instr));
    if (SECRET_RE.test(text)) hits.secret = hit("Looks like a password or a key");
    var plant = all(PLANT_RE, text);
    if (plant.length) hits.plant = hit("Memory-planting wording", wordsOf(plant));
    var rec = all(RECOMMEND_RE, text);
    if (rec.length) hits.recommend = hit("Recommends a source", wordsOf(rec));
    var caution = all(CAUTION_RE, text);
    if (caution.length) hits.caution_off = hit("Turns off warnings or confirmations", wordsOf(caution));

    var emails = all(EMAIL_RE, text);
    if (emails.length) hits.email = hit("Contains an email address", unique(emails).join(", "));
    var rest = text.replace(EMAIL_RE, " ");
    var links = all(URL_RE, rest).concat(all(DOMAIN_RE, rest.replace(URL_RE, " ")));
    if (links.length) {
      hits.link = hit("Contains a website", unique(links.map(function (l) { return l.replace(/[.,;:!?)]+$/, ""); })).join(", "));
    }
    var contacts = all(PHONE_RE, rest).concat(all(IBAN_RE, rest), all(HANDLE_RE, rest));
    if (contacts.length) {
      hits.contact = hit("Contains a phone number, account number or handle", unique(contacts.map(function (c) { return c.trim(); })).join(", "));
    }

    var cats = SENSITIVE_RES.filter(function (pair) { return pair[1].test(text); }).map(function (pair) { return pair[0]; });
    if (cats.length) hits.sensitive = hit("May reveal " + cats.join(" and ") + " information", null, " If you accept it, it stays on this device.");

    if (Array.from(hidden.visible).length > MAX_LENGTH) hits.long = hit("Longer than " + MAX_LENGTH + " characters");
    return { hits: hits, decoded: hidden.decoded };
  }

  /** Screen one proposal against the current entries. Returns {verdict, reasons, hiddenText, appReported}. */
  function screen(proposal, entries) {
    entries = entries || [];
    var found = {};
    var op = proposal.op || "add";
    var kind = proposal.kind || "fact";
    var raw = proposal.text || "";
    var target = null;
    if (proposal.entry_id) {
      target = entries.filter(function (e) { return e.id === proposal.entry_id; })[0] || null;
    }

    if (kind === "rule") found.rule_kind = "Assistants can’t add rules. Only you write rules.";
    if (target && target.kind === "rule") found.edits_rule = "Assistants can’t change your rules.";

    // The wording rules, on the text and on the assistant's explanation ("why").
    var inText = scan(raw);
    var inWhy = scan(proposal.why || "");
    var onlyInWhy = {};
    REASON_ORDER.forEach(function (code) {
      var t = inText.hits[code], w = inWhy.hits[code];
      if (t && w) {
        var label = labelOf(t);
        found[code] = label + (/\.$/.test(label) ? "" : ".") + " Also in its explanation" + (w.detail !== null ? ": " + w.detail + "." : ".");
      } else if (t) {
        found[code] = labelOf(t);
      } else if (w) {
        found[code] = labelOf(w, IN_WHY);
        onlyInWhy[code] = true;
      }
    });

    if (op === "update") found.change = "Changes an existing entry.";
    if (op === "remove") found.remove = "Removes an entry.";

    var report = appReport(proposal);
    if (report === "outside_content") {
      var detail = String(proposal.app_detail || "").trim();
      found.untrusted = OUTSIDE_PREFIX + (detail ? ": " + detail + "." : ".");
    } else if (report === "not_reported") {
      found.untrusted = "Its app didn’t report what it had read, so the store treats it as untrusted.";
    }

    var reasons = REASON_ORDER.filter(function (c) { return c in found; }).map(function (c) { return { code: c, label: found[c] }; });
    var tainted = report !== "none";
    // A hit only in the why reaches no other assistant, so it needs a yes and no more.
    // Hidden characters and passwords or keys still block there.
    function strict(c) { return c in found && (!onlyInWhy[c] || c === "hidden" || c === "secret"); }
    var verdict;
    if (BLOCKING.some(strict)) verdict = "blocked";
    else if ((strict("plant") || strict("recommend")) && tainted) verdict = "quarantined";
    else if (reasons.length) verdict = "review";
    else verdict = "clean";
    return { verdict: verdict, reasons: reasons, hiddenText: inText.decoded || null, appReported: report };
  }

  function contentKind(detail) {
    var d = String(detail || "").toLowerCase();
    if (/attachment|\.pdf|\.docx?|e-?mail/.test(d)) return "an email attachment";
    if (new RegExp("page|https?://|www\\.|\\.(?:" + TLDS + ")\\b").test(d)) return "a web page";
    return "outside content";
  }

  /** Recover what the app reported from the reasons, so a saved screening is enough. */
  function reportedFromReasons(reasons) {
    for (var i = 0; i < reasons.length; i++) {
      if (reasons[i].code === "untrusted") {
        var label = reasons[i].label;
        if (label.indexOf(OUTSIDE_PREFIX) === 0) {
          return { report: "outside_content", detail: label.slice(OUTSIDE_PREFIX.length).replace(/^[:\s]+/, "").replace(/\.$/, "") || null };
        }
        return { report: "not_reported", detail: null };
      }
    }
    return { report: "none", detail: null };
  }

  /** One plain-language line, built only from what the store knows. */
  function summary(screening, appDetail) {
    var rep = reportedFromReasons(screening.reasons);
    appDetail = appDetail || rep.detail;
    var codes = {};
    screening.reasons.forEach(function (r) { codes[r.code] = true; });
    var parts = [];
    if (codes.rule_kind) parts.push("tries to add a rule");
    else if (codes.edits_rule) parts.push("tries to change your rule");
    if (codes.hidden) parts.push("carries hidden text");
    if (codes.instruction && !(codes.rule_kind || codes.edits_rule || codes.hidden)) parts.push("tells the assistant how to behave from now on");
    if (codes.secret) parts.push("contains a password or key");
    if (screening.verdict !== "blocked") {
      if ((codes.plant || codes.recommend) && codes.link) parts.push("recommends a website as a trusted source");
      else if (codes.recommend) parts.push("recommends a source");
      else if (codes.plant) parts.push("tries to plant a memory");
      else if (codes.link) parts.push("contains a website");
      if (codes.caution_off) parts.push("turns off warnings or confirmations");
      if (codes.change) parts.push("changes an existing entry");
      if (codes.remove) parts.push("removes an entry");
      if (codes.email) parts.push("adds an email address");
      if (codes.contact) parts.push("adds contact or payment details");
      if (codes.sensitive) parts.push("may be sensitive");
      if (codes.long) parts.push("is long");
    }
    if (rep.report === "outside_content") parts.push("its app reported reading " + contentKind(appDetail) + " just before");
    else if (rep.report === "not_reported") parts.push("its app didn’t report what it had read");
    if (!parts.length) return "No warnings.";
    var line = parts.join("; ");
    return line.charAt(0).toUpperCase() + line.slice(1) + ".";
  }

  global.Firewall = {
    VERDICTS: VERDICTS,
    screen: screen,
    summary: summary,
    splitHidden: splitHidden,
    stripHidden: stripHidden,
    toTags: toTags,
    isHidden: isHidden
  };
})(typeof window !== "undefined" ? window : globalThis);
