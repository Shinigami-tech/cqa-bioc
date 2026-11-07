// Hash router. Each screen is a self-contained module: export async function render(root, params).
// That keeps every screen portable as a separate HTML web resource for Dynamics 365.
import * as list from "./screens/list.js";
import * as card from "./screens/card.js";
import * as checklist from "./screens/checklist.js";
import * as appeals from "./screens/appeals.js";
import { api } from "./lib/api.js";

const routes = [
  [/^#\/list$/, list],
  [/^#\/c\/([^/]+)$/, card],
  [/^#\/checklist$/, checklist],
  [/^#\/appeals$/, appeals],
];

async function route() {
  const hash = location.hash || "#/list";
  const root = document.getElementById("app");
  for (const a of document.querySelectorAll("nav a")) a.classList.toggle("on", hash.startsWith(a.getAttribute("href")));
  for (const [re, mod] of routes) {
    const m = hash.match(re);
    if (m) { root.innerHTML = '<div class="muted pad">Загрузка…</div>'; try { await mod.render(root, m.slice(1).map(decodeURIComponent)); } catch (e) { root.innerHTML = `<div class="pad err">${e.message}</div>`; } return; }
  }
  location.hash = "#/list";
}

addEventListener("hashchange", route);
api("/api/health").then((h) => { document.getElementById("status").textContent = `Модель: ${h.llm}`; }).catch(() => {});
route();
