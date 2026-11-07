# CQA: Conversation Quality Analytics · team BioC

A prototype for Freedom Broker that scores operator conversations (chats and calls in RU / KZ / EN) against configurable checklists. Every score comes with an explanation and a link to the exact message (or the moment in the call recording), can be appealed, and is reviewed by a human.

## What it does
- **Several checklists.** Chats and calls each have their own checklist (the call one is adapted to speech, following Freedom Broker's clarification). Each checklist is versioned, bound to a channel, and can be created, duplicated and edited in the UI.
- **Hybrid evaluation, so numbers are never hallucinated:**
  1. Code extracts facts from the dialog: client and operator language, first response time, pauses over 3 minutes, system events (escalation, «личность подтверждена», chat closed, connection lost) and red flags for gross errors.
  2. An LLM judge (any OpenAI-compatible API, cloud or local through Ollama/vLLM) answers each criterion in strict JSON, citing message numbers.
  3. Code validates the answer: N/A only where allowed, evidence must exist, a scale score snaps to an allowed step. On a violation it runs one repair retry.
  4. Optional voting: `LLM_VOTES=3` runs three judges, takes the majority per criterion, and uses the agreement as confidence.
  5. Code computes every number: weights, N/A redistribution, sections, the gross-error flag, rounding to 2 decimals.
- **Evidence.** Clicking `#12` scrolls the transcript to that message and highlights it. For a call, the embedded player jumps to that second (the backend extracts the real mp3 from the organizers' player page).
- **Transparency.** The «Как решила модель» tab shows the extracted facts, the full prompt, the raw model answer, tokens, cost, time and prompt version.
- **Appeals.** An appeal on any criterion goes to the reviewer's workspace (original score, comment, highlighted fragment). The reviewer upholds or changes it with a reason, and the total is recomputed. The card keeps the original score, the decision and the final score.
- **Human-review queue.** Criteria where the model's confidence is below 0.67 are flagged.
- **Dashboard.** Average score, distribution, per-criterion compliance, breakdown by language and channel, gross errors, cost.
- **Batch and control set.** Load any `group_id`, then click «Оценить» to evaluate everything new or outdated with a live progress bar. Export to CSV or JSON.
- **Frontend:** plain HTML/CSS/JS, one module per screen, so each screen can become a Dynamics 365 web resource. Light and dark theme, keyboard shortcuts (← → between dialogs, `/` for search).

## Run
```bash
cp .env.example .env      # CQA_API_URL = organizers' GET link without group_id; LLM_* = model
npm start                 # reference server: http://localhost:3000 (Node 22.9+, no npm deps)
npm test                  # JS scoring tests
cd backend && python -m pytest -q   # Python parity tests (scoring, facts, prompt)
```
Without `LLM_API_KEY` the app runs in **MOCK** mode (rules over the same facts), so the UI works offline.

Model settings: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_VOTES`, `LLM_CONCURRENCY`, `LLM_PRICE_IN` / `LLM_PRICE_OUT` (USD per 1M tokens, used to estimate cost per evaluation).

## Accuracy
`node tools/accuracy.mjs labels/dev-gold.json` compares model answers with the team's hand labels: per-criterion agreement, mean error of the total, accuracy of the gross-error flag. See `labels/README.md`.

## Layout
| Path | What |
|---|---|
| `web/` | UI: `screens/dashboard, list, card, checklists, appeals`, `lib/api.js` |
| `server.mjs` | reference API (Node); contract in `API_CONTRACT.md` |
| `lib/` | `facts.mjs`, `evaluator.mjs`, `scoring.mjs`, `store.mjs` |
| `prompts/` | judge prompt shared by JS and Python |
| `checklists/` | `chat.json` (official checklist), `call.json` (speech adaptation) |
| `backend/cqa/` | Python: `scoring.py`, `sanitize.py`, `facts.py`, `evaluator.py`, `audio.py` |
| `test/fixtures/` | parity fixtures generated from the JS reference |
