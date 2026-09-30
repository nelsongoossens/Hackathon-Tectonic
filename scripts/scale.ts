// `npm run scale -- --customers 100000`
// Runs the demo's watcher code over N synthetic customers and projects to 2.3M.
import { runScale } from "../lib/scale";

const arg = process.argv.indexOf("--customers");
const n = arg >= 0 ? Number(process.argv[arg + 1]) : 20_000;
if (!Number.isInteger(n) || n < 1 || n > 5_000_000) {
  console.error("--customers must be an integer between 1 and 5,000,000");
  process.exit(1);
}
console.log(`Running watchers over ${n.toLocaleString("en-US")} synthetic customers × 6 months...`);
const r = runScale(n);
console.log(JSON.stringify(r, null, 2));
console.log(`\n${r.events.toLocaleString("en-US")} events in ${r.seconds}s (${r.eventsPerSecond.toLocaleString("en-US")}/s on one core).`);
console.log(`Watchers fired ${r.escalationRate} times per customer per month: that's how often an LLM wakes up.`);
console.log(`Projected to ${r.projection.customers.toLocaleString("en-US")} customers: ${r.projection.llmCallsPerDay.toLocaleString("en-US")} LLM calls/day.`);
