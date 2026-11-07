import { api, esc, fmt, scoreHtml, LANG, CHANNEL } from "../lib/api.js";

export async function render(root) {
  const groups = await api("/api/groups");
  const group = sessionStorage.getItem("cqa-group") || "";
  const s = await api(`/api/stats${group ? `?group=${encodeURIComponent(group)}` : ""}`);

  if (!s.conversations) {
    root.innerHTML = `<div class="page"><div class="page-head"><h1>Обзор</h1></div>
      <div class="card empty"><b>Данных пока нет</b>Загрузите набор диалогов на вкладке «Диалоги» (например, group_id = DEV).<br><br><a class="btn primary" href="#/list">Перейти к диалогам</a></div></div>`;
    return;
  }
  const maxD = Math.max(1, ...s.distribution.map((d) => d.n));
  const crit = s.criteria.filter((c) => !c.critical);
  const gross = s.criteria.find((c) => c.critical);

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <h1>Обзор качества</h1><span class="sub">${s.evaluated} из ${s.conversations} диалогов оценено</span>
      <span class="spacer"></span>
      <select class="input" id="grp"><option value="">Все наборы</option>${groups.map((g) => `<option ${g === group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <a class="btn" href="/api/export?format=csv${group ? `&group=${encodeURIComponent(group)}` : ""}">⬇ CSV</a>
    </div>

    <div class="grid-kpi">
      ${kpi("Средний балл", s.avg_total === null ? "—" : fmt(s.avg_total), "из 100")}
      ${kpi("Оценено", `${s.evaluated}<span class="muted" style="font-size:16px">/${s.conversations}</span>`, "диалогов")}
      ${kpi("Грубые ошибки", s.critical.length, s.critical.length ? "требуют разбора" : "не найдено", s.critical.length ? "var(--bad)" : "")}
      ${kpi("На проверку", s.low_confidence.length, "низкая уверенность модели", s.low_confidence.length ? "var(--mid)" : "")}
      ${kpi("Апелляции", s.appeals.open, `открыто · ${s.appeals.changed} изменено · ${s.appeals.upheld} подтверждено`)}
      ${kpi("Стоимость", `$${fmt(s.cost_usd, 4)}`, s.avg_ms ? `≈ ${fmt(s.avg_ms / 1000, 1)} с на диалог` : "")}
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-h">Выполнение критериев <span class="muted small" style="font-weight:400">доля баллов от максимума, без N/A</span></div>
        <div class="card-b">${crit.map((c) => hbar(c)).join("")}
          ${gross ? `<div class="hbar"><span>${esc(gross.name)}</span><span class="muted small">диалогов с нарушением из ${gross.n - gross.na}</span><b style="text-align:right;color:${gross.fails ? "var(--bad)" : "var(--good)"}">${gross.fails}</b></div>` : ""}
        </div></div>
      <div class="card"><div class="card-h">Распределение итоговых баллов</div>
        <div class="card-b"><div class="vbars">${s.distribution.map((d) => `<div class="col"><b>${d.n}</b><i style="height:${(d.n / maxD) * 100}%"></i><span>${d.from}–${d.to}</span></div>`).join("")}</div>
          <div class="grid-3" style="margin-top:18px;grid-template-columns:1fr 1fr">
            <div>${s.by_language.map((x) => `<div class="hbar" style="grid-template-columns:90px 1fr 48px"><span>${LANG[x.key] || esc(x.key)}</span><span class="muted small">${x.n} диал.</span>${scoreHtml(x.avg)}</div>`).join("")}</div>
            <div>${s.by_channel.map((x) => `<div class="hbar" style="grid-template-columns:70px 1fr 48px"><span>${CHANNEL[x.key] || esc(x.key)}</span><span class="muted small">${x.n} диал.</span>${scoreHtml(x.avg)}</div>`).join("")}</div>
          </div>
        </div></div>
    </div>

    <div class="grid-3">
      <div class="card"><div class="card-h">⚠ Грубые ошибки</div><div class="card-b list-links">${s.critical.slice(0, 8).map((c) => `<a href="#/c/${encodeURIComponent(c.conversation_id)}"><span class="mono">${esc(c.conversation_id)}</span>${scoreHtml(c.total)}</a>`).join("") || '<span class="muted">Не найдено</span>'}${s.critical.length > 8 ? `<a href="#/list">ещё ${s.critical.length - 8} →</a>` : ""}</div></div>
      <div class="card"><div class="card-h">🔎 Нужна проверка человеком</div><div class="card-b list-links">${s.low_confidence.slice(0, 8).map((c) => `<a href="#/c/${encodeURIComponent(c.conversation_id)}"><span class="mono">${esc(c.conversation_id)}</span><span class="pill mid">${c.criteria.length} крит.</span></a>`).join("") || '<span class="muted">Модель уверена во всех оценках</span>'}${s.low_confidence.length > 8 ? `<a href="#/list">ещё ${s.low_confidence.length - 8} →</a>` : ""}</div></div>
      <div class="card"><div class="card-h">Как это работает</div><div class="card-b small ink2">
        1. Код извлекает факты из диалога: язык, задержки, системные события.<br>
        2. Модель оценивает каждый критерий и ссылается на реплики.<br>
        3. Код проверяет ответ, считает баллы с весами и N/A.<br>
        4. Спорные оценки уходят на апелляцию и ручную проверку.</div></div>
    </div>
  </div>`;
  root.querySelector("#grp").onchange = (e) => { sessionStorage.setItem("cqa-group", e.target.value); render(root); };
}

const kpi = (l, v, d, color = "") => `<div class="card kpi"><div class="l">${l}</div><div class="v" ${color ? `style="color:${color}"` : ""}>${v}</div><div class="d">${d}</div></div>`;

function hbar(c) {
  const pct = c.rate === null ? null : Math.round(c.rate * 100);
  const col = pct === null ? "var(--line)" : pct >= 85 ? "var(--good)" : pct >= 65 ? "var(--mid)" : "var(--bad)";
  return `<div class="hbar"><span>${esc(c.name)}</span><span class="track"><i style="width:${pct ?? 0}%;background:${col}"></i></span><b style="text-align:right">${pct === null ? "N/A" : pct + "%"}</b></div>`;
}
