import { api, esc, toast, verdict } from "../lib/api.js";

let status = "open";

export async function render(root) {
  const items = await api(`/api/appeals${status ? `?status=${status}` : ""}`);
  root.innerHTML = `
  <section class="pad">
    <div class="toolbar">
      <h2>Апелляции · экран проверяющего</h2>
      <select id="st">${[["open", "На рассмотрении"], ["", "Все"], ["upheld", "Подтверждены"], ["changed", "Изменены"]].map(([v, l]) => `<option value="${v}" ${v === status ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    <div id="items">${items.length ? "" : '<p class="muted">Нет апелляций.</p>'}</div>
  </section>`;
  root.querySelector("#st").onchange = (e) => { status = e.target.value; render(root); };
  const box = root.querySelector("#items");
  for (const a of items) box.append(await card(a, root));
}

async function card(a, root) {
  const { conversation: conv, evaluation: ev } = await api(`/api/conversations/${encodeURIComponent(a.conversation_id)}`);
  const c = ev.checklist.criteria.find((x) => x.id === a.criterion_id);
  const ids = a.original.evidence_ids?.length ? a.original.evidence_ids : [];
  const ctx = new Set(ids.flatMap((i) => [i - 1, i, i + 1]).filter((i) => i >= 0 && i < conv.transcript.length));
  const el = document.createElement("div");
  el.className = "appeal-card";
  el.innerHTML = `
    <div class="toolbar"><a class="mono" href="#/c/${encodeURIComponent(a.conversation_id)}">${esc(a.conversation_id)}</a><b>${esc(c?.text || a.criterion_id)}</b><span class="tag ${a.status === "open" ? "warn" : ""}">${a.status}</span></div>
    <div class="cols3">
      <div><div class="muted">Исходная оценка</div><b>${verdict(c, a.original)}</b><p>${esc(a.original.na ? a.original.na_reason : a.original.explanation)}</p></div>
      <div><div class="muted">Комментарий апелляции</div><p>«${esc(a.comment)}»</p></div>
      <div><div class="muted">Решение</div>${a.status === "open" ? decisionForm(c) : `<b>${a.status === "upheld" ? "Подтверждено" : "Изменено → " + verdict(c, a.decision.result)}</b><p>${esc(a.decision.reason)}</p>`}</div>
    </div>
    <div class="snippet">${[...ctx].sort((x, y) => x - y).map((i) => `<div class="line sp-${conv.transcript[i].speaker} ${ids.includes(i) ? "hit" : ""}"><span class="idx">${i}</span><span class="who">${esc(conv.transcript[i].speaker)}</span><span class="txt">${esc(conv.transcript[i].text)}</span></div>`).join("") || '<span class="muted">Доказательство не указано — откройте диалог.</span>'}</div>`;

  const f = el.querySelector("form");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const action = e.submitter.value;
    const body = { action, reason: f.reason.value };
    if (action === "change") {
      if (f.na?.checked) body.na = true;
      else if (c.type === "scale") body.score = Number(f.score.value);
      else body.answer = f.answer.value;
    }
    try { const r = await api(`/api/appeals/${a.id}/decide`, body); toast(`Сохранено. Новый итог: ${r.evaluation.totals.total}`); render(root); } catch (err) { toast(err.message, true); }
  };
  return el;
}

function decisionForm(c) {
  const input = c.type === "scale" && c.scale.steps?.length
    ? `<select name="score">${c.scale.steps.map((x) => `<option value="${x.value}">${x.value} — ${esc(x.label)}</option>`).join("")}</select>`
    : c.type === "scale"
    ? `<input name="score" type="number" min="${c.scale.min}" max="${c.scale.max}" value="${c.scale.max}" />`
    : `<select name="answer"><option value="yes">Да</option><option value="no">Нет</option></select>`;
  return `<form class="decide">
    <label>Новая оценка: ${input}</label>
    ${c.na_allowed ? '<label class="chk"><input type="checkbox" name="na" /> N/A</label>' : ""}
    <textarea name="reason" required placeholder="Причина решения"></textarea>
    <div><button name="action" value="uphold">Подтвердить исходную</button> <button name="action" value="change" class="primary">Изменить оценку</button></div>
  </form>`;
}
