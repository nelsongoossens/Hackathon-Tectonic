// Runs the full engine offline (no LLM, no server) for every customer and checks
// the storylines and the security-relevant invariants. `npm run selftest`
import { computeState } from "../lib/engine";
import { TIMELINE_DAYS, customerSummaries } from "../lib/personas";
import { heuristicCompile, finalizeRule } from "../lib/rules";
import { toCustomerView } from "../lib/views";
import { MAX_JSON_BYTES, readJson } from "../lib/routeHelpers";
import { normalizeUsername, rateLimit } from "../lib/auth";
import type { Interaction } from "../lib/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const last = TIMELINE_DAYS - 1;
  for (const c of customerSummaries()) {
    const s = await computeState(c.id, last, [], { useLlm: false });
    const k = s.counters;
    console.log(`\n${c.name}: ${k.events} events → ${k.watcherHits} watcher hits → ${k.candidates} candidates → ${k.shown} shown · ${k.advisor} advisor · ${k.silenced} silenced (trust ${s.ledgers.trust})`);
    for (const m of s.moments) {
      const d = m.decision;
      console.log(`   d${String(m.candidate.day).padStart(3)} ${d.outcome.padEnd(8)} ${m.candidate.nodeId.padEnd(20)} ${d.reason ?? ""} ${d.outcome === "shown" ? `score ${d.score}` : ""}`);
    }
    console.log(`   beliefs: ${s.beliefs.map((b) => `${b.key}(${Math.round(b.confidence * 100)}%)`).join(", ")}`);
    check(`${c.name}: some moments are silenced`, k.silenced > 0);
    check(`${c.name}: at least one moment is shown`, k.shown > 0);
    check(`${c.name}: gate lets through a minority`, k.shown < k.candidates);
  }

  const emma = await computeState("c_emma", last, [], { useLlm: false });
  const sam = await computeState("c_sam", last, [], { useLlm: false });
  const petE = emma.moments.find((m) => m.candidate.nodeId === "pet_insurance");
  const petS = sam.moments.find((m) => m.candidate.nodeId === "pet_insurance");
  check("Same pet event: Emma sees pet insurance", petE?.decision.outcome === "shown", petE?.decision.reasonText);
  check("Same pet event: Sam & Noor get silence (trust)", petS?.decision.reason === "TRUST_TOO_LOW", petS?.decision.reasonText);
  const card = emma.moments.find((m) => m.candidate.nodeId === "credit_card_upsell");
  check("Credit card upsell fails the earn-nothing test", card?.decision.reason === "EARN_NOTHING_TEST", card?.decision.reasonText);
  const child = emma.moments.find((m) => m.candidate.nodeId === "child_savings");
  check("Child savings stays quiet on low confidence", child?.decision.reason === "LOW_CONFIDENCE", child?.decision.reasonText);

  // Interaction replay: answer the grocery moment with "help" → a rule appears and later fires
  const coach = emma.moments.find((m) => m.candidate.nodeId === "budget_coach" && m.decision.outcome === "shown");
  if (coach) {
    const i: Interaction = { id: "t1", day: coach.candidate.day, actor: "simulation", type: "answer", momentId: coach.candidate.id, optionId: "help" };
    const after = await computeState("c_emma", last, [i], { useLlm: false });
    check("Answering 'help me' compiles a weekly rule", after.rules.length === 1, after.rules[0]?.label);
    check("The rule fires later in the timeline", after.moments.some((m) => m.candidate.nodeId === "rule_alert"));
    check("Answering raises trust", after.ledgers.trust > emma.ledgers.trust, `${emma.ledgers.trust} → ${after.ledgers.trust}`);
  } else check("Emma gets a budget coach moment", false);

  // Correcting a belief: declared beats inferred
  const rej: Interaction = { id: "t2", day: 120, actor: "simulation", type: "correct", beliefKey: "household.children", verdict: "reject", note: "gifts for my nephew" };
  const corrected = await computeState("c_emma", last, [rej], { useLlm: false });
  const b = corrected.beliefs.find((x) => x.key === "household.children");
  check("Rejected belief is kept as declared + rejected", b?.status === "rejected" && b.source === "declared");

  // Unknown moment ids from another customer are ignored (no cross-customer effects)
  const foreign: Interaction = { id: "t3", day: 150, actor: "customer", type: "dismiss", momentId: petE?.candidate.id ?? "x" };
  const samAfter = await computeState("c_sam", last, [foreign], { useLlm: false });
  check("Another customer's moment id has no effect", samAfter.ledgers.trust === sam.ledgers.trust);

  // Rule compiler (offline)
  const r = finalizeRule(heuristicCompile("Warn me if I spend more than €2,000 a month outside my fixed costs"), "x", "heuristic", 10, "r1");
  check("Offline compiler: discretionary €2,000/month", !("error" in r) && r.metric === "discretionary_spend" && r.threshold === 2000 && r.period === "month", JSON.stringify(r));
  const g = finalizeRule(heuristicCompile("tell me before I spend 150 euro a week on groceries"), "x", "heuristic", 10, "r2");
  check("Offline compiler: groceries €150/week warn at 80%", !("error" in g) && g.category === "groceries" && g.threshold === 150 && g.warnAt === 0.8, JSON.stringify(g));

  // Customer API redaction: bank-internal scoring never reaches /api/me/*
  const custView = toCustomerView(emma);
  const leaked = ["kbcValue", "customerValue", "params", "signalId"];
  const leakedDecision = ["score", "threshold", "breakdown", "trustAtDecision", "attentionLeft", "reason", "reasonText"];
  check("Customer feed has shown moments", custView.feed.length > 0);
  check(
    "Customer feed strips internal candidate fields",
    custView.feed.every((m) => leaked.every((k) => !(k in m.candidate))),
  );
  check(
    "Customer feed strips gate score and ledgers",
    custView.feed.every((m) => leakedDecision.every((k) => !(k in m.decision))),
  );

  // Body limit is enforced on received bytes, not on Content-Length
  const chunked = (payload: string) =>
    new Request("http://localhost/x", {
      method: "POST",
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(payload)); c.close(); } }),
      // @ts-expect-error duplex is required for streaming bodies in Node fetch
      duplex: "half",
    });
  check("readJson parses a small chunked body", JSON.stringify(await readJson(chunked('{"a":1}'))) === '{"a":1}');
  check("readJson rejects an oversized chunked body", (await readJson(chunked(`{"a":"${"x".repeat(MAX_JSON_BYTES)}"}`))) === null);
  check("readJson rejects invalid JSON", (await readJson(chunked("{oops"))) === null);

  // Login limiter: username variants share one bucket; limiter table cannot grow without bound
  check("Username normalisation folds case and whitespace", normalizeUsername("  Emma ") === "emma");
  for (let i = 0; i < 20_000; i++) rateLimit(`probe:${i}`, 1, 60_000);
  check("Rate limiter table is bounded", ((globalThis as unknown as { __momentsAuth: { limits: Map<string, unknown> } }).__momentsAuth.limits.size) <= 10_000);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main();
