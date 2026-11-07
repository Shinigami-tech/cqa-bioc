// Evaluates one conversation against one checklist.
// LLM mode: any OpenAI-compatible API (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL), one call per conversation.
// MOCK mode (no key): rough heuristics so the UI can be built and demoed offline.

const KEY = () => process.env.LLM_API_KEY;

export function numbered(transcript) {
  return transcript.map((t, i) => `[${i}] ${t.timestamp} ${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
}

export function buildPrompt(conv, checklist) {
  const crit = checklist.criteria.map((c) => ({
    id: c.id, text: c.text, type: c.type,
    scale: c.type === "scale" ? c.scale : undefined,
    na_allowed: !!c.na_allowed, na_rule: c.na_rule || undefined,
  }));
  const system = `You are a quality-assurance auditor for Freedom Broker's contact center.
Evaluate ONLY the human OPERATOR. BOT and SYSTEM lines are context (bot greetings do not count as the operator's).
The conversation may be in Russian, Kazakh or English; answer explanations in Russian.
For every criterion return:
- na: true only if na_allowed and the N/A rule applies (then na_reason, no score)
- answer: "yes"/"no" for binary; score: integer within the scale for scale criteria
- explanation: 1-2 sentences, concrete
- evidence_ids: indexes [n] of the lines that justify the verdict (prefer OPERATOR lines)
- checked_span: when an expected action is missing, the index range you checked, e.g. "5-12"
Return JSON: {"results":[{criterion_id,na,na_reason,answer,score,explanation,evidence_ids,checked_span}]}`;
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
        const s = Math.round(Number(r.score));
        out.score = Number.isFinite(s) ? Math.min(c.scale.max, Math.max(c.scale.min, s)) : c.scale.min;
      } else out.answer = r.answer === "yes" ? "yes" : "no";
    }
    return out;
  });
  return { results, problems };
}

async function callLLM({ system, user }) {
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
    if (c.id === "greeting") {
      const ok = GREET.test(first.text) && NAME.test(first.text);
      return { ...base, ...pass(c, ok), evidence_ids: [first.i], explanation: ok ? "Оператор поздоровался и представился." : "В первой реплике нет приветствия с именем." };
    }
    if (c.id === "closing") {
      const hit = ops.find((t) => BYE.test(t.text) || ELSE.test(t.text));
      return { ...base, ...pass(c, !!hit), evidence_ids: hit ? [hit.i] : [], checked_span: hit ? "" : span, explanation: hit ? "Оператор корректно завершил диалог." : "Прощания или уточнения «что-то ещё?» не найдено." };
    }
    if (c.na_allowed && c.id !== "closing") return { ...base, na: true, na_reason: "MOCK: условие N/A выполнено (заглушка до подключения LLM)." };
    return { ...base, ...pass(c, true), evidence_ids: [last.i], explanation: "MOCK: оценка-заглушка, подключите LLM_API_KEY." };
  });
  return { results, problems: [] };
}
const pass = (c, ok) => (c.type === "scale" ? { score: ok ? c.scale.max : c.scale.min } : { answer: ok ? "yes" : "no" });
