// Evaluates one conversation against one checklist.
// LLM mode: any OpenAI-compatible API (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL), one call per conversation.
// MOCK mode (no key): rough heuristics so the UI can be built and demoed offline.

const KEY = () => process.env.LLM_API_KEY;

export function numbered(transcript) {
  return transcript.map((t, i) => `[${i}] ${t.timestamp} ${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
}

export function buildPrompt(conv, checklist) {
  const crit = checklist.criteria.map((c) => ({
    id: c.id, name: c.text, rule: c.description || undefined, type: c.type,
    allowed_scores: c.type === "scale" ? (c.scale.steps?.length ? c.scale.steps : `integer ${c.scale.min}..${c.scale.max}`) : undefined,
    na_allowed: !!c.na_allowed, na_condition: c.na_allowed ? c.na_rule || undefined : undefined,
    meaning_of_yes: c.critical_on === "yes" ? "a violation WAS found (bad)" : undefined,
  }));
  const system = `You are a quality-assurance auditor for Freedom Broker's contact center.
Evaluate ONLY the human OPERATOR. BOT and SYSTEM lines are context (bot greetings do not count as the operator's).
The conversation may be in Russian, Kazakh or English; answer explanations in Russian.
For every criterion return:
- na: true only if na_allowed and the N/A rule applies (then na_reason, no score)
- answer: "yes"/"no" for binary; score: one of allowed_scores for scale criteria (pick the step whose description fits best)
- explanation: 1-2 sentences, concrete
- evidence_ids: indexes [n] of the lines that justify the verdict (prefer OPERATOR lines)
- checked_span: when an expected action is missing, the index range you checked, e.g. "5-12"
Decide N/A first, strictly by na_condition; "no" means the action was needed but missed or done wrong.
Return JSON: {"results":[{criterion_id,na,na_reason,answer,score,explanation,evidence_ids,checked_span}]}
${checklist.instructions ? `\nCHECKLIST GUIDANCE (authoritative):\n${checklist.instructions}` : ""}`;
  const user = `CRITERIA:\n${JSON.stringify(crit, null, 1)}\n\nCHANNEL: ${conv.channel}, LANGUAGE: ${conv.language}\nTRANSCRIPT:\n${numbered(conv.transcript)}`;
  return { system, user };
}

// Fix up what the model returned: unknown evidence ids, out-of-range scores, N/A where not allowed.
export function sanitize(conv, checklist, raw) {
  const n = conv.transcript.length;
  const byId = Object.fromEntries((raw?.results || []).map((r) => [r.criterion_id, r]));
  const problems = [];
  const results = checklist.criteria.map((c) => {
    const r = byId[c.id] || {};
    if (!byId[c.id]) problems.push(`${c.id}: missing`);
    const na = !!r.na && !!c.na_allowed;
    if (r.na && !c.na_allowed) problems.push(`${c.id}: N/A not allowed`);
    const evidence = [...new Set((r.evidence_ids || []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
    if ((r.evidence_ids || []).length !== evidence.length) problems.push(`${c.id}: bad evidence ids`);
    const out = { criterion_id: c.id, na, na_reason: na ? r.na_reason || "" : "", explanation: r.explanation || "", evidence_ids: evidence, checked_span: r.checked_span || "" };
    if (!na) {
      if (c.type === "scale") {
        out.score = snap(c, Number(r.score));
        if (out.score !== Number(r.score)) problems.push(`${c.id}: score ${r.score} is not an allowed step`);
      } else out.answer = r.answer === "yes" ? "yes" : "no";
    }
    return out;
  });
  return { results, problems };
}

// Retries on rate limits / transient errors (free tiers return 429 quickly under batch load).
// Nearest allowed step (or clamp to the integer range when the scale has no steps).
export function snap(c, x) {
  const { min, max, steps } = c.scale;
  if (!Number.isFinite(x)) return min;
  if (steps?.length) return steps.map((s) => s.value).reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  return Math.min(max, Math.max(min, Math.round(x)));
}

async function callLLM(prompt, attempt = 0) {
  try { return await callOnce(prompt); }
  catch (e) {
    if (attempt >= 5 || !/LLM (429|5\d\d)|fetch failed/.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * 2 ** attempt)));
    return callLLM(prompt, attempt + 1);
  }
}

async function callOnce({ system, user }) {
  const res = await fetch(`${process.env.LLM_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY()}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { json: JSON.parse(j.choices[0].message.content), usage: j.usage || {} };
}

export async function evaluate(conv, checklist) {
  if (!KEY()) return { ...mock(conv, checklist), model: "MOCK (no LLM key)", cost_usd: 0 };
  const prompt = buildPrompt(conv, checklist);
  let { json, usage } = await callLLM(prompt);
  let { results, problems } = sanitize(conv, checklist, json);
  if (problems.length) { // one repair attempt
    const retry = await callLLM({ ...prompt, user: `${prompt.user}\n\nYour previous answer had problems: ${problems.join("; ")}. Return the full corrected JSON.` });
    usage = { prompt_tokens: (usage.prompt_tokens || 0) + (retry.usage.prompt_tokens || 0), completion_tokens: (usage.completion_tokens || 0) + (retry.usage.completion_tokens || 0) };
    ({ results, problems } = sanitize(conv, checklist, retry.json));
  }
  const cost = ((usage.prompt_tokens || 0) * Number(process.env.LLM_PRICE_IN || 0) + (usage.completion_tokens || 0) * Number(process.env.LLM_PRICE_OUT || 0)) / 1e6;
  return { results, problems, model: process.env.LLM_MODEL, usage, cost_usd: Number(cost.toFixed(5)) };
}

// ---------- MOCK ----------
const GREET = /здравствуй|добр(ый|ое)|сәлем|қайырлы|hello|hi\b|good (morning|afternoon|evening)/i;
const NAME = /меня зовут|менің атым|my name is|this is \w+/i;
const BYE = /до свидания|хорошего|всего доброго|сау болыңыз|жақсы күн|have a (nice|good)|goodbye|bye/i;
const ELSE = /что-?то ещё|чем-?то ещё|тағы|anything else/i;

function mock(conv, checklist) {
  const ops = conv.transcript.map((t, i) => ({ ...t, i })).filter((t) => t.speaker === "operator");
  const first = ops[0], last = ops.at(-1);
  const span = ops.length ? `${first.i}-${last.i}` : "";
  const results = checklist.criteria.map((c) => {
    const base = { criterion_id: c.id, na: false, na_reason: "", evidence_ids: [], checked_span: "", explanation: "" };
    if (!ops.length) {
      return c.na_allowed ? { ...base, na: true, na_reason: "Оператор не подключался к диалогу." }
        : { ...base, ...pass(c, false), checked_span: `0-${conv.transcript.length - 1}`, explanation: "Реплик оператора нет." };
    }
    if (/contact|greeting/.test(c.id)) {
      const ok = GREET.test(first.text) && NAME.test(first.text);
      return { ...base, ...pass(c, ok), evidence_ids: [first.i], explanation: ok ? "Оператор поздоровался и представился." : "В первой реплике нет приветствия с именем." };
    }
    if (/closing/.test(c.id)) {
      const hit = ops.find((t) => BYE.test(t.text) || ELSE.test(t.text));
      return { ...base, ...pass(c, !!hit), evidence_ids: hit ? [hit.i] : [], checked_span: hit ? "" : span, explanation: hit ? "Оператор корректно завершил диалог." : "Прощания или уточнения «что-то ещё?» не найдено." };
    }
    if (c.critical_on === "yes") return { ...base, answer: "no", checked_span: span, explanation: "MOCK: нарушений не найдено." };
    if (c.na_allowed && !/closing/.test(c.id)) return { ...base, na: true, na_reason: "MOCK: условие N/A выполнено (заглушка до подключения LLM)." };
    return { ...base, ...pass(c, true), evidence_ids: [last.i], explanation: "MOCK: оценка-заглушка, подключите LLM_API_KEY." };
  });
  return { results, problems: [] };
}
const pass = (c, ok) => (c.type === "scale" ? { score: ok ? c.scale.max : c.scale.min } : { answer: ok ? "yes" : "no" });
