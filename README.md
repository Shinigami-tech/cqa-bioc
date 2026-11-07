# CQA — Conversation Quality Analytics (team BioC)

Freedom Broker CQA Hackathon prototype: configure a checklist, auto-evaluate operator dialogs (RU / KZ / EN, chats and calls), see score + explanation + evidence line per criterion, appeal a criterion, reviewer decides, total is recomputed.

## Run

Requires Node.js 22.9+ and no npm dependencies.

```bash
cp .env.example .env     # paste the organizers' GET link (without group_id) into CQA_API_URL
npm start                # http://localhost:3000
npm test                 # scoring engine tests
```

1. **Диалоги** → enter `DEV` → «Загрузить набор» → «Оценить все».
2. Click a row to open the card. Clicking «↳ реплики» scrolls to and highlights the evidence line. For calls it also shows the position in the recording.
3. «Оспорить» → comment → **Апелляции** tab → reviewer upholds or changes the score with a reason → total is recomputed. The card shows the original score, the decision and the final score.
4. **Чек-лист** → edit or replace a criterion → «Сохранить как vN» → **Диалоги** → enter the control `group_id` → load → «Оценить все».

Without `LLM_API_KEY` the app uses a **MOCK** evaluator: heuristics only, enough for UI work. Set `LLM_API_KEY`, `LLM_MODEL` and optionally `LLM_BASE_URL` (any OpenAI-compatible API) for real evaluation. Cost per evaluation is computed from token usage × `LLM_PRICE_IN/OUT` and shown on the card and after a batch.

## Architecture

| Part | File | Notes |
|---|---|---|
| HTTP API + static | `server.mjs` | zero-dependency `node:http`; also the CORS-safe proxy to the organizers' API |
| Scoring | `lib/scoring.mjs` | **deterministic**: weights, scale normalization, N/A weight redistribution, sections, gross-error flag, rounding from the checklist |
| Evaluator | `lib/evaluator.mjs` | one LLM call per dialog, strict JSON, evidence ids validated, one repair retry; MOCK fallback |
| Storage | `lib/store.mjs` | JSON files in `data/` (conversations, checklist versions, evaluations, appeals) |
| UI | `web/` | plain HTML/CSS/JS; each screen in `web/screens/*.js` is a standalone module with `render(root, params)` so it can be packaged as a Dynamics 365 HTML web resource |

Evaluations store the checklist version they used. Appeals never mutate the model's result: the final result is the original result plus the decided appeals, so original, decision and final are always available.

### API
- `POST /api/groups/:group_id/load` fetches a dataset (DEV or control)
- `GET /api/conversations?group=` lists dialogs with totals
- `GET /api/conversations/:id` returns the transcript and the latest evaluation (original and final totals, appeals)
- `POST /api/evaluate {conversation_id}` evaluates one dialog
- `POST /api/evaluate-batch {group_id, only_missing, concurrency}` evaluates a set in parallel
- `GET /api/checklist`, `GET /api/checklists`, `POST /api/checklist {checklist, note}` (creates a new active version)
- `GET /api/appeals?status=`, `POST /api/appeals {evaluation_id, criterion_id, comment}`
- `POST /api/appeals/:id/decide {action: uphold|change, answer|score|na, reason}`

### Checklist format
```json
{ "max_score": 100, "rounding": {"decimals": 0, "mode": "half_up"}, "critical_zeroes_total": false,
  "criteria": [{ "id": "greeting", "section": "Contact", "text": "...", "weight": 10,
                 "type": "binary|scale", "scale": {"min": 0, "max": 2},
                 "na_allowed": true, "na_rule": "...", "critical": false }] }
```
`checklists/default.json` is a **placeholder** until the organizers' checklist PDF is transcribed.
