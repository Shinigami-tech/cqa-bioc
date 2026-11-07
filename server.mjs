import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { load, save, newId } from "./lib/store.mjs";
import { evaluate } from "./lib/evaluator.mjs";
import { computeTotals, validateChecklist } from "./lib/scoring.mjs";

const PORT = Number(process.env.PORT || 3000);
const WEB = path.resolve("web");

// ---------- data ----------
async function fetchGroup(groupId) {
  const base = process.env.CQA_API_URL;
  if (!base) throw httpError(500, "CQA_API_URL is not set (see .env.example)");
  const url = `${base}${base.includes("?") ? "&" : "?"}group_id=${encodeURIComponent(groupId)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.isSuccess) throw httpError(502, `Organizers API: ${j.error || res.status}`);
  const convs = load("conversations", {});
  for (const r of j.data.records) convs[r.conversation_id] = { ...r, group_id: groupId };
  save("conversations", convs);
  return j.data.records.length;
}

function checklists() {
  let st = load("checklists", null);
  if (!st) {
    const cl = JSON.parse(fs.readFileSync("checklists/default.json", "utf8"));
    st = { active: 1, versions: [{ version: 1, created_at: new Date().toISOString(), note: "initial", checklist: cl }] };
    save("checklists", st);
  }
  return st;
}
const activeChecklist = () => { const st = checklists(); return st.versions.find((v) => v.version === st.active); };
const checklistVersion = (n) => checklists().versions.find((v) => v.version === n);

// Final results = model results with decided appeals applied on top. Totals are recomputed every time.
function view(ev) {
  const cl = checklistVersion(ev.checklist_version).checklist;
  const appeals = load("appeals", []).filter((a) => a.evaluation_id === ev.id);
  const final = ev.results.map((r) => {
    const a = appeals.find((x) => x.criterion_id === r.criterion_id && x.status === "changed");
    return a ? { ...r, ...a.decision.result, overridden: true, appeal_id: a.id } : r;
  });
  return { ...ev, appeals, final_results: final, original_totals: computeTotals(cl, ev.results), totals: computeTotals(cl, final), checklist: cl };
}
const latestEval = (cid) => load("evaluations", []).filter((e) => e.conversation_id === cid).at(-1);

async function runEvaluation(cid) {
  const conv = load("conversations", {})[cid];
  if (!conv) throw httpError(404, `conversation ${cid} not loaded`);
  const v = activeChecklist();
  const t0 = Date.now();
  const out = await evaluate(conv, v.checklist);
  const ev = { id: newId("ev"), conversation_id: cid, group_id: conv.group_id, checklist_version: v.version, created_at: new Date().toISOString(), ms: Date.now() - t0, ...out };
  const all = load("evaluations", []); all.push(ev); save("evaluations", all);
  return view(ev);
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { ok: true, ...(await fn(items[k])) }; } catch (e) { out[k] = { ok: false, error: e.message }; } }
  }));
  return out;
}

// ---------- routes ----------
const routes = {
  "GET /api/health": async () => ({ ok: true, llm: process.env.LLM_API_KEY ? process.env.LLM_MODEL : "MOCK" }),

  "POST /api/groups/:gid/load": async ({ gid }) => ({ loaded: await fetchGroup(gid) }),

  "GET /api/conversations": async (_, q) => {
    const convs = Object.values(load("conversations", {})).filter((c) => !q.group || c.group_id === q.group);
    return convs.map((c) => {
      const ev = latestEval(c.conversation_id); const v = ev && view(ev);
      return {
        conversation_id: c.conversation_id, group_id: c.group_id, channel: c.channel, language: c.language, lines: c.transcript.length,
        total: v?.totals.total ?? null, critical: v?.totals.critical_errors.length || 0, checklist_version: ev?.checklist_version ?? null,
        appeals_open: v?.appeals.filter((a) => a.status === "open").length || 0, appeals_total: v?.appeals.length || 0,
      };
    });
  },

  "GET /api/conversations/:cid": async ({ cid }) => {
    const conv = load("conversations", {})[cid];
    if (!conv) throw httpError(404, "not found");
    const ev = latestEval(cid);
    return { conversation: conv, evaluation: ev ? view(ev) : null };
  },

  "POST /api/evaluate": async (_, __, body) => runEvaluation(body.conversation_id),

  "POST /api/evaluate-batch": async (_, __, body) => {
    const ids = Object.values(load("conversations", {}))
      .filter((c) => !body.group_id || c.group_id === body.group_id)
      .filter((c) => !body.only_missing || latestEval(c.conversation_id)?.checklist_version !== activeChecklist().version)
      .map((c) => c.conversation_id);
    const t0 = Date.now();
    const res = await pool(ids, Number(body.concurrency || process.env.LLM_CONCURRENCY || 4), async (cid) => { const v = await runEvaluation(cid); return { cid, total: v.totals.total, cost_usd: v.cost_usd }; });
    return { count: ids.length, ms: Date.now() - t0, cost_usd: Number(res.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(4)), results: res };
  },

  "GET /api/checklist": async () => activeChecklist(),
  "GET /api/checklists": async () => checklists(),
  "POST /api/checklist": async (_, __, body) => {
    const errors = validateChecklist(body.checklist);
    if (errors.length) throw httpError(400, errors.join("; "));
    const st = checklists();
    const version = Math.max(...st.versions.map((v) => v.version)) + 1;
    st.versions.push({ version, created_at: new Date().toISOString(), note: body.note || "", checklist: body.checklist });
    st.active = version; save("checklists", st);
    return { version };
  },

  "GET /api/appeals": async (_, q) => {
    const evs = load("evaluations", []);
    return load("appeals", []).filter((a) => !q.status || a.status === q.status).map((a) => ({ ...a, conversation_id: evs.find((e) => e.id === a.evaluation_id)?.conversation_id }));
  },
  "POST /api/appeals": async (_, __, body) => {
    const ev = load("evaluations", []).find((e) => e.id === body.evaluation_id);
    if (!ev) throw httpError(404, "evaluation not found");
    const original = ev.results.find((r) => r.criterion_id === body.criterion_id);
    if (!original) throw httpError(400, "unknown criterion");
    if (!body.comment?.trim()) throw httpError(400, "comment is required");
    const all = load("appeals", []);
    if (all.some((a) => a.evaluation_id === ev.id && a.criterion_id === body.criterion_id && a.status === "open")) throw httpError(409, "appeal already open");
    const a = { id: newId("ap"), evaluation_id: ev.id, criterion_id: body.criterion_id, comment: body.comment.trim(), author: body.author || "operator", status: "open", created_at: new Date().toISOString(), original };
    all.push(a); save("appeals", all); return a;
  },
  "POST /api/appeals/:aid/decide": async ({ aid }, __, body) => {
    const all = load("appeals", []); const a = all.find((x) => x.id === aid);
    if (!a) throw httpError(404, "appeal not found");
    if (!body.reason?.trim()) throw httpError(400, "reason is required");
    if (body.action === "uphold") a.status = "upheld";
    else if (body.action === "change") {
      a.status = "changed";
      a.result = undefined;
      a.decision = { result: { na: !!body.na, na_reason: body.na ? body.reason : "", ...(body.score !== undefined ? { score: Number(body.score) } : {}), ...(body.answer ? { answer: body.answer } : {}) } };
    } else throw httpError(400, "action must be uphold or change");
    a.decision = { ...(a.decision || {}), reason: body.reason.trim(), reviewer: body.reviewer || "reviewer", decided_at: new Date().toISOString() };
    save("appeals", all);
    const ev = load("evaluations", []).find((e) => e.id === a.evaluation_id);
    return { appeal: a, evaluation: view(ev) };
  },
};

// ---------- http ----------
const compiled = Object.entries(routes).map(([k, fn]) => {
  const [method, p] = k.split(" ");
  const keys = [];
  const re = new RegExp("^" + p.replace(/:(\w+)/g, (_, n) => (keys.push(n), "([^/]+)")) + "$");
  return { method, re, keys, fn };
});
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const r = compiled.find((c) => c.method === req.method && c.re.test(url.pathname));
    if (!r) return send(res, 404, { error: "no route" });
    try {
      const m = url.pathname.match(r.re); const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (req.method === "POST") { let s = ""; for await (const ch of req) s += ch; body = s ? JSON.parse(s) : {}; }
      send(res, 200, await r.fn(params, Object.fromEntries(url.searchParams), body));
    } catch (e) { send(res, e.status || 500, { error: e.message }); }
    return;
  }
  const f = path.join(WEB, url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { error: "not found" });
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`CQA on http://localhost:${PORT}  (evaluator: ${process.env.LLM_API_KEY ? process.env.LLM_MODEL : "MOCK"})`));

function send(res, status, obj) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }
