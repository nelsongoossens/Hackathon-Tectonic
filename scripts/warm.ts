// `npm run warm` - precomputes every LLM answer for the full timeline of every
// customer (sensemaking + moment copy) so the time-lapse is instant in the demo.
// Needs ANTHROPIC_API_KEY in .env.local.
import { computeState } from "../lib/engine";
import { TIMELINE_DAYS, customerSummaries } from "../lib/personas";
import { llmEnabled, llmModel } from "../lib/llm";

try {
  process.loadEnvFile(".env.local");
} catch { /* optional */ }

async function main() {
  if (!llmEnabled()) {
    console.error("No ANTHROPIC_API_KEY found (.env.local). Nothing to warm: the demo will use offline heuristics.");
    process.exit(1);
  }
  console.log(`Warming the LLM cache with ${llmModel()}...`);
  await Promise.all(customerSummaries().map(async (c) => {
    const s = await computeState(c.id, TIMELINE_DAYS - 1, []);
    console.log(`${c.name}: ${s.counters.llmCalls} live calls, ${s.counters.llmCached} cached, ${s.counters.heuristic} heuristic fallbacks`);
  }));
  await new Promise((r) => setTimeout(r, 1000)); // let the cache flush to disk
  console.log("Done. Cache saved in .data/llm-cache.json");
}

main();
