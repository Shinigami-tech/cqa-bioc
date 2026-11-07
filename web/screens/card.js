import { api, esc, toast, verdict, offsetSec, mmss } from "../lib/api.js";
import { scoreClass } from "./list.js";

const SPEAKER = { operator: "Оператор", client: "Клиент", bot: "Бот", system: "Система" };

export async function render(root, [cid]) {
  const { conversation: conv, evaluation: ev } = await api(`/api/conversations/${encodeURIComponent(cid)}`);
  const isCall = conv.channel === "voice call";

  root.innerHTML = `
  <section class="pad">
    <div class="toolbar">
      <a href="#/list">← к списку</a>
      <h2 class="mono">${esc(conv.conversation_id)}</h2>
      <span class="tag">${isCall ? "📞 звонок" : "💬 чат"}</span><span class="tag">${esc(conv.language)}</span>
      ${isCall && conv.audio_url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(conv.audio_url)}">▶ Открыть запись</a>` : ""}
      <button id="eval" class="primary">${ev ? "Переоценить" : "Оценить"}</button>
    </div>
    <div class="split">
      <div class="transcript" id="tr">${conv.transcript.map((t, i) => `
        <div class="line sp-${t.speaker}" id="m${i}" data-i="${i}">
          <span class="idx">${i}</span>
          <span class="ts" ${isCall ? `title="Позиция в записи"` : ""}>${isCall ? mmss(offsetSec(conv.transcript, i)) : esc(t.timestamp)}</span>
          <span class="who">${SPEAKER[t.speaker] || esc(t.speaker)}</span>
          <span class="txt">${esc(t.text)}</span>
        </div>`).join("")}
      </div>
      <div class="result">${ev ? resultHtml(ev, conv) : '<p class="muted">Оценки ещё нет. Нажмите «Оценить».</p>'}</div>
    </div>
  </section>`;

  root.querySelector("#eval").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Оцениваю…";
    try { await api("/api/evaluate", { conversation_id: cid }); toast("Готово"); } catch (err) { toast(err.message, true); }
    render(root, [cid]);
  };

  // Evidence → scroll to and highlight the line(s); checked span → highlight the range.
  root.querySelector(".result").onclick = async (e) => {
    const ev1 = e.target.closest("[data-ev]");
    if (ev1) return focusLines(root, ev1.dataset.ev.split(",").map(Number), isCall ? conv : null);
    const sp = e.target.closest("[data-span]");
    if (sp) { const [a, b = a] = sp.dataset.span.split("-").map(Number); return focusLines(root, range(a, b), null, "span"); }
    const ap = e.target.closest("[data-appeal]");
    if (ap) return openAppealForm(ap.closest(".crit"), ap.dataset.appeal, ev, root, cid);
  };
}

function resultHtml(ev, conv) {
  const t = ev.totals, o = ev.original_totals;
  const changed = t.total !== o.total;
  const sections = Object.entries(t.sections);
  return `
  <div class="total">
    <div><div class="muted">Итог</div><div class="big ${t.total === null ? "" : scoreClass(t.total)}">${t.total ?? "N/A"}<small>/${t.max_score}</small></div>
      ${changed ? `<div class="muted">исходный: <s>${o.total}</s> → после апелляции: <b>${t.total}</b></div>` : ""}</div>
    ${t.critical_errors.length ? `<div class="tag bad big-tag">⚠ Грубая ошибка: ${t.critical_errors.map(esc).join(", ")}</div>` : ""}
    ${sections.length ? `<div class="sections">${sections.map(([n, v]) => `<div><span class="muted">${esc(n)}</span><b>${v ?? "N/A"}</b></div>`).join("")}</div>` : ""}
    <div class="muted small">Чек-лист v${ev.checklist_version} · ${esc(ev.model)} · ${ev.ms} мс${ev.cost_usd ? ` · $${ev.cost_usd}` : ""}</div>
  </div>
  ${ev.checklist.criteria.map((c) => {
    const r = ev.final_results.find((x) => x.criterion_id === c.id);
    const orig = ev.results.find((x) => x.criterion_id === c.id);
    const row = t.rows.find((x) => x.id === c.id);
    const aps = ev.appeals.filter((a) => a.criterion_id === c.id);
    const open = aps.find((a) => a.status === "open");
    return `
    <div class="crit ${r.na ? "na" : ""} ${t.critical_errors.includes(c.id) ? "critical" : ""}">
      <div class="crit-head">
        <b>${esc(c.text)}</b>
        <span class="verdict">${verdict(c, r)}</span>
      </div>
      <div class="meta">
        вес ${c.weight}${row?.applicable ? ` → ${(row.effective_weight * 100).toFixed(1)}% · ${row.points.toFixed(1)} балл.` : " · не учитывается"}
        ${c.critical ? ' · <span class="tag bad">критичный</span>' : ""}
        ${r.overridden ? ` · <span class="tag warn">изменено проверяющим (было: ${verdict(c, orig)})</span>` : ""}
      </div>
      <p>${r.na ? `<b>N/A:</b> ${esc(r.na_reason)}` : esc(r.explanation)}</p>
      <div class="links">
        ${r.evidence_ids?.length ? `<a href="javascript:void 0" data-ev="${r.evidence_ids.join(",")}">↳ реплики ${r.evidence_ids.map((i) => "#" + i).join(", ")}</a>` : ""}
        ${r.checked_span ? `<a href="javascript:void 0" data-span="${esc(r.checked_span)}">🔎 проверенный участок ${esc(r.checked_span)}</a>` : ""}
        ${open ? '<span class="tag warn">апелляция на рассмотрении</span>' : `<a href="javascript:void 0" data-appeal="${c.id}">Оспорить</a>`}
      </div>
      ${aps.filter((a) => a.status !== "open").map((a) => `<div class="small muted">Апелляция: «${esc(a.comment)}» → ${a.status === "upheld" ? "оценка подтверждена" : "оценка изменена"}: ${esc(a.decision?.reason)}</div>`).join("")}
    </div>`;
  }).join("")}`;
}

function focusLines(root, ids, callConv, cls = "hit") {
  root.querySelectorAll(".line.hit,.line.span").forEach((n) => n.classList.remove("hit", "span"));
  ids.forEach((i) => root.querySelector(`#m${i}`)?.classList.add(cls));
  root.querySelector(`#m${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (callConv) toast(`Фрагмент записи: ${mmss(offsetSec(callConv.transcript, ids[0]))} — откройте запись и перейдите к этой минуте`);
}

function openAppealForm(box, criterionId, ev, root, cid) {
  if (box.querySelector("form")) return;
  const f = document.createElement("form");
  f.className = "appeal";
  f.innerHTML = `<textarea required placeholder="Почему оценка неверна? Укажите реплику."></textarea><div><button class="primary">Отправить апелляцию</button> <button type="button" class="cancel">Отмена</button></div>`;
  box.append(f);
  f.querySelector(".cancel").onclick = () => f.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/appeals", { evaluation_id: ev.id, criterion_id: criterionId, comment: f.querySelector("textarea").value }); toast("Апелляция сохранена"); render(root, [cid]); }
    catch (err) { toast(err.message, true); }
  };
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) + 1 }, (_, k) => a + k);
