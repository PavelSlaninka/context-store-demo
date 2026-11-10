// The app's JavaScript rules give the same verdicts as the server's Python rules.
// Run: node tests/firewall_cases.test.mjs   (no npm packages needed)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const demo = join(dirname(fileURLToPath(import.meta.url)), "..");
vm.runInThisContext(readFileSync(join(demo, "app/js/firewall.js"), "utf8"), { filename: "firewall.js" });
const Firewall = globalThis.Firewall;
const data = JSON.parse(readFileSync(join(demo, "tests/firewall_cases.json"), "utf8"));

function expand(text) {
  return text.replace(/\{\{(tags:[^}]*|U\+[0-9A-Fa-f]{4,6})\}\}/g, (_, body) =>
    body.startsWith("tags:")
      ? [...body.slice(5)].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0))).join("")
      : String.fromCodePoint(parseInt(body.slice(2), 16))
  );
}

let failed = 0;
for (const c of data.cases) {
  const proposal = { ...c.proposal, text: expand(c.proposal.text) };
  const r = Firewall.screen(proposal, data.entries);
  const codes = r.reasons.map((x) => x.code).sort();
  try {
    assert.equal(r.verdict, c.expect.verdict);
    assert.deepEqual(codes, [...c.expect.codes].sort());
    console.log(`ok    ${c.name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${c.name}: got ${r.verdict} [${codes}], expected ${c.expect.verdict} [${c.expect.codes}]`);
  }
}
const a1 = data.cases.find((c) => c.name.startsWith("A1a"));
assert.equal(
  Firewall.summary(Firewall.screen(a1.proposal, data.entries), a1.proposal.app_detail),
  "Recommends a website as a trusted source; its app reported reading a web page just before."
);
console.log(`\n${data.cases.length - failed} of ${data.cases.length} cases pass (JavaScript rules).`);
if (process.argv.includes("--labels")) {
  // Used by tests/test_firewall.py to check that both ports word their reasons the same way.
  const labels = {};
  for (const c of data.cases) {
    const r = Firewall.screen({ ...c.proposal, text: expand(c.proposal.text) }, data.entries);
    labels[c.name] = { labels: r.reasons.map((x) => x.label), summary: Firewall.summary(r, c.proposal.app_detail) };
  }
  console.log("\n__LABELS__\n" + JSON.stringify(labels));
}
process.exit(failed ? 1 : 0);
