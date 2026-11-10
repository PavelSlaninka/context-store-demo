/*
 * Context Store demo app. Vanilla JS, no build step, no network.
 *
 * Live in this file: the store (entries, proposals, history, connectors, reads),
 * screening with the same rules as the MCP server (firewall.js), accepting,
 * rejecting, editing and undoing. Scripted: the two chat answers (story.js).
 *
 * Presenter keys: Right/Left or PageDown/PageUp change screens, 1-6 jump.
 * URL options: ?shot=1 starts fresh without motion or saving (for screenshots);
 * &do=a,b,c replays actions (see replay()).
 */
(function () {
  "use strict";

  var STORY = window.STORY;
  var SEED = window.DEMO_STORE;
  var FW = window.Firewall;
  var TZ = "Europe/Brussels";
  var STORAGE_KEY = "context-store-demo.v1";

  var params = new URLSearchParams(location.search);
  var SHOT = params.has("shot");
  if (SHOT) document.documentElement.classList.add("shot");

  // ---------------------------------------------------------------- utilities

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function nextId(prefix, ids) {
    var max = 0;
    ids.forEach(function (id) {
      if (id && id.indexOf(prefix) === 0) {
        var n = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    var n = max + 1;
    return prefix + (n < 10 ? "0" + n : String(n));
  }

  var ICONS = {
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.8a3 3 0 0 1 6 0V9"/>',
    unlock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.8a3 3 0 0 1 5.8-1"/>',
    user: '<circle cx="10" cy="6.8" r="3.1"/><path d="M3.9 17c.8-3.2 3.3-5.1 6.1-5.1s5.3 1.9 6.1 5.1"/>',
    check: '<path d="M4.5 10.5 8.2 14l7.3-7.6"/>',
    alert: '<path d="M10 3.2 17.6 16.4H2.4z"/><path d="M10 8.2v3.9"/><path d="M10 14.3v.2"/>',
    block: '<circle cx="10" cy="10" r="7"/><path d="M5.1 14.9 14.9 5.1"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9.2v4.6"/><path d="M10 6.4v.2"/>',
    pencil: '<path d="M4 16.2 4.9 12.4 13 4.3l2.8 2.8-8.1 8.1z"/><path d="M11.5 5.8l2.8 2.8"/>',
    undo: '<path d="M7.6 5.6 4 9.2l3.6 3.6"/><path d="M4.4 9.2h7.4a4.1 4.1 0 0 1 0 8.2H9"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    eyeoff: '<path d="M3.2 3.2l13.6 13.6"/><path d="M8.4 5.2c.5-.1 1-.2 1.6-.2 4.4 0 7.4 5 7.4 5a13.5 13.5 0 0 1-2.3 2.9"/><path d="M5.7 6.5C3.8 7.9 2.6 10 2.6 10s3 5 7.4 5c1.3 0 2.4-.3 3.4-.8"/><path d="M8.3 8.4a2.3 2.3 0 0 0 3.3 3.2"/>',
    wallet: '<rect x="2.6" y="5.6" width="14.8" height="10.6" rx="2"/><path d="M13.4 10.9h4"/><path d="M4.6 5.6 12.4 3l1.2 2.6"/>',
    laptop: '<rect x="4.2" y="4.5" width="11.6" height="8.4" rx="1.2"/><path d="M2.4 15.6h15.2"/>',
    cloud: '<path d="M6.2 15.6h8.3a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.6 1.1 2.9 2.9 0 0 0 .9 5.7z"/>',
    pause: '<path d="M7.6 5v10M12.4 5v10"/>',
    play: '<path d="M7 4.8v10.4L15.2 10z"/>',
    x: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
    link: '<path d="M8.6 11.4a3 3 0 0 0 4.3 0l2.4-2.4a3 3 0 0 0-4.3-4.3l-.9.9"/><path d="M11.4 8.6a3 3 0 0 0-4.3 0L4.7 11a3 3 0 0 0 4.3 4.3l.9-.9"/>',
    clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6.2V10l2.6 1.8"/>',
    arrow: '<path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  // ---------------------------------------------------------------- the demo clock

  var loadedAt = Date.now();
  function nowISO() {
    return new Date(Date.parse(STORY.now) + (Date.now() - loadedAt)).toISOString().replace(/\.\d+Z$/, "Z");
  }
  var partsFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  function parts(iso) {
    var p = {};
    partsFmt.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function dayKey(iso) { var p = parts(iso); return p.year + "-" + p.month + "-" + p.day; }
  function hm(iso) { var p = parts(iso); return p.hour + ":" + p.minute; }
  function dayLabel(iso, long) {
    var k = dayKey(iso);
    if (k === dayKey(nowISO())) return "Today";
    if (k === dayKey(new Date(Date.parse(nowISO()) - 86400000).toISOString())) return "Yesterday";
    var p = parts(iso);
    return parseInt(p.day, 10) + " " + (long ? MONTHS_LONG : MONTHS)[parseInt(p.month, 10) - 1];
  }
  function when(iso) {
    var d = dayLabel(iso);
    return d + (d === "Today" || d === "Yesterday" ? " " : ", ") + hm(iso);
  }
  function onDay(iso) {
    var d = dayLabel(iso);
    return d === "Today" || d === "Yesterday" ? d.toLowerCase() : d;
  }

  // ---------------------------------------------------------------- state

  var state;
  function freshState() {
    return {
      entries: clone(SEED.entries.entries),
      owner: clone(SEED.entries.owner),
      proposals: clone(SEED.proposals.proposals).map(function (p) {
        if (p.demo_hidden) { p.text = p.text + FW.toTags(p.demo_hidden); delete p.demo_hidden; }
        return p;
      }),
      history: clone(SEED.history.history),
      connectors: clone(SEED.connectors.connectors),
      reads: clone(SEED.reads.reads),
      ui: {
        screen: 0,
        filter: "all",
        tab: "inbox",
        selected: "p04",
        editing: null,
        draft: "",
        useContext: true,
        editingSignoff: false,
        signoffDraft: "",
        connect: { step: 0, work: true, personal: false, propose: true }
      }
    };
  }
  function load() {
    if (SHOT) return freshState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.entries && s.ui) return s;
      }
    } catch (e) { /* storage blocked: start fresh */ }
    return freshState();
  }
  function save() {
    if (SHOT) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function resetDemo() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    state = freshState();
    memo = {};
    typingUntil = {};
    readOnEnter = false;
    flash = { entries: {}, events: {}, reads: {} };
    var hash = STORY.screens[0].id;
    history.replaceState(null, "", "#" + hash);
    render(true);
    toast("The demo is back at the start.");
  }

  // ---------------------------------------------------------------- selectors

  function connector(id) { return state.connectors.filter(function (c) { return c.id === id; })[0] || null; }
  function liveConnectors() { return state.connectors.slice(); }
  function entry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }
  function proposal(id) { return state.proposals.filter(function (p) { return p.id === id; })[0] || null; }
  function activeEntries() { return state.entries.filter(function (e) { return e.status === "active"; }); }
  var KIND_ORDER = { fact: 0, preference: 1, rule: 2 };
  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id < b.id ? -1 : 1);
    });
  }
  function canReadSensitive(c) { return c.location === "this-device" && c.may_read_sensitive; }
  function visibleFor(c) {
    if (!c || c.status !== "active") return [];
    return sortEntries(activeEntries()).filter(function (e) {
      if (!e.scope.some(function (s) { return c.scopes.indexOf(s) !== -1; })) return false;
      if (e.sensitivity === "sensitive" && !canReadSensitive(c)) return false;
      return true;
    });
  }
  function inScope(scope, sensitiveOk) {
    return activeEntries().filter(function (e) {
      return e.scope.indexOf(scope) !== -1 && (sensitiveOk || e.sensitivity !== "sensitive");
    }).length;
  }
  function inbox() {
    return state.proposals.filter(function (p) {
      return p.status === "pending" || (p.status === "blocked" && !p.dismissed);
    }).sort(byReceived);
  }
  function handled() {
    return state.proposals.filter(function (p) {
      return p.status === "accepted" || p.status === "rejected" || (p.status === "blocked" && p.dismissed);
    }).sort(function (a, b) { return byReceived(b, a); });
  }
  function byReceived(a, b) { return a.received < b.received ? -1 : a.received > b.received ? 1 : 0; }
  function pendingCount() { return inbox().length; }
  function name(id) {
    if (id === "user") return "you";
    var c = connector(id);
    return c ? c.name : id;
  }
  function letter(id) { var c = connector(id); return c ? c.name.slice(-1) : id.slice(-1).toUpperCase(); }
  function mark(id, size) {
    return '<span class="mark mark-' + esc(id) + (size ? " mark-" + size : "") + '" aria-hidden="true">' + esc(letter(id)) + "</span>";
  }

  // ---------------------------------------------------------------- operations

  function addEvent(action, entryId, before, after, proposedBy, proposalId, undoes) {
    var ev = {
      id: nextId("h", state.history.map(function (h) { return h.id; })),
      at: nowISO(),
      action: action,
      entry_id: entryId,
      before: before,
      after: after,
      proposed_by: proposedBy,
      approved_by: "user",
      proposal_id: proposalId || null,
      undoes: undoes || null,
      undone_by: null
    };
    state.history.push(ev);
    flash.events[ev.id] = true;
    return ev;
  }

  function accept(id, editedText, force) {
    var p = proposal(id);
    if (!p || p.status !== "pending") return null;
    var verdict = p.screening.verdict;
    if (verdict === "blocked" || (verdict === "quarantined" && !force)) return null;
    var at = nowISO();
    var text = editedText != null ? editedText : p.text;
    var sensitive = FW.screen({ op: p.op, kind: p.kind, text: text }, state.entries).reasons
      .some(function (r) { return r.code === "sensitive"; });
    var ev;
    if (p.op === "add") {
      var e = {
        id: nextId("e", state.entries.map(function (x) { return x.id; })),
        kind: p.kind,
        text: text,
        why: p.why,
        scope: (p.scope || ["work"]).slice(),
        sensitivity: sensitive ? "sensitive" : "normal",
        provenance: { basis: p.basis, proposed_by: p.connector, approved_by: "user", proposal_id: p.id, edited_by_user: editedText != null },
        added: at,
        updated: null,
        status: "active"
      };
      state.entries.push(e);
      ev = addEvent("add", e.id, null, clone(e), p.connector, p.id);
    } else {
      var t = entry(p.entry_id);
      if (!t) return null;
      var before = clone(t);
      if (p.op === "update") {
        t.text = text;
        if (p.why) t.why = p.why;
        t.updated = at;
        t.provenance.last_change = { proposed_by: p.connector, approved_by: "user", proposal_id: p.id };
        ev = addEvent("update", t.id, before, clone(t), p.connector, p.id);
      } else {
        t.status = "removed";
        t.updated = at;
        ev = addEvent("remove", t.id, before, null, p.connector, p.id);
      }
    }
    p.status = "accepted";
    p.decided = at;
    p.history_id = ev.id;
    if (editedText != null) p.edited_text = editedText;
    flash.entries[ev.entry_id] = true;
    return ev;
  }

  function reject(id) {
    var p = proposal(id);
    if (!p || p.status !== "pending") return;
    p.status = "rejected";
    p.decided = nowISO();
  }

  function reopen(id) {
    var p = proposal(id);
    if (!p) return;
    p.status = "pending";
    p.decided = null;
    delete p.history_id;
    delete p.edited_text;
  }

  // The newest change to each entry that is still in effect. Only those can be undone,
  // so undo never skips over a later change (like reverting the top commit).
  function undoableIds() {
    var stacks = {};
    state.history.forEach(function (h) {
      var s = stacks[h.entry_id] || (stacks[h.entry_id] = []);
      if (h.action === "undo") {
        var i = s.lastIndexOf(h.undoes);
        if (i !== -1) s.splice(i, 1);
      } else {
        s.push(h.id);
      }
    });
    var tops = {};
    Object.keys(stacks).forEach(function (k) {
      var s = stacks[k];
      if (s.length) tops[s[s.length - 1]] = true;
    });
    return tops;
  }

  function undo(hid) {
    var ev = state.history.filter(function (h) { return h.id === hid; })[0];
    if (!ev || ev.action === "undo" || ev.undone_by || !undoableIds()[hid]) return null;
    var e = entry(ev.entry_id);
    if (!e) return null;
    var before = clone(e);
    var after;
    if (ev.action === "add") {
      e.status = "removed";
      e.updated = nowISO();
      after = null;
    } else {
      var restored = clone(ev.before);
      Object.keys(e).forEach(function (k) { delete e[k]; });
      Object.keys(restored).forEach(function (k) { e[k] = restored[k]; });
      after = clone(e);
    }
    var u = addEvent("undo", ev.entry_id, before, after, "user", null, hid);
    ev.undone_by = u.id;
    flash.entries[ev.entry_id] = true;
    return u;
  }

  function userEdit(id, changes) {
    var e = entry(id);
    if (!e) return null;
    var before = clone(e);
    Object.keys(changes).forEach(function (k) { e[k] = changes[k]; });
    if (JSON.stringify(before) === JSON.stringify(e)) return null;
    e.updated = nowISO();
    flash.entries[id] = true;
    return addEvent("update", id, before, clone(e), "user", null);
  }

  function userAdd(fields) {
    var at = nowISO();
    var e = {
      id: nextId("e", state.entries.map(function (x) { return x.id; })),
      kind: fields.kind,
      text: fields.text,
      why: fields.why || null,
      scope: fields.scope,
      sensitivity: fields.sensitivity,
      provenance: { basis: "stated", proposed_by: "user", approved_by: "user", proposal_id: null, edited_by_user: false },
      added: at,
      updated: null,
      status: "active"
    };
    state.entries.push(e);
    flash.entries[e.id] = true;
    return addEvent("add", e.id, null, clone(e), "user", null);
  }

  function userRemove(id) {
    var e = entry(id);
    if (!e) return null;
    var before = clone(e);
    e.status = "removed";
    e.updated = nowISO();
    return addEvent("remove", id, before, null, "user", null);
  }

  function recordRead(c) {
    var ents = visibleFor(c);
    var r = { at: nowISO(), connector: c.id, scopes: c.scopes.slice(), entry_ids: ents.map(function (e) { return e.id; }), count: ents.length };
    state.reads.push(r);
    flash.reads[c.id + "@" + r.at] = true;
    return r;
  }

  // ---------------------------------------------------------------- toast

  var toastTimer = null;
  function toast(text, actionLabel, action) {
    var el = document.getElementById("toast");
    el.innerHTML = "<span>" + esc(text) + "</span>" + (actionLabel ? '<button type="button">' + icon("undo") + " " + esc(actionLabel) + "</button>" : "");
    el.classList.add("show");
    if (actionLabel) {
      el.querySelector("button").onclick = function () {
        el.classList.remove("show");
        action();
      };
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, actionLabel ? 6000 : 3200);
  }

  // ---------------------------------------------------------------- shared bits

  var flash = { entries: {}, events: {}, reads: {} };

  var KIND_LABEL = { fact: "Fact", preference: "Preference", rule: "Your rule" };
  function kindChip(kind) {
    return '<span class="chip chip-kind' + (kind === "rule" ? " chip-rule" : "") + '">' + (kind === "rule" ? icon("pencil") : "") + esc(KIND_LABEL[kind] || kind) + "</span>";
  }
  function scopeChips(scope) {
    return scope.map(function (s) { return '<span class="chip">' + (s === "work" ? "Work" : "Personal") + "</span>"; }).join("");
  }
  function sourceCell(e) {
    var p = e.provenance || {};
    var by = p.proposed_by || "user";
    var sub = "";
    if (p.last_change && p.last_change.proposed_by !== "user") sub = "Updated via " + name(p.last_change.proposed_by);
    else if (e.updated && by === "user") sub = "Edited " + onDay(e.updated);
    if (by === "user") {
      return '<div class="source"><span class="source-user" aria-hidden="true">' + icon("user") + "</span><span>Stated by you" +
        (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</span></div>";
    }
    if (p.basis === "stated") {
      return '<div class="source">' + mark(by, "sm") + "<span>Stated by you<span class=\"sub\">via " + esc(name(by)) + "</span></span></div>";
    }
    return '<div class="source">' + mark(by, "sm") + "<span>Inferred by " + esc(name(by)) +
      '<span class="sub">' + esc(sub || "Approved by you") + "</span></span></div>";
  }

  // Word-level diff for the proposals and the history (longest common subsequence of tokens).
  // Quotes and punctuation are their own tokens and spaces are kept, so only changed words are marked.
  function tokens(s) {
    // Each word becomes: leading quotes or brackets, the core, trailing punctuation. So "“Best,"
    // gives “ Best , while an address such as moreau.office@mailbox.example stays one token.
    var out = [];
    (s.match(/\s+|\S+/g) || []).forEach(function (w) {
      if (/^\s+$/.test(w)) { out.push(w); return; }
      var m = w.match(/^([“”"'(\[]*)(.*?)([.,:;!?“”"')\]]*)$/);
      m[1].split("").forEach(function (ch) { out.push(ch); });
      if (m[2]) out.push(m[2]);
      m[3].split("").forEach(function (ch) { out.push(ch); });
    });
    return out;
  }
  function diffRegions(oldText, newText) {
    var a = tokens(oldText), b = tokens(newText);
    var n = a.length, m = b.length, i, j;
    var L = [];
    for (i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push(["=", a[i]]); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(["-", a[i]]); i++; }
      else { ops.push(["+", b[j]]); j++; }
    }
    // Group neighbouring changes; a space between two changes belongs to the change.
    var out = [], k = 0;
    while (k < ops.length) {
      if (ops[k][0] === "=") { out.push({ eq: ops[k][1] }); k++; continue; }
      var del = "", ins = "";
      while (k < ops.length) {
        var o = ops[k];
        if (o[0] === "-") { del += o[1]; k++; }
        else if (o[0] === "+") { ins += o[1]; k++; }
        else if (/^\s+$/.test(o[1]) && k + 1 < ops.length && ops[k + 1][0] !== "=") { del += o[1]; ins += o[1]; k++; }
        else break;
      }
      out.push({ del: del, ins: ins });
    }
    return out;
  }
  function diff(oldText, newText) {
    var old = "", neu = "", merged = "";
    diffRegions(oldText, newText).forEach(function (x) {
      if (x.eq !== undefined) { old += esc(x.eq); neu += esc(x.eq); merged += esc(x.eq); return; }
      var hasDel = x.del.trim() !== "", hasIns = x.ins.trim() !== "";
      // Keep surrounding spaces outside the marks.
      function wrap(tag, str) {
        var m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
        return esc(m[1]) + "<" + tag + ">" + esc(m[2]) + "</" + tag + ">" + esc(m[3]);
      }
      var d = hasDel ? wrap("del", x.del) : esc(x.del);
      var n2 = hasIns ? wrap("ins", x.ins) : esc(x.ins);
      old += d;
      neu += n2;
      merged += (hasDel ? d : "") + (hasDel && hasIns ? " " : "") + (hasIns ? n2 : "");
    });
    return { old: old, neu: neu, merged: merged };
  }

  function textWithHidden(text) {
    var h = FW.splitHidden(text);
    if (!h.count) return esc(text);
    return esc(h.visible) + '<span class="hidden-mark" title="Characters you can’t see">' + icon("eyeoff") + h.count + " hidden characters</span>";
  }

  // ---------------------------------------------------------------- 1. Your context

  function viewContext() {
    var ents = sortEntries(activeEntries());
    var f = state.ui.filter;
    var count = {
      all: ents.length,
      work: ents.filter(function (e) { return e.scope.indexOf("work") !== -1; }).length,
      personal: ents.filter(function (e) { return e.scope.indexOf("personal") !== -1; }).length,
      device: ents.filter(function (e) { return e.sensitivity === "sensitive"; }).length
    };
    var shown = ents.filter(function (e) {
      if (f === "all") return true;
      if (f === "device") return e.sensitivity === "sensitive";
      return e.scope.indexOf(f) !== -1;
    });

    var filters = [["all", "All"], ["work", "Work"], ["personal", "Personal"], ["device", "On this device"]].map(function (x) {
      return '<button class="filter" type="button" data-act="filter" data-value="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' +
        esc(x[1]) + " <b>" + count[x[0]] + "</b></button>";
    }).join("");
    var actions = '<div class="filters" role="group" aria-label="Filter entries">' + filters + "</div>" +
      '<button class="btn btn-primary" type="button" data-act="add-entry">' + icon("plus") + "Add entry</button>";

    var rows = shown.map(function (e) {
      var sensitive = e.sensitivity === "sensitive";
      var why = e.why ? "Why: " + FW.stripHidden(e.why) : "";
      return '<div class="entry' + (flash.entries[e.id] ? " flash" : "") + '" data-act="edit-entry" data-id="' + e.id + '" tabindex="0" role="button" aria-label="Edit: ' + esc(FW.stripHidden(e.text)) + '">' +
        "<div>" + kindChip(e.kind) + "</div>" +
        '<div><div class="entry-text">' + textWithHidden(e.text) + "</div>" +
        '<div class="entry-why">' + esc(why) + (why ? '<span class="sep">·</span>' : "") + "Added " + esc(onDay(e.added)) + "</div></div>" +
        sourceCell(e) +
        '<div class="scopes">' + scopeChips(e.scope) + "</div>" +
        '<div class="lock-cell"><button class="lock-btn' + (sensitive ? " on" : "") + '" type="button" data-act="toggle-lock" data-id="' + e.id + '" aria-pressed="' + sensitive + '" title="' + (sensitive ? "Sensitive: stays on this device" : "Keep on this device") + '">' +
        icon(sensitive ? "lock" : "unlock") + (sensitive ? "This device only" : "Keep here") + "</button></div>" +
        "</div>";
    }).join("");
    if (!shown.length) rows = '<div class="empty-note">No entries here.</div>';

    var body =
      '<div class="card entries" role="table" aria-label="Your context entries">' +
      '<div class="entries-head" role="row"><span>Kind</span><span>Entry</span><span>Source</span><span>Scope</span><span style="text-align:right">Where</span></div>' +
      rows + "</div>";
    return { actions: actions, body: body };
  }

  // ---------------------------------------------------------------- 2. Connected assistants

  function viewAssistants() {
    var cs = liveConnectors();
    var today = dayKey(nowISO());
    var cards = cs.map(function (c) {
      var paused = c.status === "paused";
      var off = c.status === "disconnected";
      var local = c.location === "this-device";
      var reads = state.reads.filter(function (r) { return r.connector === c.id; });
      var last = reads[reads.length - 1];
      var props = state.proposals.filter(function (p) { return p.connector === c.id && dayKey(p.received) === today; });
      var flagged = props.filter(function (p) { return p.screening.verdict === "quarantined" || p.screening.verdict === "blocked"; });
      var log = reads.slice(-3).reverse().map(function (r) {
        var isNew = flash.reads[r.connector + "@" + r.at];
        return '<li class="' + (isNew ? "new" : "") + '"><time>' + esc(dayLabel(r.at) === "Today" ? hm(r.at) : dayLabel(r.at)) + "</time><span>" + r.count + " entries · " +
          esc(r.scopes.map(function (s) { return s === "work" ? "Work" : "Personal"; }).join(", ")) + "</span></li>";
      }).join("");

      function sw(act, scope, checked, label, count, hint, disabled) {
        return '<label class="perm"><span><span class="switch-label">' + esc(label) + "</span>" +
          (count != null ? '<span class="count-inline">' + count + " entries</span>" : "") +
          (hint ? '<span class="hint">' + esc(hint) + "</span>" : "") + "</span>" +
          '<span class="switch"><input type="checkbox" data-act="' + act + '" data-id="' + c.id + '"' + (scope ? ' data-scope="' + scope + '"' : "") +
          (checked ? " checked" : "") + (disabled ? " disabled" : "") + ' aria-label="' + esc(c.name + ": " + label) + '"><span class="track"></span></span></label>';
      }
      var sens = local
        ? sw("sensitive", null, c.may_read_sensitive, "Sensitive", null, "Allowed: it runs on this laptop", false)
        : sw("sensitive", null, false, "Sensitive", null, "Never shared: stays on this device", true);

      return '<article class="card assistant' + (paused || off ? " paused" : "") + '">' +
        '<div class="assistant-head">' + mark(c.id, "lg") +
        '<div><div class="name-row"><h2>' + esc(c.name) + "</h2>" +
        '<span class="chip ' + (off ? "" : paused ? "chip-warn" : "chip-ok") + '">' + (off ? "Disconnected" : paused ? "Paused" : "Connected") + "</span></div>" +
        "<p>" + icon(local ? "laptop" : "cloud") + " " + esc(c.description) + (local ? "" : " · cloud") + "</p></div></div>" +
        '<div class="assistant-body">' +
        '<div><p class="section-label">May read</p><div class="perm-list">' +
        sw("scope", "work", c.scopes.indexOf("work") !== -1, "Work", inScope("work", canReadSensitive(c))) +
        sw("scope", "personal", c.scopes.indexOf("personal") !== -1, "Personal", inScope("personal", canReadSensitive(c))) +
        sens + "</div></div>" +
        '<div><p class="section-label">May propose</p><div class="perm-list">' +
        sw("propose", null, c.may_propose, "Propose changes", null, "You approve each one") + "</div></div>" +
        '<dl class="stats"><dt>Last read</dt><dd>' + esc(last ? when(last.at) : "never") + "</dd>" +
        "<dt>Today</dt><dd>" + props.length + " proposal" + (props.length === 1 ? "" : "s") +
        (flagged.length ? '<span class="chip chip-warn">' + icon("alert") + flagged.length + " flagged</span>" : "") + "</dd></dl>" +
        '<div><p class="section-label">Read log</p><ul class="log">' + (log || '<li><time></time><span>No reads yet</span></li>') + "</ul></div>" +
        "</div>" +
        '<div class="assistant-actions">' + (off
          ? '<button class="btn btn-sm" type="button" data-act="reconnect" data-id="' + c.id + '">' + icon("play") + "Reconnect</button>"
          : '<button class="btn btn-sm" type="button" data-act="pause" data-id="' + c.id + '">' + icon(paused ? "play" : "pause") + (paused ? "Resume" : "Pause") + "</button>" +
            '<button class="btn btn-sm btn-quiet" type="button" data-act="disconnect" data-id="' + c.id + '">Disconnect</button>') +
        "</div></article>";
    }).join("");
    var actions = '<button class="btn" type="button" data-act="go" data-screen="4">' + icon("plus") + "Connect an assistant</button>";
    return { actions: actions, body: '<div class="assistants" style="--cols:' + Math.max(cs.length, 3) + '">' + cards + "</div>" };
  }

  // ---------------------------------------------------------------- 3. Proposals

  var VERDICT_UI = {
    clean: { chip: "chip-ok", label: "Routine", title: "Routine", icon: "check" },
    review: { chip: "chip-info", label: "Needs your yes", title: "Needs your yes", icon: "info" },
    quarantined: { chip: "chip-warn", label: "Held back", title: "Held back", icon: "alert" },
    blocked: { chip: "chip-bad", label: "Blocked", title: "Blocked", icon: "block" }
  };

  function statusChip(p) {
    var held = p.screening.verdict === "quarantined";
    if (p.status === "accepted") return '<span class="chip chip-ok">' + icon("check") + (held ? "Released" : "Accepted") + "</span>";
    if (p.status === "rejected") return '<span class="chip">' + (held ? "Kept out" : "Rejected") + "</span>";
    var v = VERDICT_UI[p.screening.verdict];
    return '<span class="chip ' + v.chip + '">' + icon(v.icon) + esc(v.label) + "</span>";
  }

  function viewProposals() {
    var list = state.ui.tab === "inbox" ? inbox() : handled();
    var sel = proposal(state.ui.selected);
    if (!sel || list.indexOf(sel) === -1) {
      sel = list[0] || null;
      state.ui.selected = sel ? sel.id : null;
    }
    var nIn = inbox().length, nDone = handled().length;
    var tabs = '<div class="list-tabs" role="group" aria-label="Which proposals">' +
      '<button class="filter" type="button" data-act="tab" data-value="inbox" aria-pressed="' + (state.ui.tab === "inbox") + '">Inbox <b>' + nIn + "</b></button>" +
      '<button class="filter" type="button" data-act="tab" data-value="handled" aria-pressed="' + (state.ui.tab === "handled") + '">Handled <b>' + nDone + "</b></button></div>";
    var items = list.map(function (p) {
      return '<button class="prop-item" type="button" data-act="select" data-id="' + p.id + '" aria-current="' + (sel && sel.id === p.id) + '">' +
        mark(p.connector, "sm") +
        '<span class="prop-top"><strong>' + esc(name(p.connector)) + '</strong><span class="t">' + esc(state.ui.tab === "inbox" ? hm(p.received) : when(p.received)) + "</span>" + statusChip(p) + "</span>" +
        '<span class="prop-text">' + (p.op === "update" ? "Change: " : p.op === "remove" ? "Remove: " : "") + esc(FW.stripHidden(p.text)) + "</span></button>";
    }).join("");
    if (!list.length) {
      items = '<div class="empty-note">' + (state.ui.tab === "inbox" ? "Nothing is waiting for you." : "Nothing handled yet.") + "</div>";
    }
    var left = '<div class="card inbox-list">' + tabs + items + "</div>";
    var right = sel ? detail(sel) : allDone();
    var note = '<span class="chip">' + icon("info") + "You decide here, in the store, outside the chat</span>";
    return { actions: note, body: '<div class="inbox">' + left + right + "</div>" };
  }

  function allDone() {
    var today = dayKey(nowISO());
    var mine = state.proposals.filter(function (p) { return dayKey(p.received) === today; });
    var n = function (f) { return mine.filter(f).length; };
    var acc = n(function (p) { return p.status === "accepted"; });
    var rej = n(function (p) { return p.status === "rejected"; });
    var blk = n(function (p) { return p.status === "blocked"; });
    return '<div class="card detail done-card"><span class="big-check">' + icon("check") + "</span>" +
      "<h2>Nothing is waiting for you</h2>" +
      '<p class="lead">Today: ' + acc + " accepted, " + rej + " rejected or kept out, " + blk + " blocked. Nothing entered your context without your yes.</p>" +
      '<div class="sheet-actions"><button class="btn" type="button" data-act="go" data-screen="5">' + icon("clock") + "See the history</button>" +
      '<button class="btn btn-primary" type="button" data-act="go" data-screen="3">Same you, different assistant ' + icon("arrow") + "</button></div></div>";
  }

  // The fixed rule checks (R1-R9 of the defence design), in plain words. Failed checks use short
  // labels; the full reasons are in the verdict box and in the decoded text above.
  function checksList(screening) {
    var codes = {};
    screening.reasons.forEach(function (r) { codes[r.code] = r.label; });
    function tail(label) { var i = label ? label.indexOf(": ") : -1; return i === -1 ? "" : label.slice(i + 2); }
    var hiddenCount = codes.hidden ? (codes.hidden.match(/\d+/) || [""])[0] : "";
    var rows = [
      { ok: !codes.rule_kind && !codes.edits_rule, pass: "Not a rule", fail: codes.rule_kind ? "It is a rule" : "Changes your rule", sev: "bad" },
      { ok: !codes.instruction, pass: "No instruction wording found", fail: "Instructions: " + tail(codes.instruction), sev: "bad" },
      { ok: !codes.hidden, pass: "No hidden characters found", fail: hiddenCount + " hidden characters", sev: "bad" },
      { ok: !codes.secret, pass: "No passwords or keys found", fail: "A password or key", sev: "bad" },
      { ok: !codes.plant && !codes.recommend, pass: "No planting or recommending found",
        fail: [tail(codes.plant), tail(codes.recommend)].filter(Boolean).join(", "), sev: "warn", prefix: "Planting or recommending: " },
      { ok: !codes.link && !codes.email && !codes.contact, pass: "No links or contact details found",
        fail: [tail(codes.link), tail(codes.email), tail(codes.contact)].filter(Boolean).join(", "), sev: "warn", prefix: "Link or contact: " },
      { ok: !codes.sensitive, pass: "Nothing sensitive found", fail: "Sensitive: stays on this device", sev: "warn" },
      { ok: !codes.change && !codes.remove, pass: "A new entry, not a change", fail: codes.change ? "Changes an existing entry" : "Removes an entry", sev: "info" }
    ];
    if (codes.long) rows.push({ ok: false, fail: "Over 280 characters", sev: "info" });
    var ICON = { bad: "block", warn: "alert", info: "info" };
    return '<div><p class="section-label">Fixed rule checks <span class="label-note">· fixed rules can miss things</span></p><ul class="checks">' + rows.map(function (r) {
      if (r.ok) return '<li class="pass">' + icon("check") + "<span>" + esc(r.pass) + "</span></li>";
      return '<li class="fail ' + r.sev + '">' + icon(ICON[r.sev]) + "<span>" + esc((r.prefix || "") + r.fail) + "</span></li>";
    }).join("") + "</ul></div>";
  }

  function rescreen(p, text) {
    return FW.screen({ op: p.op, kind: p.kind, text: text, entry_id: p.entry_id,
      app_reported: p.app_reported, app_detail: p.app_detail }, state.entries);
  }

  function detail(p) {
    var editing = state.ui.editing === p.id && p.status === "pending";
    var draft = editing ? state.ui.draft : null;
    var screening = editing ? rescreen(p, draft) : p.screening;
    var verdict = screening.verdict;
    var v = VERDICT_UI[verdict];
    var kindWord = p.kind === "rule" ? "a rule" : "a " + p.kind;
    var verb = p.op === "add" ? "add " + kindWord : p.op === "update" ? "change " + kindWord : "remove " + kindWord;
    var c = connector(p.connector);

    var diffHtml;
    if (editing) {
      diffHtml = '<div class="edit-box"><label for="draft">Your wording. The checks below run again as you type.</label>' +
        '<input class="text-input" id="draft" data-focus="draft" data-input="draft" value="' + esc(draft) + '" autocomplete="off"></div>';
    } else if (p.op === "add") {
      var h = FW.splitHidden(p.text);
      var flagCls = p.screening.verdict === "blocked" ? "flag-bad" : p.screening.verdict === "quarantined" ? "flag-warn" : "add";
      var sideLabel = flagCls === "add" ? "+ New" : "Proposed";
      diffHtml = '<div class="diff"><div class="diff-row ' + flagCls + '"><span class="side">' + sideLabel + "</span><div>" + textWithHidden(p.edited_text || p.text) +
        (h.decoded ? '<div class="revealed">' + icon("eyeoff") + " Decoded by the store: <code>" + esc(h.decoded) + "</code></div>" : "") + "</div></div></div>";
    } else {
      var target = entry(p.entry_id);
      var before = p.status === "accepted" && state.history.filter(function (x) { return x.id === p.history_id; })[0];
      var oldText = before && before.before ? before.before.text : target ? target.text : "";
      var d = diff(FW.stripHidden(oldText), FW.stripHidden(p.edited_text || p.text));
      diffHtml = '<div class="diff">' +
        '<div class="diff-row old"><span class="side">Before</span><div>' + d.old + "</div></div>" +
        '<div class="diff-row add"><span class="side">After</span><div>' + d.neu + "</div></div></div>";
    }

    // What the store knows (bound to the connection), apart from what the assistant claims.
    var rep = p.app_reported || "not_reported";
    var reportHtml = rep === "outside_content"
      ? '<span class="warn-text">Outside content in this chat' + (p.app_detail ? ": " + esc(p.app_detail) : "") + "</span>"
      : rep === "none" ? "Nothing from outside"
      : '<span class="warn-text">Nothing.</span> Not reporting counts as untrusted.';
    var facts = '<div class="store-facts"><p class="section-label">What the store knows</p><dl class="facts">' +
      "<dt>From</dt><dd>" + esc(name(p.connector)) + "’s own connection" +
      (c && c.connected ? ", since " + esc(dayLabel(c.connected)) : "") + "</dd>" +
      "<dt>Its app reported</dt><dd>" + reportHtml + "</dd></dl>" +
      '<p class="cant-see">The store can’t see what the assistant read, or whether the text is true.</p></div>' +
      '<div class="claim"><p class="section-label">Its explanation, not checked</p>' +
      "<p>“" + esc(FW.stripHidden(p.why || "None given")) + "”</p><p class=\"basis\">" +
      (p.basis === "stated" ? "It says you said this yourself." : "It says it inferred this.") + "</p></div>";

    var verdictBox = '<div class="verdict ' + verdict + '">' + icon(v.icon) + "<div><h3>" + esc(v.title) + "</h3><p>" +
      esc(verdictText(verdict, screening, p.app_detail)) + "</p></div></div>";

    var codes = {};
    screening.reasons.forEach(function (r) { codes[r.code] = true; });
    var actions;
    if (p.status === "accepted") {
      actions = '<div class="actions"><span class="decided">' + icon("check") + (p.screening.verdict === "quarantined" ? "Released by you, despite the warnings, " : "Accepted by you, ") + esc(when(p.decided).toLowerCase()) + ".</span></div>";
    } else if (p.status === "rejected") {
      actions = '<div class="actions"><span class="decided">' + (p.screening.verdict === "quarantined" ? "Kept out" : "Rejected") + " by you, " + esc(when(p.decided).toLowerCase()) + ". Nothing changed.</span></div>";
    } else if (p.status === "blocked") {
      actions = '<div class="actions">' + (p.dismissed ? '<span class="decided">Removed from the inbox. The attempt stays in the record.</span>' :
        '<button class="btn btn-lg" type="button" data-act="dismiss" data-id="' + p.id + '">Remove from inbox</button>' +
        (offersRule(codes) ? '<button class="btn btn-lg btn-quiet" type="button" data-act="write-rule" data-id="' + p.id + '">' + icon("pencil") + "Write a rule yourself</button>" : "")) + "</div>";
    } else if (editing) {
      var label = verdict === "quarantined" ? "Release your wording" : "Accept your wording";
      actions = '<div class="actions">' +
        '<button class="btn ' + (verdict === "quarantined" ? "btn-danger" : "btn-primary") + '" type="button" data-act="accept-edited" data-id="' + p.id + '"' + (verdict === "blocked" || !draft.trim() ? " disabled" : "") + ">" + icon("check") + esc(label) + "</button>" +
        '<button class="btn" type="button" data-act="cancel-edit">Cancel</button></div>';
    } else if (verdict === "quarantined") {
      actions = '<div class="actions">' +
        '<button class="btn btn-solid-danger btn-lg" type="button" data-act="reject" data-id="' + p.id + '">' + icon("x") + "Keep it out</button>" +
        '<button class="btn btn-lg" type="button" data-act="edit-proposal" data-id="' + p.id + '">' + icon("pencil") + "Edit</button>" +
        '<span class="spacer"></span>' +
        '<button class="btn btn-quiet" type="button" data-act="accept-anyway" data-id="' + p.id + '">Release anyway…</button></div>';
    } else {
      actions = '<div class="actions">' +
        '<button class="btn btn-primary btn-lg" type="button" data-act="accept" data-id="' + p.id + '">' + icon("check") + (verdict === "review" ? "Yes, accept" : "Accept") + "</button>" +
        '<button class="btn btn-lg" type="button" data-act="edit-proposal" data-id="' + p.id + '">' + icon("pencil") + "Edit</button>" +
        '<button class="btn btn-lg" type="button" data-act="reject" data-id="' + p.id + '">' + icon("x") + "Reject</button></div>";
    }

    return '<article class="card detail" aria-label="Proposal from ' + esc(name(p.connector)) + '">' +
      '<div class="detail-head">' + mark(p.connector, "lg") +
      "<div><h2>" + esc(name(p.connector)) + " proposes to " + esc(verb) + "</h2><p>" + esc(when(p.received)) + " · " + esc((c || {}).description || "") + "</p></div>" +
      statusChip(p) + "</div>" +
      diffHtml + '<div class="detail-grid">' + facts + "</div>" + verdictBox + checksList(screening) + actions + "</article>";
  }

  function verdictText(verdict, screening, appDetail) {
    var s = FW.summary(screening, appDetail);
    var codes = {};
    screening.reasons.forEach(function (r) { codes[r.code] = true; });
    if (verdict === "clean") return "No rule hits, and its app reported nothing from outside. Harmless even if false: in daily use it would wait in your weekly list.";
    if (verdict === "review") return s + " It waits for your yes.";
    if (verdict === "quarantined") return s + " It stays out of your context unless you release it.";
    return s + (offersRule(codes) ? " Assistants can never add rules. You can write one yourself." : " The store won’t accept it.");
  }

  function offersRule(codes) {
    return !!(codes.rule_kind || (codes.instruction && !codes.hidden && !codes.secret));
  }

  // ---------------------------------------------------------------- 4. Same you, different assistant

  var memo = {};          // last answer shown per assistant: { sig, lines }
  var typingUntil = {};   // assistant id -> timestamp while "typing"
  var changedLines = {};  // assistant id -> { index: true } for the highlight
  var readOnEnter = false;
  var PANES = ["assistant-a", "assistant-b"];

  var CTX_ORDER = ["british", "short", "supervisor", "deadline", "topic", "signoff"];

  // "Sign emails with “Best, Sofie”." -> "Best, Sofie". Also works without quotes, or as "Sign-off: ...".
  function parseSignoff(text) {
    var m = text.match(/^signs?\b.*?\bwith\s+(.+?)\s*\.?$/i) || text.match(/^sign-?off:\s*(.+?)\s*\.?$/i);
    if (!m) return null;
    var v = m[1].replace(/^[\u201c\u201d"'\u2018\u2019]+|[\u201c\u201d"'\u2018\u2019]+$/g, "").trim();
    return v || null;
  }
  function signoffEntry() {
    return activeEntries().filter(function (x) { return parseSignoff(FW.stripHidden(x.text)) !== null; })[0] || null;
  }
  function contextFor(c) {
    if (!state.ui.useContext || !c || c.status !== "active") return null;
    var ctx = { british: false, short: false, supervisor: null, deadline: null, topic: null, signoff: null, used: {} };
    visibleFor(c).forEach(function (e) {
      var t = FW.stripHidden(e.text);
      var m;
      if (/british english/i.test(t)) { ctx.british = true; ctx.used.british = { id: e.id, label: "British English" }; }
      else if (e.kind === "preference" && /\bshort\b/i.test(t)) { ctx.short = true; ctx.used.short = { id: e.id, label: "Short answers" }; }
      else if ((m = t.match(/supervisor:\s*(.+?)\.?$/i))) {
        var em = m[1].match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        ctx.supervisor = m[1].replace(/\s*\(.*\)\s*$/, "").trim();
        ctx.supervisorEmail = em ? em[0] : null;
        ctx.used.supervisor = { id: e.id, label: "Supervisor: " + ctx.supervisor + (em ? " (+ address)" : "") };
      }
      else if ((m = t.match(/milestone:.*?\bby\s+(.+?)\.?$/i))) { ctx.deadline = m[1]; ctx.used.deadline = { id: e.id, label: "Deadline: " + m[1] }; }
      else if ((m = t.match(/thesis on\s+(.+?)\.?$/i))) { ctx.topic = m[1]; ctx.used.topic = { id: e.id, label: "Thesis: " + m[1] }; }
      else if (parseSignoff(t)) { ctx.signoff = parseSignoff(t); ctx.used.signoff = { id: e.id, label: "Sign-off: " + ctx.signoff }; }
    });
    return Object.keys(ctx.used).length ? ctx : null;
  }

  function answerLines(ans) {
    var lines = [{ cls: "to", parts: [{ t: "To: " }, ans.to] }, { cls: "subject", parts: [{ t: "Subject: " + ans.subject }] }];
    ans.paras.forEach(function (p) { lines.push({ cls: "p", parts: p }); });
    lines.push({ cls: "sign", parts: ans.sign, sign: true });
    return lines;
  }
  function lineText(line) { return line.parts.map(function (x) { return x.t; }).join(line.sign ? "\n" : ""); }

  function computePane(cid) {
    var c = connector(cid);
    var ctx = contextFor(c);
    var ans = STORY.answer(cid, ctx);
    var lines = answerLines(ans);
    return { c: c, ctx: ctx, ans: ans, lines: lines, sig: JSON.stringify([ans.intro, lines.map(lineText)]) };
  }

  function refreshPanes(entering) {
    var now = Date.now();
    var delay = SHOT ? 0 : 1;
    PANES.forEach(function (cid, i) {
      var pane = computePane(cid);
      var prev = memo[cid];
      if (entering || !prev) {
        if (delay) typingUntil[cid] = now + 650 + i * 300;
        changedLines[cid] = {};
      } else if (prev.sig !== pane.sig) {
        if (delay) typingUntil[cid] = now + 600 + i * 300;
        var hl = {};
        pane.lines.forEach(function (l, k) { if (!prev.lines[k] || prev.lines[k] !== lineText(l)) hl[k] = true; });
        changedLines[cid] = hl;
        if (pane.c && pane.ctx) recordRead(pane.c);
      }
      memo[cid] = { sig: pane.sig, lines: pane.lines.map(lineText) };
    });
    if (entering) {
      PANES.forEach(function (cid) { var c = connector(cid); if (c && contextFor(c)) recordRead(c); });
    }
    scheduleTypingEnd();
  }

  var typingTimer = null;
  function scheduleTypingEnd() {
    clearTimeout(typingTimer);
    var next = Math.min.apply(null, PANES.map(function (cid) { return typingUntil[cid] || Infinity; }));
    if (next === Infinity) return;
    typingTimer = setTimeout(function () {
      var now = Date.now();
      PANES.forEach(function (cid) { if (typingUntil[cid] && typingUntil[cid] <= now + 5) delete typingUntil[cid]; });
      if (STORY.screens[state.ui.screen].id === "same-you") renderPanesOnly();
      scheduleTypingEnd();
    }, Math.max(0, next - Date.now()));
  }

  function partHtml(x) {
    if (x.ph) return '<span class="placeholder">' + esc(x.t) + "</span>";
    return esc(x.t);
  }
  function paneHtml(cid) {
    var pane = computePane(cid);
    var c = pane.c;
    var typing = typingUntil[cid] && typingUntil[cid] > Date.now();
    var hl = changedLines[cid] || {};
    var connected = c && c.status === "active";
    var stateChip = !c || c.status === "disconnected"
      ? '<span class="chip chip-warn">Not connected</span>'
      : c.status !== "active" ? '<span class="chip chip-warn">Paused</span>'
      : !state.ui.useContext ? '<span class="chip">Context off</span>'
      : pane.ctx ? '<span class="chip chip-ok">' + icon("check") + "Reads your context</span>"
      : '<span class="chip chip-warn">Nothing to read</span>';
    var body;
    if (typing) {
      body = '<div class="msg-bot">' + mark(cid, "sm") + '<div><span class="typing" aria-label="Writing"><i></i><i></i><i></i></span></div></div>';
    } else {
      var email = pane.lines.map(function (l, k) {
        var inner = l.sign ? l.parts.map(partHtml).join("<br>") : l.parts.map(partHtml).join("");
        if (l.cls === "subject" || l.cls === "to") return '<div class="' + l.cls + (hl[k] ? " changed" : "") + '">' + inner + "</div>";
        return '<p class="' + (hl[k] ? "changed" : "") + '">' + inner + "</p>";
      }).join("");
      body = '<div class="msg-bot">' + mark(cid, "sm") + '<div style="flex:1;min-width:0"><p class="bot-text">' + esc(pane.ans.intro) + '</p><div class="email">' + email + "</div></div></div>";
    }
    var used = pane.ctx ? CTX_ORDER.filter(function (k) { return pane.ctx.used[k]; }) : [];
    var foot = pane.ctx
      ? icon("check") + "Used " + used.length + " entries from your context, read " + esc(hm(nowISO()))
      : icon("info") + (connected ? (state.ui.useContext ? "It may not read the entries this answer needs." : "Not using your context.") : "Not connected to your context.");
    return {
      chip: stateChip,
      inner: '<div class="pane-body" aria-live="polite">' +
        '<div class="msg-user">' + esc(STORY.request) + "</div>" + body + "</div>" +
        '<div class="pane-foot' + (pane.ctx ? "" : " off") + '">' + foot + "</div>"
    };
  }

  function viewSameYou() {
    var union = {};
    var readers = [];
    PANES.forEach(function (cid) {
      var ctx = contextFor(connector(cid));
      if (ctx) {
        readers.push(name(cid));
        Object.keys(ctx.used).forEach(function (k) { union[k] = union[k] || ctx.used[k]; });
      }
    });
    var readLabel = readers.length === 2 ? "Both read from your context:" : readers.length === 1 ? readers[0] + " reads from your context:" : "";
    var chips = CTX_ORDER.filter(function (k) { return union[k]; }).map(function (k) {
      var u = union[k];
      if (k === "signoff") {
        if (state.ui.editingSignoff) {
          return '<span class="ctx-chip editing"><span class="k">Sign-off:</span><input data-input="signoff" data-focus="signoff" value="' + esc(state.ui.signoffDraft) + '" aria-label="Sign-off" autocomplete="off"></span>' +
            '<button class="btn btn-sm btn-primary" type="button" data-act="save-signoff">Save</button>' +
            '<button class="btn btn-sm btn-quiet" type="button" data-act="cancel-signoff">Cancel</button>';
        }
        return '<button class="ctx-chip editable" type="button" data-act="edit-signoff" title="Edit this entry">' + '<span class="k">Sign-off:</span> ' + esc(u.label.replace(/^Sign-off:\s*/, "")) + " " + icon("pencil") + "</button>";
      }
      var parts2 = u.label.split(": ");
      return '<span class="ctx-chip">' + (parts2.length > 1 ? '<span class="k">' + esc(parts2[0]) + ":</span> " + esc(parts2.slice(1).join(": ")) : esc(u.label)) + "</span>";
    }).join("");
    if (!chips) chips = '<span class="ctx-chip">Neither assistant reads your context now.</span>';

    var top = '<div class="ask-row"><div class="ask"><span class="label">You ask both:</span><span class="bubble">' + esc(STORY.request) + "</span></div>" +
      '<label class="switch"><span>Use my context</span><input type="checkbox" data-act="use-context"' + (state.ui.useContext ? " checked" : "") + '><span class="track"></span></label></div>' +
      '<div class="used">' + (readLabel ? '<span class="label">' + esc(readLabel) + "</span>" : "") + chips + "</div>";

    var panes = PANES.map(function (cid) {
      var c = connector(cid);
      var ph = paneHtml(cid);
      return '<section class="card pane pane-' + (cid === "assistant-a" ? "a" : "b") + '" data-pane="' + cid + '">' +
        '<div class="pane-head">' + mark(cid) + "<div><h2>" + esc(c ? c.name : cid) + "</h2><p>" + esc(c ? c.description + " · " + (cid === "assistant-a" ? "company one" : "company two") : "") + "</p></div>" +
        '<span class="pane-chip">' + ph.chip + "</span></div>" +
        '<div class="pane-inner">' + ph.inner + "</div></section>";
    }).join("");
    return { actions: "", body: top + '<div class="panes">' + panes + "</div>" };
  }

  function renderPanesOnly() {
    PANES.forEach(function (cid) {
      var el = document.querySelector('[data-pane="' + cid + '"]');
      if (!el) return;
      var ph = paneHtml(cid);
      el.querySelector(".pane-inner").innerHTML = ph.inner;
      el.querySelector(".pane-chip").innerHTML = ph.chip;
    });
  }

  function saveSignoff() {
    var value = (state.ui.signoffDraft || "").replace(/[\u201c\u201d"]/g, "").trim();
    state.ui.editingSignoff = false;
    if (!value) { render(); return; }
    var e = signoffEntry();
    if (!e) { render(); toast("There is no sign-off entry. Add one on Your context."); return; }
    var ev = userEdit(e.id, { text: "Sign emails with “" + value + "”." });
    save();
    refreshPanes(false);
    render();
    if (ev) toast("Sign-off changed. Both assistants use it now.", "Undo", function () { undo(ev.id); save(); refreshPanes(false); render(); });
  }

  // ---------------------------------------------------------------- 5. Connect

  function viewConnect() {
    var st = state.ui.connect;
    var d = connector("assistant-d");
    var work = inScope("work", false), personal = inScope("personal", false);
    var sensitive = activeEntries().filter(function (e) { return e.sensitivity === "sensitive"; }).length;
    var steps = [
      ["Open a new assistant", "If it supports the open context format, it offers “Use my context”."],
      ["Sign in once", "With your digital wallet or your context provider. You don’t need a server of your own."],
      ["Choose what it may read", "Work, personal, or both. You can change it or disconnect any time."]
    ];
    var how = '<ol class="how">' + steps.map(function (s, i) {
      var cls = i < st.step ? "done" : i === st.step ? "now" : "";
      return '<li class="' + cls + '"><span class="n">' + (i < st.step ? icon("check") : i + 1) + "</span><div><h3>" + esc(s[0]) + "</h3><p>" + esc(s[1]) + "</p></div></li>";
    }).join("") + "</ol>" +
      '<p class="how-note">In this design your context stays where it is. The assistant gets its own key, limited to what you allowed, and you can withdraw it on Connected assistants.</p>';

    var sheet;
    if (st.step === 0) {
      sheet = '<div class="sheet"><div class="pair">' + mark("assistant-d", "lg") + '<span class="link-line"></span><span class="mark mark-lg mark-user">S</span></div>' +
        "<h2>Let Assistant D use your context?</h2>" +
        '<p class="lead">It can then write in your style and knows your projects, without you explaining it all again.</p>' +
        '<div class="sheet-actions"><button class="btn" type="button" data-act="connect-deny">Not now</button>' +
        '<button class="btn btn-primary btn-lg" type="button" data-act="connect-next">Use my context</button></div></div>';
    } else if (st.step === 1) {
      sheet = '<div class="sheet"><h2>Sign in to your context</h2>' +
        '<p class="lead">Assistant D never sees this step. It only receives a key for what you allow next.</p>' +
        '<button class="btn btn-lg wallet-btn" type="button" data-act="connect-next">' + icon("wallet") + "Sign in with your digital wallet</button>" +
        '<button class="btn btn-lg wallet-btn" type="button" data-act="connect-next">' + icon("user") + "Sign in with your context provider</button>" +
        '<p class="fine">A mock-up. No real wallet or account is used.</p></div>';
    } else if (st.step === 2) {
      function row(key, label, hint, checked, disabled) {
        return '<li><span>' + esc(label) + '<span class="hint">' + esc(hint) + "</span></span>" +
          '<span class="switch"><input type="checkbox" data-act="consent" data-key="' + key + '"' + (checked ? " checked" : "") + (disabled ? " disabled" : "") +
          ' aria-label="' + esc(label) + '"><span class="track"></span></span></li>';
      }
      sheet = '<div class="sheet"><div class="sheet-who">' + mark("assistant-d", "sm") + "<strong>Assistant D</strong> · Research assistant · cloud</div>" +
        "<h2>It wants to read your context</h2>" +
        '<ul class="consent">' +
        row("work", "Work", work + " entries: your studies, thesis and writing style", st.work) +
        row("personal", "Personal", personal + " entries: style and everyday preferences", st.personal) +
        row("sensitive", "Sensitive", sensitive + " entry stays on this device. Never shared with cloud assistants.", false, true) +
        row("propose", "Propose changes", "You approve each change", st.propose) +
        "</ul>" +
        '<ul class="cant"><li>' + icon("block") + "It can’t change anything without your approval.</li>" +
        "<li>" + icon("block") + "It can’t read entries you didn’t allow.</li>" +
        "<li>" + icon("clock") + "The store logs every read for you to see.</li></ul>" +
        '<div class="sheet-actions"><button class="btn btn-lg" type="button" data-act="connect-deny">Deny</button>' +
        '<button class="btn btn-primary btn-lg" type="button" data-act="connect-allow"' + (st.work || st.personal ? "" : " disabled") + ">Allow</button></div></div>";
    } else {
      var dReads = state.reads.filter(function (r) { return r.connector === "assistant-d"; });
      var count = dReads.length ? dReads[dReads.length - 1].count : 0;
      sheet = '<div class="sheet success"><span class="big-check">' + icon("check") + "</span>" +
        "<h2>Connected</h2>" +
        '<p class="lead">Assistant D read ' + count + " entries just now. It answers in your style from the first message.</p>" +
        '<div class="sheet-actions"><button class="btn" type="button" data-act="connect-again">Start over</button>' +
        '<button class="btn btn-primary" type="button" data-act="go" data-screen="1">See it in Connected assistants ' + icon("arrow") + "</button></div></div>";
    }
    var win = '<div class="card window" aria-label="Mock-up of a new assistant"><div class="window-bar"><span class="dots"><i></i><i></i><i></i></span>' +
      "<strong>Assistant D</strong><span class=\"meta\">a new assistant, mock-up</span></div>" + sheet + "</div>";
    return { actions: "", body: '<div class="connect"><div>' + how + "</div>" + win + "</div>" };
  }

  // ---------------------------------------------------------------- 6. History

  function viewHistory() {
    var tops = undoableIds();
    var evs = state.history.slice().sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : -1); });
    var html = "";
    var lastDay = null;
    evs.forEach(function (h) {
      var day = dayLabel(h.at, true);
      if (day !== lastDay) { html += '<div class="day">' + esc(day) + "</div>"; lastDay = day; }
      var snap = h.after || h.before || {};
      var kind = (snap.kind || "entry");
      var title, text;
      if (h.action === "undo") {
        var orig = state.history.filter(function (x) { return x.id === h.undoes; })[0];
        title = "You undid a change";
        text = orig && orig.action === "add" ? "Removed again: " + esc(FW.stripHidden((orig.after || {}).text || ""))
          : "Back to: " + esc(FW.stripHidden(snap.text || ""));
      } else if (h.action === "update" && h.before && h.after) {
        title = (h.proposed_by === "user" ? "You changed " : "Changed ") + (kind === "rule" ? "your rule" : "a " + kind);
        var d = diff(FW.stripHidden(h.before.text), FW.stripHidden(h.after.text));
        text = h.before.text === h.after.text ? esc(FW.stripHidden(h.after.text)) + sensitivityNote(h) : d.merged;
      } else if (h.action === "remove") {
        title = (h.proposed_by === "user" ? "You removed " : "Removed ") + "a " + kind;
        text = esc(FW.stripHidden(snap.text || ""));
      } else {
        title = (h.proposed_by === "user" ? "You added " : "Added ") + (kind === "rule" ? "your rule" : "a " + kind);
        text = esc(FW.stripHidden(snap.text || ""));
      }
      var who = h.action === "undo" ? "By you"
        : h.proposed_by === "user" ? "By you"
        : "Proposed by " + name(h.proposed_by) + " · Approved by you";
      var canUndo = h.action !== "undo" && !h.undone_by && tops[h.id];
      var action = canUndo
        ? '<button class="btn btn-sm" type="button" data-act="undo" data-id="' + h.id + '">' + icon("undo") + "Undo</button>"
        : h.undone_by ? '<span class="chip chip-warn">Undone</span>'
        : h.action !== "undo" ? '<span class="later-note">Undo the newer change first</span>' : "";
      html += '<div class="event' + (h.proposed_by !== "user" && h.action !== "undo" ? " via" : "") + (h.action === "undo" ? " undo" : "") + (h.undone_by ? " is-undone" : "") + (flash.events[h.id] ? " new" : "") + '">' +
        "<time>" + esc(hm(h.at)) + "</time>" +
        '<div class="rail"><span class="dot"></span></div>' +
        '<div class="event-body"><div class="event-title">' + esc(title) + "</div>" +
        '<div class="event-text">' + text + "</div>" +
        '<div class="event-meta">' + (h.proposed_by !== "user" && h.action !== "undo" ? mark(h.proposed_by, "sm") : "") + esc(who) + "</div></div>" +
        '<div class="event-action">' + action + "</div></div>";
    });
    var today = dayKey(nowISO());
    var perAssistant = liveConnectors().map(function (c) {
      var n = countConnectorChanges(c.id, today);
      return n ? '<button class="btn btn-sm" type="button" data-act="undo-assistant" data-id="' + c.id + '">' + mark(c.id, "sm") +
        "Undo " + esc(c.name) + "’s changes today (" + n + ")</button>" : "";
    }).join("");
    var since = '<span class="chip">' + icon("clock") + "Since you set up your context on 2 September</span>";
    return { actions: (perAssistant || since), body: '<div class="card timeline">' + html + "</div>" };
  }

  // Changes a connector proposed on a day that are still in effect.
  function countConnectorChanges(cid, day) {
    return state.history.filter(function (h) {
      return h.proposed_by === cid && h.action !== "undo" && !h.undone_by && (!day || dayKey(h.at) === day);
    }).length;
  }

  // Undo everything one assistant proposed (on a day), newest first. Possible because every
  // change records which assistant's connection it came through.
  function undoConnector(cid, day) {
    var done = 0;
    for (;;) {
      var tops = undoableIds();
      var next = state.history.slice().reverse().filter(function (h) {
        return h.proposed_by === cid && h.action !== "undo" && !h.undone_by && tops[h.id] && (!day || dayKey(h.at) === day);
      })[0];
      if (!next) return done;
      undo(next.id);
      done += 1;
    }
  }

  function sensitivityNote(h) {
    if (h.before.sensitivity === h.after.sensitivity) return "";
    return h.after.sensitivity === "sensitive" ? " <span class=\"chip chip-lock\">" + icon("lock") + "Now on this device only</span>"
      : " <span class=\"chip\">" + icon("unlock") + "Shared again</span>";
  }

  // ---------------------------------------------------------------- entry dialog

  var dialog = document.getElementById("dialog");
  function openEntryDialog(id, prefill) {
    var e = id ? entry(id) : null;
    prefill = prefill || {};
    var kind = e ? e.kind : prefill.kind || "fact";
    var scope = e ? e.scope : ["work"];
    var sensitive = e ? e.sensitivity === "sensitive" : false;
    function seg(value, label) {
      return '<label><input type="radio" name="kind" value="' + value + '"' + (kind === value ? " checked" : "") + ">" + label + "</label>";
    }
    dialog.innerHTML = '<form class="dlg" method="dialog">' +
      '<h2 id="dlg-title">' + (e ? "Edit entry" : "Add an entry") + "</h2>" +
      '<label class="field"><span>Entry</span><input class="text-input" name="text" required value="' + esc(e ? FW.stripHidden(e.text) : prefill.text || "") + '" autocomplete="off"></label>' +
      '<label class="field"><span>Why (optional)</span><input class="text-input" name="why" value="' + esc(e && e.why ? FW.stripHidden(e.why) : "") + '" autocomplete="off"></label>' +
      '<div class="row"><div class="seg" role="radiogroup" aria-label="Kind">' + seg("fact", "Fact") + seg("preference", "Preference") + seg("rule", "Rule") + "</div>" +
      '<label class="check"><input type="checkbox" name="work"' + (scope.indexOf("work") !== -1 ? " checked" : "") + ">Work</label>" +
      '<label class="check"><input type="checkbox" name="personal"' + (scope.indexOf("personal") !== -1 ? " checked" : "") + ">Personal</label>" +
      '<label class="check"><input type="checkbox" name="sensitive"' + (sensitive ? " checked" : "") + ">" + icon("lock") + " Keep on this device</label></div>" +
      '<p class="note">Only you can write rules. Assistants follow them but can’t propose or change them.' + (e && e.provenance.proposed_by !== "user" ? " This entry came from " + esc(name(e.provenance.proposed_by)) + "; your edit is recorded in History." : "") + "</p>" +
      '<div class="dlg-actions">' + (e ? '<button class="btn btn-danger" type="button" data-dlg="remove">Remove</button>' : "") +
      '<span class="spacer"></span><button class="btn" type="button" data-dlg="cancel">Cancel</button>' +
      '<button class="btn btn-primary" type="submit" data-dlg="save">' + (e ? "Save" : "Add") + "</button></div></form>";
    var form = dialog.querySelector("form");
    dialog.querySelector('[data-dlg="cancel"]').onclick = function () { dialog.close(); };
    var rm = dialog.querySelector('[data-dlg="remove"]');
    if (rm) rm.onclick = function () {
      var ev = userRemove(id);
      dialog.close();
      save();
      render();
      if (ev) toast("Entry removed.", "Undo", function () { undo(ev.id); save(); render(); });
    };
    form.onsubmit = function (evt) {
      evt.preventDefault();
      var text = form.text.value.trim();
      if (!text) return;
      var sc = [];
      if (form.work.checked) sc.push("work");
      if (form.personal.checked) sc.push("personal");
      if (!sc.length) sc.push("personal");
      var fields = { text: text, why: form.why.value.trim() || null, kind: form.kind.value, scope: sc, sensitivity: form.sensitive.checked ? "sensitive" : "normal" };
      var ev = e ? userEdit(id, fields) : userAdd(fields);
      dialog.close();
      save();
      render();
      if (ev) toast(e ? "Saved. Your assistants see the new version on their next read." : "Added to your context.", "Undo", function () { undo(ev.id); save(); render(); });
    };
    dialog.showModal();
    setTimeout(function () { form.text.focus(); }, 0);
  }

  function confirmDialog(title, text, okLabel, onOk) {
    dialog.innerHTML = '<form class="dlg" method="dialog"><h2 id="dlg-title">' + esc(title) + "</h2><p>" + esc(text) + "</p>" +
      '<div class="dlg-actions"><span class="spacer"></span><button class="btn" type="button" data-dlg="cancel">Cancel</button>' +
      '<button class="btn btn-danger" type="submit">' + esc(okLabel) + "</button></div></form>";
    dialog.querySelector('[data-dlg="cancel"]').onclick = function () { dialog.close(); };
    dialog.querySelector("form").onsubmit = function (evt) { evt.preventDefault(); dialog.close(); onOk(); };
    dialog.showModal();
  }

  // ---------------------------------------------------------------- rendering

  var stage = document.getElementById("stage");
  var stepsNav = document.getElementById("steps");
  var lastScreen = -1;

  function renderNav() {
    stepsNav.innerHTML = STORY.screens.map(function (s, i) {
      var n = pendingCount();
      var badge = s.id === "proposals" ? '<span class="count" title="In your inbox"' + (n ? ' aria-label="' + n + ' in your inbox"' : ' style="visibility:hidden" aria-hidden="true"') + ">" + (n || 0) + "</span>" : "";
      return '<button class="step" type="button" data-go="' + i + '"' + (i === state.ui.screen ? ' aria-current="step"' : "") + '><span class="num">' + (i + 1) + "</span>" + esc(s.nav) + badge + "</button>";
    }).join("");
    var i = state.ui.screen, n = STORY.screens.length;
    document.getElementById("pos").textContent = i + 1 + " / " + n;
    document.getElementById("prev").disabled = i === 0;
    document.getElementById("next-label").textContent = i < n - 1 ? "Next: " + STORY.screens[i + 1].nav : "Back to the start";
  }

  function captureFocus() {
    var a = document.activeElement;
    if (!a || !stage.contains(a)) return null;
    var key = a.getAttribute("data-focus");
    if (key) return { key: key, start: a.selectionStart, end: a.selectionEnd };
    if (a.dataset && a.dataset.act) return { act: a.dataset.act, id: a.dataset.id || "", scope: a.dataset.scope || "", value: a.dataset.value || "", key2: a.dataset.key || "" };
    return null;
  }
  function restoreFocus(f) {
    if (!f) return;
    var el;
    if (f.key) {
      el = stage.querySelector('[data-focus="' + f.key + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(f.start, f.end); } catch (e) { /* not a text input */ } }
      return;
    }
    var sel = '[data-act="' + f.act + '"]' + (f.id ? '[data-id="' + f.id + '"]' : "") + (f.scope ? '[data-scope="' + f.scope + '"]' : "") +
      (f.value ? '[data-value="' + f.value + '"]' : "") + (f.key2 ? '[data-key="' + f.key2 + '"]' : "");
    el = stage.querySelector(sel);
    if (el) el.focus();
  }

  function render(entering) {
    var scr = STORY.screens[state.ui.screen];
    var isNew = entering || lastScreen !== state.ui.screen;
    if (isNew && scr.id === "same-you") refreshPanes(true);
    renderNav();
    var v;
    switch (scr.id) {
      case "context": v = viewContext(); break;
      case "assistants": v = viewAssistants(); break;
      case "proposals": v = viewProposals(); break;
      case "same-you": v = viewSameYou(); break;
      case "connect": v = viewConnect(); break;
      default: v = viewHistory();
    }
    var f = isNew ? null : captureFocus();
    stage.innerHTML = '<section class="screen' + (isNew && !SHOT ? " enter" : "") + '" aria-labelledby="h-' + scr.id + '">' +
      '<div class="screen-head"><div><h1 id="h-' + scr.id + '">' + esc(scr.title) + "</h1><p>" + esc(scr.sub) + "</p></div>" +
      (v.actions ? '<div class="head-actions">' + v.actions + "</div>" : "") + "</div>" + v.body + "</section>";
    restoreFocus(f);
    if (isNew) {
      stage.scrollTop = 0;
      if (!SHOT) stage.focus({ preventScroll: true });
    }
    lastScreen = state.ui.screen;
    // A highlight plays once, on the screen where the item is shown.
    if (scr.id === "context") flash.entries = {};
    if (scr.id === "history") flash.events = {};
    if (scr.id === "assistants") flash.reads = {};
  }

  function go(i) {
    var n = STORY.screens.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === state.ui.screen && lastScreen === i) return;
    state.ui.screen = i;
    state.ui.editing = null;
    state.ui.editingSignoff = false;
    history.replaceState(null, "", "#" + STORY.screens[i].id);
    save();
    render();
  }

  // ---------------------------------------------------------------- events

  stepsNav.addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]");
    if (b) go(Number(b.getAttribute("data-go")));
  });
  document.getElementById("prev").addEventListener("click", function () { go(state.ui.screen - 1); });
  document.getElementById("next").addEventListener("click", function () {
    go(state.ui.screen < STORY.screens.length - 1 ? state.ui.screen + 1 : 0);
  });
  document.getElementById("reset").addEventListener("click", function () {
    confirmDialog("Reset the demo?", "Everything returns to the starting point: entries, proposals, history and assistants.", "Reset", resetDemo);
  });

  function nextInInbox(afterId) {
    var list = inbox();
    var all = state.proposals.slice().sort(byReceived);
    var idx = all.findIndex(function (p) { return p.id === afterId; });
    for (var k = idx + 1; k < all.length; k++) if (list.indexOf(all[k]) !== -1) return all[k].id;
    return list[0] ? list[0].id : null;
  }

  function act(name, el, evt) {
    var id = el.getAttribute("data-id");
    switch (name) {
      case "go": go(Number(el.getAttribute("data-screen"))); return;
      case "filter": state.ui.filter = el.getAttribute("data-value"); break;
      case "add-entry": openEntryDialog(null); return;
      case "edit-entry": openEntryDialog(id); return;
      case "toggle-lock": {
        evt.stopPropagation();
        var e = entry(id);
        var ev = userEdit(id, { sensitivity: e.sensitivity === "sensitive" ? "normal" : "sensitive" });
        save(); render();
        if (ev) toast(e.sensitivity === "sensitive" ? "Kept on this device. Cloud assistants can’t read it." : "Shared again with assistants that may read it.", "Undo", function () { undo(ev.id); save(); render(); });
        return;
      }
      case "select": state.ui.selected = id; state.ui.editing = null; break;
      case "tab":
        state.ui.tab = el.getAttribute("data-value");
        state.ui.editing = null;
        var l = state.ui.tab === "inbox" ? inbox() : handled();
        state.ui.selected = l[0] ? l[0].id : null;
        break;
      case "accept": {
        var hist = accept(id);
        if (!hist) return;
        var nxt = nextInInbox(id);
        state.ui.selected = nxt;
        save(); render();
        toast(hist.action === "add" ? "Added to your context." : "Your context is updated.", "Undo", function () {
          undo(hist.id); reopen(id); state.ui.selected = id; save(); render();
        });
        return;
      }
      case "accept-anyway": {
        var pa = proposal(id);
        confirmDialog("Release a held-back proposal?", FW.summary(pa.screening, pa.app_detail) + " Release it only if you are sure it is right.", "Release", function () {
          var h2 = accept(id, null, true);
          if (h2) { state.ui.selected = nextInInbox(id); save(); render(); toast("Released, at your request.", "Undo", function () { undo(h2.id); reopen(id); state.ui.selected = id; save(); render(); }); }
        });
        return;
      }
      case "write-rule": {
        var pr = proposal(id);
        openEntryDialog(null, { text: FW.stripHidden(pr.text), kind: "rule" });
        return;
      }
      case "undo-assistant": {
        var day = dayKey(nowISO());
        var cu = connector(id);
        var n0 = countConnectorChanges(id, day);
        confirmDialog("Undo everything " + cu.name + " proposed today?", "Up to " + n0 + " change" + (n0 === 1 ? "" : "s") + " go back to how they were. Changes by you and by other assistants stay.", "Undo all", function () {
          var done = undoConnector(id, day);
          var left = countConnectorChanges(id, day);
          save(); render();
          toast(done + " change" + (done === 1 ? "" : "s") + " by " + cu.name + " undone." +
            (left ? " " + left + " stayed, because a newer change depends on " + (left === 1 ? "it" : "them") + "." : ""));
        });
        return;
      }
      case "reject":
        reject(id);
        state.ui.selected = nextInInbox(id);
        save(); render();
        toast("Rejected. Nothing changed.", "Undo", function () { reopen(id); state.ui.selected = id; save(); render(); });
        return;
      case "dismiss": proposal(id).dismissed = true; state.ui.selected = nextInInbox(id); break;
      case "edit-proposal":
        state.ui.editing = id;
        state.ui.draft = FW.stripHidden(proposal(id).text);
        render();
        var inp = stage.querySelector('[data-focus="draft"]');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        return;
      case "cancel-edit": state.ui.editing = null; break;
      case "accept-edited": {
        var p = proposal(id);
        var scr = rescreen(p, state.ui.draft);
        var go2 = function () {
          var h3 = accept(id, state.ui.draft.trim(), true);
          state.ui.editing = null;
          if (h3) { state.ui.selected = nextInInbox(id); save(); render(); toast("Added in your words.", "Undo", function () { undo(h3.id); reopen(id); state.ui.selected = id; save(); render(); }); }
        };
        if (scr.verdict === "quarantined") confirmDialog("Release anyway?", FW.summary(scr, p.app_detail), "Release", go2);
        else go2();
        return;
      }
      case "undo": {
        var u = undo(id);
        save(); render();
        if (u) toast("Undone. Your assistants see the earlier version on their next read.");
        return;
      }
      case "pause": {
        var c = connector(id);
        c.status = c.status === "active" ? "paused" : "active";
        break;
      }
      case "reconnect": connector(id).status = "active"; break;
      case "disconnect": {
        var c2 = connector(id);
        var prevStatus = c2.status;
        c2.status = "disconnected";
        save(); render();
        toast(c2.name + " is disconnected. It can’t read your context any more.", "Undo", function () { c2.status = prevStatus; save(); render(); });
        // The card stays, marked Disconnected, with a Reconnect button.
        return;
      }
      case "edit-signoff": {
        var se = signoffEntry();
        state.ui.editingSignoff = true;
        state.ui.signoffDraft = se ? parseSignoff(FW.stripHidden(se.text)) : "";
        render();
        var si = stage.querySelector('[data-focus="signoff"]');
        if (si) { si.focus(); si.select(); }
        return;
      }
      case "save-signoff": saveSignoff(); return;
      case "cancel-signoff": state.ui.editingSignoff = false; break;
      case "connect-next": state.ui.connect.step += 1; break;
      case "connect-deny":
        state.ui.connect.step = 0;
        save(); render();
        toast("Nothing was shared.");
        return;
      case "connect-allow": {
        var st = state.ui.connect;
        var dExisting = connector("assistant-d");
        var d = dExisting || clone(STORY.assistantD);
        d.scopes = [];
        if (st.work) d.scopes.push("work");
        if (st.personal) d.scopes.push("personal");
        d.may_propose = st.propose;
        d.status = "active";
        d.connected = nowISO();
        if (!dExisting) state.connectors.push(d);
        recordRead(d);
        st.step = 3;
        break;
      }
      case "connect-again": state.ui.connect = { step: 0, work: true, personal: false, propose: true }; break;
      default: return;
    }
    save();
    render();
  }

  stage.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || !stage.contains(el) || el.tagName === "INPUT") return;
    act(el.getAttribute("data-act"), el, e);
  });

  stage.addEventListener("change", function (e) {
    var el = e.target;
    var name = el.getAttribute("data-act");
    if (!name) return;
    var c = connector(el.getAttribute("data-id"));
    if (name === "scope" && c) {
      var s = el.getAttribute("data-scope");
      if (el.checked && c.scopes.indexOf(s) === -1) c.scopes.push(s);
      if (!el.checked) c.scopes = c.scopes.filter(function (x) { return x !== s; });
    } else if (name === "sensitive" && c) {
      c.may_read_sensitive = el.checked;
    } else if (name === "propose" && c) {
      c.may_propose = el.checked;
    } else if (name === "use-context") {
      state.ui.useContext = el.checked;
      refreshPanes(false);
    } else if (name === "consent") {
      state.ui.connect[el.getAttribute("data-key")] = el.checked;
    } else {
      return;
    }
    save();
    render();
  });

  var inputTimer = null;
  stage.addEventListener("input", function (e) {
    var key = e.target.getAttribute("data-input");
    if (key === "draft") {
      state.ui.draft = e.target.value;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(render, 180);
    } else if (key === "signoff") {
      state.ui.signoffDraft = e.target.value;
    }
  });

  stage.addEventListener("keydown", function (e) {
    var key = e.target.getAttribute && e.target.getAttribute("data-input");
    if (key === "signoff") {
      if (e.key === "Enter") { e.preventDefault(); saveSignoff(); }
      if (e.key === "Escape") { state.ui.editingSignoff = false; render(); }
      return;
    }
    if (key === "draft" && e.key === "Escape") { state.ui.editing = null; render(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("entry")) {
      e.preventDefault();
      openEntryDialog(e.target.getAttribute("data-id"));
    }
  });

  document.addEventListener("keydown", function (e) {
    if (dialog.open) return;
    var t = e.target;
    var textual = t && t.tagName === "INPUT" && !/^(checkbox|radio|button|submit)$/i.test(t.type);
    var typing = t && (textual || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(state.ui.screen + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(state.ui.screen - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (/^[1-6]$/.test(e.key)) { go(Number(e.key) - 1); }
  });

  window.addEventListener("hashchange", function () {
    var i = STORY.screens.findIndex(function (s) { return "#" + s.id === location.hash; });
    if (i !== -1 && i !== state.ui.screen) go(i);
  });

  // ---------------------------------------------------------------- replay (screenshots and rehearsal)

  // ?do=accept:p04,reject:p06,select:p07,signoff:Kind%20regards%2C%20Sofie,context:off,
  //     scope:assistant-b:work:off,pause:assistant-a,connect:2,allow,undo:last,edit:p06:New%20text,filter:work
  function replay(raw) {
    raw.split(",").filter(Boolean).forEach(function (step) {
      var a = step.split(":").map(function (x) { return decodeURIComponent(x.replace(/\+/g, " ")); });
      switch (a[0]) {
        case "accept": accept(a[1]); break;
        case "force": accept(a[1], null, true); break;
        case "reject": reject(a[1]); break;
        case "dismiss": proposal(a[1]).dismissed = true; break;
        case "select": state.ui.selected = a[1]; break;
        case "tab": state.ui.tab = a[1]; break;
        case "edit": state.ui.editing = a[1]; state.ui.draft = a.slice(2).join(":") || FW.stripHidden(proposal(a[1]).text); break;
        case "signoff": {
          var se = signoffEntry();
          if (se) userEdit(se.id, { text: "Sign emails with “" + a.slice(1).join(":") + "”." });
          break;
        }
        case "signoff-edit": state.ui.editingSignoff = true; state.ui.signoffDraft = a.slice(1).join(":"); break;
        case "context": state.ui.useContext = a[1] !== "off"; break;
        case "scope": {
          var c = connector(a[1]);
          if (a[3] === "off") c.scopes = c.scopes.filter(function (x) { return x !== a[2]; });
          else if (c.scopes.indexOf(a[2]) === -1) c.scopes.push(a[2]);
          break;
        }
        case "pause": connector(a[1]).status = "paused"; break;
        case "connect": state.ui.connect.step = Number(a[1]); break;
        case "personal": state.ui.connect.personal = true; break;
        case "allow": {
          var d = clone(STORY.assistantD);
          d.scopes = ["work"].concat(state.ui.connect.personal ? ["personal"] : []);
          d.connected = nowISO();
          state.connectors.push(d);
          recordRead(d);
          state.ui.connect.step = 3;
          break;
        }
        case "undo": {
          var tops = undoableIds();
          var target = a[1] === "last"
            ? state.history.slice().reverse().filter(function (h) { return tops[h.id] && !h.undone_by && h.action !== "undo"; })[0]
            : state.history.filter(function (h) { return h.id === a[1]; })[0];
          if (target) undo(target.id);
          break;
        }
        case "filter": state.ui.filter = a[1]; break;
        case "undo-assistant": undoConnector(a[1], dayKey(nowISO())); break;
        case "dialog": setTimeout(function () { openEntryDialog(a[1] === "new" ? null : a[1]); }, 0); break;
        default: break;
      }
    });
  }

  // ---------------------------------------------------------------- start

  state = load();
  var startIdx = STORY.screens.findIndex(function (s) { return "#" + s.id === location.hash; });
  if (startIdx !== -1) state.ui.screen = startIdx;
  var rawDo = (location.search.match(/[?&]do=([^&]*)/) || [])[1];
  if (rawDo) replay(rawDo);
  if (SHOT) flash = { entries: {}, events: {}, reads: {} };
  if (!location.hash) history.replaceState(null, "", "#" + STORY.screens[state.ui.screen].id);
  render(true);
  if (STORY.screens[state.ui.screen].id === "same-you" && SHOT) renderPanesOnly();
})();
