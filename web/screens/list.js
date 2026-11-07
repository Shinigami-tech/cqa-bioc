import { api, esc, toast } from "../lib/api.js";

let filters = { group: "", language: "", channel: "", q: "" };

export async function render(root) {
  const rows = await api(`/api/conversations${filters.group ? `?group=${encodeURIComponent(filters.group)}` : ""}`);
  const groups = [...new Set(rows.map((r) => r.group_id))];
  const shown = rows.filter((r) => (!filters.language || r.language === filters.language) && (!filters.channel || r.channel === filters.channel) && (!filters.q || r.conversation_id.includes(filters.q)));
  const scored = shown.filter((r) => r.total !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.total, 0) / scored.length) : "—";

  root.innerHTML = `
  <section class="pad">
    <div class="toolbar">
      <input id="gid" placeholder="group_id (DEV / контрольный)" value="${esc(filters.group || "DEV")}" />
      <button id="load">Загрузить набор</button>
      <button id="batch" class="primary">Оценить все${filters.group ? ` (${esc(filters.group)})` : ""}</button>
      <label class="chk"><input type="checkbox" id="missing" checked /> только без оценки по текущему чек-листу</label>
    </div>
    <div class="toolbar">
      <select id="f-group"><option value="">Все наборы</option>${groups.map((g) => `<option ${g === filters.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <select id="f-lang"><option value="">Все языки</option>${["RU", "KZ", "EN"].map((l) => `<option ${l === filters.language ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select id="f-ch"><option value="">Все каналы</option>${["agent chat", "voice call"].map((l) => `<option ${l === filters.channel ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input id="f-q" placeholder="поиск по ID" value="${esc(filters.q)}" />
      <span class="muted">${shown.length} диалогов · оценено ${scored.length} · средний балл ${avg}</span>
    </div>
    <table class="grid">
      <thead><tr><th>ID</th><th>Канал</th><th>Язык</th><th>Реплик</th><th>Итог</th><th>Грубая ошибка</th><th>Апелляции</th><th>Чек-лист</th></tr></thead>
      <tbody>${shown.map((r) => `
        <tr data-id="${esc(r.conversation_id)}">
          <td class="mono">${esc(r.conversation_id)}</td>
          <td>${r.channel === "voice call" ? "📞 звонок" : "💬 чат"}</td>
          <td>${esc(r.language)}</td><td>${r.lines}</td>
          <td>${r.total === null ? '<span class="muted">—</span>' : `<b class="${scoreClass(r.total)}">${r.total}</b>`}</td>
          <td>${r.critical ? '<span class="tag bad">⚠ есть</span>' : ""}</td>
          <td>${r.appeals_open ? `<span class="tag warn">открыто ${r.appeals_open}</span>` : r.appeals_total ? `<span class="tag">${r.appeals_total}</span>` : ""}</td>
          <td class="muted">${r.checklist_version ? "v" + r.checklist_version : ""}</td>
        </tr>`).join("") || `<tr><td colspan="8" class="muted pad">Нет данных. Введите group_id и нажмите «Загрузить набор».</td></tr>`}
      </tbody>
    </table>
  </section>`;

  root.querySelector("tbody").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = `#/c/${encodeURIComponent(tr.dataset.id)}`; };
  const rerender = () => render(root);
  root.querySelector("#f-group").onchange = (e) => { filters.group = e.target.value; rerender(); };
  root.querySelector("#f-lang").onchange = (e) => { filters.language = e.target.value; rerender(); };
  root.querySelector("#f-ch").onchange = (e) => { filters.channel = e.target.value; rerender(); };
  root.querySelector("#f-q").onchange = (e) => { filters.q = e.target.value.trim(); rerender(); };
  root.querySelector("#load").onclick = async () => {
    const gid = root.querySelector("#gid").value.trim(); if (!gid) return;
    try { const r = await api(`/api/groups/${encodeURIComponent(gid)}/load`, {}); filters.group = gid; toast(`Загружено ${r.loaded}`); rerender(); } catch (e) { toast(e.message, true); }
  };
  root.querySelector("#batch").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Оцениваю…";
    try {
      const r = await api("/api/evaluate-batch", { group_id: filters.group || undefined, only_missing: root.querySelector("#missing").checked });
      const failed = r.results.filter((x) => !x.ok).length;
      toast(`Оценено ${r.count} за ${(r.ms / 1000).toFixed(1)} с · $${r.cost_usd}${failed ? ` · ошибок ${failed}` : ""}`, failed > 0);
    } catch (err) { toast(err.message, true); }
    rerender();
  };
}

export const scoreClass = (t) => (t >= 80 ? "good" : t >= 60 ? "mid" : "low");
