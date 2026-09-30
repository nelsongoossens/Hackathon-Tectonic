# Moments: a bank that earns the right to speak

KBC challenge PoC for the Tectonic hackathon (30 Sep 2026).

KBC's assistant Kate can already speak up in 140+ situations. The hard part now is choosing **which one matters to this person today, and staying quiet about the rest.** Moments is the understanding and restraint layer behind that. It builds an explainable, correctable model of each customer. It walks a curated service graph to find what could help. Then an **attention gate** decides: show it, route it to an advisor, or stay silent and log why.

## What's in the demo

| Piece | Where |
|---|---|
| **Client model**: facts tier (bank data) + understanding tier. Every belief has a source (bank data / declared / inferred), confidence, evidence and dates. | `lib/engine.ts`, Control room → *Client model* |
| **Deterministic watchers**: new recurring payment, spending shift, income change, savings change, large one-off, duplicate payment, low buffer, the customer's own rules. These are the only things that wake the LLM. | `lib/watchers.ts` |
| **Sensemaking**: an LLM (Claude, schema-validated, cached) turns a watcher hit into beliefs, with a deterministic heuristic fallback. | `lib/llm.ts`, `lib/engine.ts` |
| **Service graph**: 17 curated nodes with hard/soft conditions, dependencies, procedure, degrees of freedom and guardrails (MiFID → advisor). | `lib/serviceGraph.ts`, Control room → *Service graph* |
| **Attention gate**: score = customer value × confidence × urgency − interruption cost. KBC's value is never scored; it's only used for the *"would we show this if KBC earned nothing?"* test. Plus trust and attention ledgers that learn from engage / dismiss / ignore / mute. | `lib/gate.ts` |
| **Silence log**: every suppressed moment with a reason code. | Control room → *Silence log* |
| **Generative UI from a safe library**: agents fill `info / confirm / choice / slider` components and never write UI. Answers write back as *declared* (declared beats inferred). | `components/MomentCard.tsx` |
| **Intent compiler**: "Warn me if I spend more than €2,000 a month outside my fixed costs" → a JSON rule that plain code evaluates. The LLM output is never executed. | `lib/rules.ts`, phone → *My rules* |
| **Voice channel**: Jef (71) prefers calls, so his moments are voice messages via ElevenLabs (browser speech as fallback). | `lib/voice.ts` |
| **Scale test**: the same watcher code over N synthetic customers, projected to 2.3M. | `lib/scale.ts`, `npm run scale` |

The engine is **event-sourced**: transactions, answers, corrections, dismissals and rules are all events, and the state on day N is a replay to day N. That's what makes the time-lapse, and it's why every decision can be explained.

### Three synthetic customers (seeded, reproducible, no real data)
- **Emma, 24**: first job. Grocery creep in May, toy-shop purchases (the "has a child?" inference stays quiet at 35%), a puppy in June, a raise in July, a second-hand car.
- **Sam & Noor, 31/30**: saving hard for a house, a home inspection and notary in July. They dismissed 3 offers before March, so **trust starts low**.
- **Jef, 71**: retired, prefers voice. Double-debited energy bill, energy contract +43%, rising pharmacy costs, a €5,000 gift to a grandchild (→ advisor).

## Run it

```bash
npm install
cp .env.example .env.local   # then set DEMO_PASSWORD and STAFF_PASSWORD (10+ chars)
npm run dev                   # http://localhost:3000
```

Log in as `analyst` (STAFF_PASSWORD) for the control room, or as `emma`, `sam` or `jef` (DEMO_PASSWORD) for the customer's own app.

Everything works **without API keys** (offline heuristics, browser speech). To use real models:

```bash
# in .env.local
ANTHROPIC_API_KEY=...      # sensemaking, moment copy, intent compiler (default model claude-opus-5-5)
ELEVENLABS_API_KEY=...     # voice messages
npm run warm               # optional: precompute all LLM answers so the time-lapse is instant
```

Other scripts:

```bash
npm run selftest                        # replays all customers offline and checks storylines + invariants
npm run scale -- --customers 100000     # watcher throughput and a projection to 2.3M customers
npm run typecheck
```

## Demo path (≈3 min)
1. Control room → Emma → drag the timeline to March → **▶ Play**. Watch the client model fill in and the counters run: events → watcher hits → LLM calls → candidates → shown.
2. **Silence log**: the Gold card upsell fails the earn-nothing test, and "child savings" stays quiet at 35% confidence.
3. On the phone, answer *"Help me get back under €X/week"*. It becomes a rule, and scrubbing forward shows it firing. Reject the "child" belief under *About me*. Dismiss something and watch *Ledgers*.
4. **Same event, two customers**: the puppy shows up for Emma and for Sam & Noor on the same day. Emma (trust 0.62) gets the pet insurance offer; Sam & Noor (0.45) get only the helpful budget note.
5. Jef: a voice message. **Advisor queue**: the gift triggers estate planning, routed to a human. **Scale**: run 10k customers.

## Security
- Sessions are server-side (random 256-bit token, `httpOnly`, `SameSite=Strict`, 8h). Passwords come from env only and are compared in constant time (scrypt). Login is rate-limited.
- **No IDOR surface**: `/api/me/*` takes the customer id from the session only, never from the request. Staff routes check the role on every request. Unknown or foreign moment ids are rejected.
- Every state-changing request checks `Origin`. All bodies are validated with zod, with length limits.
- LLM output is schema-constrained and never executed: rules are a JSON DSL, and the UI is a whitelisted component library rendered as text (no raw HTML). Customer text is passed to the model as data.
- TTS only reads text of the caller's own moments (no arbitrary text, which protects credits). LLM, TTS and scale endpoints are rate-limited.
- Security headers: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP. Secrets live in `.env.local` (gitignored).

## Unfinished / honest limits
- State is in memory plus a JSON file in `.data/` (single instance). Production would put the ledgers and client model in a database, with the watchers on a stream processor.
- The scale test measures the deterministic watcher layer on one core. LLM cost is a projection from list prices and assumed token counts.
- Demo logins are synthetic users with shared env passwords, not a real identity provider.
- The service graph is a hand-written 17-node slice, not KBC's catalogue.
