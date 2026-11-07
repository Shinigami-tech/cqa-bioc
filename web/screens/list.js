import { api, esc, toast, scoreHtml, fmt, channelIcon, LANG, runPool, debounce, ago } from "../lib/api.js";
import { refreshBadges } from "../app.js";

const st = { group: sessionStorage.getItem("cqa-group") || "", language: "", channel: "", q: "", status: "", sort: "conversation_id", dir: 1 };
let batch = null; // { ctrl, done, total, failed }
let keyHandler;

export function unmount() { removeEventListener("keydown", keyHandler); }

export async function render(root) {
  const [rows, groups] = await Promise.all([api(`/api/conversations${st.group ? `?group=${encodeURIComponent(st.group)}` : ""}`), api("/api/groups")]);
  sessionStorage.setItem("cqa-order", JSON.stringify(sortRows(filterRows(rows)).map((r) => r.conversation_id)));
  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <h1>Диалоги</h1><span class="sub" id="cnt"></span><span class="spacer"></span>
      <div class="toolbar" style="margin:0">
        <input class="input" id="gid" placeholder="group_id" value="${esc(st.group || "DEV")}" style="width:150px" />
        <button class="btn" id="load">⤓ Загрузить набор</button>
        <button class="btn primary" id="batch">▶ Оценить</button>
        <a class="btn" id="csv">⬇ CSV</a><a class="btn" id="json">⬇ JSON</a>
      </div>
    </div>
    <div class="card batchbar ${batch ? "" : "hidden"}" id="bb"><b id="bb-t"></b><div class="progress"><i id="bb-p"></i></div><span class="muted small" id="bb-f"></span><button class="btn ghost danger" id="bb-x">Остановить</button></div>
    <div class="card">
      <div class="toolbar" style="padding:12px 12px 0">
        <select class="input" id="f-group"><option value="">Все наборы</option>${groups.map((g) => `<option ${g === st.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
        <div class="seg" id="f-lang">${[["", "Все языки"], ["RU", "RU"], ["KZ", "KZ"], ["EN", "EN"]].map(([v, l]) => `<button data-v="${v}" class="${st.language === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="seg" id="f-ch">${[["", "Все"], ["agent chat", "💬 Чаты"], ["voice call", "📞 Звонки"]].map(([v, l]) => `<button data-v="${v}" class="${st.channel === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <select class="input" id="f-st">${[["", "Любой статус"], ["new", "Не оценены"], ["outdated", "Устарели (новый чек-лист)"], ["critical", "С грубой ошибкой"], ["review", "Нужна проверка"], ["appeal", "С апелляцией"]].map(([v, l]) => `<option value="${v}" ${st.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input class="input" id="q" placeholder="Поиск по ID или тексту  /" value="${esc(st.q)}" style="flex:1;min-width:180px" />
      </div>
      <div class="table-wrap"><table class="t"><thead><tr>
        ${th("conversation_id", "Диалог")}${th("channel", "Канал")}${th("language", "Язык")}<th>Запрос клиента</th>${th("total", "Итог")}<th>Отметки</th>${th("evaluated_at", "Оценён")}
      </tr></thead><tbody id="tb"></tbody></table></div>
    </div>
  </div>`;

  const draw = () => {
    const shown = sortRows(filterRows(rows));
    sessionStorage.setItem("cqa-order", JSON.stringify(shown.map((r) => r.conversation_id)));
    const scored = shown.filter((r) => r.total !== null);
    root.querySelector("#cnt").textContent = `${shown.length} показано · оценено ${scored.length} · средний ${scored.length ? fmt(scored.reduce((s, r) => s + r.total, 0) / scored.length) : "—"}`;
    root.querySelector("#tb").innerHTML = shown.map((r) => `
      <tr data-id="${esc(r.conversation_id)}">
        <td class="mono">${esc(r.conversation_id)}</td>
        <td>${channelIcon(r.channel)} ${r.channel === "voice call" ? "Звонок" : "Чат"}</td>
        <td><span class="pill">${esc(r.language)}</span></td>
        <td class="preview" title="${esc(r.preview)}">${esc(r.preview)}</td>
        <td>${scoreHtml(r.total)}${r.original_total !== null && r.original_total !== r.total ? ` <span class="muted small"><s>${fmt(r.original_total)}</s></span>` : ""}</td>
        <td><div class="flags">
          ${r.critical.length ? '<span class="pill bad">⚠ грубая ошибка</span>' : ""}
          ${r.low_confidence ? `<span class="pill mid">проверить ${r.low_confidence}</span>` : ""}
          ${r.appeals_open ? `<span class="pill info">апелляция</span>` : r.appeals_total ? `<span class="pill">пересмотрено</span>` : ""}
          ${r.outdated ? '<span class="pill">устарела</span>' : ""}
        </div></td>
        <td class="muted small">${r.evaluated_at ? ago(r.evaluated_at) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="7"><div class="empty"><b>Нет диалогов</b>Введите group_id и нажмите «Загрузить набор».</div></td></tr>`;
  };
  draw();

  const q = (s) => root.querySelector(s);
  const exp = (f) => `/api/export?format=${f}${st.group ? `&group=${encodeURIComponent(st.group)}` : ""}`;
  q("#csv").href = exp("csv"); q("#json").href = exp("json");
  q("#tb").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = `#/c/${encodeURIComponent(tr.dataset.id)}`; };
  root.querySelector("thead").onclick = (e) => { const k = e.target.closest("th")?.dataset.k; if (!k) return; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; render(root); };
  q("#f-group").onchange = (e) => { st.group = e.target.value; sessionStorage.setItem("cqa-group", st.group); render(root); };
  q("#f-lang").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.language = b.dataset.v; render(root); };
  q("#f-ch").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.channel = b.dataset.v; render(root); };
  q("#f-st").onchange = (e) => { st.status = e.target.value; draw(); };
  q("#q").oninput = debounce((e) => { st.q = e.target.value.trim().toLowerCase(); draw(); });

  q("#load").onclick = async (e) => {
    const gid = q("#gid").value.trim(); if (!gid) return;
    e.target.disabled = true;
    try { const r = await api(`/api/groups/${encodeURIComponent(gid)}/load`, {}); st.group = gid; sessionStorage.setItem("cqa-group", gid); toast(`Загружено диалогов: ${r.loaded}`); render(root); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  };

  // Batch: evaluate what is new or outdated (or everything with Shift-click), one request per dialog → live progress.
  q("#batch").onclick = async (e) => {
    if (batch) return;
    const shown = filterRows(rows);
    const todo = (e.shiftKey ? shown : shown.filter((r) => r.total === null && !r.evaluated_at || r.outdated)).map((r) => r.conversation_id);
    if (!todo.length) { toast("Всё уже оценено по актуальным чек-листам. Shift+клик — переоценить все показанные."); return; }
    batch = { ctrl: new AbortController(), t0: Date.now() };
    const bb = q("#bb"); bb.classList.remove("hidden");
    const upd = (d, n, f) => { q("#bb-t").textContent = `Оценка ${d} / ${n}`; q("#bb-p").style.width = `${(d / n) * 100}%`; q("#bb-f").textContent = `${((Date.now() - batch.t0) / 1000).toFixed(0)} с${f ? ` · ошибок ${f}` : ""}`; };
    upd(0, todo.length, 0);
    q("#bb-x").onclick = () => batch?.ctrl.abort();
    const res = await runPool(todo, 4, (cid) => api("/api/evaluate", { conversation_id: cid }), upd, batch.ctrl.signal);
    toast(`Готово: ${res.done} диалогов за ${((Date.now() - batch.t0) / 1000).toFixed(0)} с${res.failed ? `, ошибок ${res.failed}` : ""}`, res.failed > 0);
    batch = null; refreshBadges(); render(root);
  };

  keyHandler = (e) => { if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); q("#q").focus(); } };
  addEventListener("keydown", keyHandler);
}

function filterRows(rows) {
  return rows.filter((r) => (!st.language || r.language === st.language) && (!st.channel || r.channel === st.channel)
    && (!st.q || r.conversation_id.toLowerCase().includes(st.q) || r.preview.toLowerCase().includes(st.q))
    && (!st.status || (st.status === "new" && !r.evaluated_at) || (st.status === "outdated" && r.outdated) || (st.status === "critical" && r.critical.length)
      || (st.status === "review" && r.low_confidence) || (st.status === "appeal" && r.appeals_total)));
}
function sortRows(rows) {
  const k = st.sort;
  return [...rows].sort((a, b) => { const x = a[k] ?? -1, y = b[k] ?? -1; return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
}
const th = (k, l) => `<th data-k="${k}">${l} <span class="arr">${st.sort === k ? (st.dir > 0 ? "↑" : "↓") : ""}</span></th>`;
