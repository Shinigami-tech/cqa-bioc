import { api, esc, toast } from "../lib/api.js";

let draft = null; // edited copy of the active checklist

export async function render(root) {
  const st = await api("/api/checklists");
  const active = st.versions.find((v) => v.version === st.active);
  if (!draft) draft = structuredClone(active.checklist);
  const totalW = draft.criteria.reduce((s, c) => s + Number(c.weight || 0), 0);

  root.innerHTML = `
  <section class="pad">
    <div class="toolbar">
      <h2>Чек-лист</h2><span class="tag">активная версия v${st.active}</span>
      <input id="name" value="${esc(draft.name || "")}" placeholder="Название" style="flex:1" />
    </div>
    <div class="toolbar">
      <label>Макс. балл <input id="max" type="number" value="${draft.max_score ?? 100}" style="width:70px" /></label>
      <label>Округление, знаков <input id="dec" type="number" min="0" max="2" value="${draft.rounding?.decimals ?? 0}" style="width:50px" /></label>
      <label>Режим <select id="mode">${["half_up", "floor", "ceil"].map((m) => `<option ${m === (draft.rounding?.mode || "half_up") ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label class="chk"><input id="cz" type="checkbox" ${draft.critical_zeroes_total ? "checked" : ""}/> грубая ошибка обнуляет итог</label>
      <span class="muted">Сумма весов: <b>${totalW}</b></span>
    </div>
    <table class="grid edit">
      <thead><tr><th>ID</th><th>Секция</th><th>Критерий и правило «Да»</th><th>Вес</th><th>Тип</th><th>Шкала</th><th>N/A</th><th>Правило N/A</th><th title="Да = нарушение, без баллов">Грубая ошибка</th><th></th></tr></thead>
      <tbody>${draft.criteria.map((c, i) => `
        <tr data-i="${i}">
          <td><input data-k="id" value="${esc(c.id)}" class="mono" style="width:110px" /></td>
          <td><input data-k="section" value="${esc(c.section || "")}" style="width:110px" /></td>
          <td><input data-k="text" value="${esc(c.text)}" style="width:100%" /><textarea data-k="description" rows="2" placeholder="Когда ставить «Да»">${esc(c.description || "")}</textarea></td>
          <td><input data-k="weight" type="number" min="0" value="${c.weight}" style="width:60px" /></td>
          <td><select data-k="type"><option value="binary" ${c.type === "binary" ? "selected" : ""}>Да/Нет</option><option value="scale" ${c.type === "scale" ? "selected" : ""}>Шкала</option></select></td>
          <td>${c.type === "scale" ? `<input data-k="min" type="number" value="${c.scale?.min ?? 0}" style="width:58px" />–<input data-k="max" type="number" value="${c.scale?.max ?? 2}" style="width:58px" /><textarea data-k="steps" rows="3" title="Ступени: значение | описание, по одной в строке" placeholder="20 | Всё закрыто">${esc((c.scale?.steps || []).map((x) => `${x.value} | ${x.label}`).join("\n"))}</textarea>` : '<span class="muted">—</span>'}</td>
          <td><input data-k="na_allowed" type="checkbox" ${c.na_allowed ? "checked" : ""} /></td>
          <td><textarea data-k="na_rule" rows="2" ${c.na_allowed ? "" : "disabled"}>${esc(c.na_rule || "")}</textarea></td>
          <td><input data-k="critical" type="checkbox" ${c.critical ? "checked" : ""} /></td>
          <td><button data-del="${i}" title="Удалить">✕</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="toolbar">
      <button id="add">+ Критерий</button>
      <input id="note" placeholder="Комментарий к версии (например: заменён критерий 5)" style="flex:1" />
      <button id="reset">Сбросить изменения</button>
      <button id="save" class="primary">Сохранить как v${Math.max(...st.versions.map((v) => v.version)) + 1} и сделать активной</button>
    </div>
    <details><summary>История версий (${st.versions.length})</summary>
      <ul>${st.versions.slice().reverse().map((v) => `<li>v${v.version} · ${new Date(v.created_at).toLocaleString()} · ${v.checklist.criteria.length} критериев · ${esc(v.note)}</li>`).join("")}</ul>
    </details>
    <details><summary>Импорт / экспорт JSON</summary>
      <textarea id="json" rows="10" class="mono" style="width:100%">${esc(JSON.stringify(draft, null, 2))}</textarea>
      <button id="import">Применить JSON к черновику</button>
    </details>
  </section>`;

  const rerender = () => render(root);
  root.querySelector("tbody").addEventListener("change", (e) => {
    const tr = e.target.closest("tr"); const c = draft.criteria[tr.dataset.i]; const k = e.target.dataset.k;
    if (!k) return;
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "weight") c.weight = Number(v);
    else if (k === "min" || k === "max") c.scale = { ...(c.scale || {}), [k]: Number(v) };
    else if (k === "steps") c.scale = { ...(c.scale || {}), steps: v.split("\n").map((l) => l.split("|")).filter((p) => p[0].trim() !== "").map(([val, ...rest]) => ({ value: Number(val), label: rest.join("|").trim() })) };
    else if (k === "critical") { c.critical = v; c.critical_on = v ? "yes" : undefined; }
    else if (k === "type") { c.type = v; if (v === "scale" && !c.scale) c.scale = { min: 0, max: 2 }; return rerender(); }
    else if (k === "na_allowed") { c.na_allowed = v; return rerender(); }
    else c[k] = v;
    if (k === "weight") rerender();
  });
  root.querySelector("tbody").onclick = (e) => { const d = e.target.dataset.del; if (d !== undefined) { draft.criteria.splice(Number(d), 1); rerender(); } };
  root.querySelector("#name").onchange = (e) => (draft.name = e.target.value);
  root.querySelector("#max").onchange = (e) => (draft.max_score = Number(e.target.value));
  root.querySelector("#dec").onchange = (e) => (draft.rounding = { ...(draft.rounding || {}), decimals: Number(e.target.value) });
  root.querySelector("#mode").onchange = (e) => (draft.rounding = { ...(draft.rounding || {}), mode: e.target.value });
  root.querySelector("#cz").onchange = (e) => (draft.critical_zeroes_total = e.target.checked);
  root.querySelector("#add").onclick = () => { draft.criteria.push({ id: `c${draft.criteria.length + 1}`, section: "", text: "Новый критерий", weight: 10, type: "binary", na_allowed: false, critical: false, na_rule: "" }); rerender(); };
  root.querySelector("#reset").onclick = () => { draft = null; rerender(); };
  root.querySelector("#import").onclick = () => { try { draft = JSON.parse(root.querySelector("#json").value); rerender(); } catch (e) { toast("JSON: " + e.message, true); } };
  root.querySelector("#save").onclick = async () => {
    try {
      const r = await api("/api/checklist", { checklist: draft, note: root.querySelector("#note").value });
      toast(`Сохранено как v${r.version}. Перейдите в «Диалоги» → «Оценить все».`); draft = null; rerender();
    } catch (e) { toast(e.message, true); }
  };
}
