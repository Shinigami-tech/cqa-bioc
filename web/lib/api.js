export async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 3500);
}

// Human label for one criterion result.
export function verdict(c, r) {
  if (!r) return "—";
  if (r.na) return "N/A";
  if (c.type === "scale") return `${r.score} / ${c.scale.max}`;
  if (c.critical_on === "yes") return r.answer === "yes" ? "Да — нарушение" : "Нет";
  return r.answer === "yes" ? "Да" : "Нет";
}

// Seconds from the first line (calls use ISO timestamps, chats use MM:SS).
export function offsetSec(transcript, i) {
  const t = transcript[i]?.timestamp, t0 = transcript[0]?.timestamp;
  if (!t) return 0;
  if (/^\d+:\d{2}$/.test(t)) { const [m, s] = t.split(":").map(Number); return m * 60 + s; }
  return Math.max(0, Math.round((Date.parse(t) - Date.parse(t0)) / 1000));
}
export const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
