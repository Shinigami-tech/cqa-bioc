// Hash router. Each screen is a self-contained module: export async function render(root, params).
import * as dashboard from "./screens/dashboard.js";
import * as list from "./screens/list.js";
import * as card from "./screens/card.js";
import * as checklists from "./screens/checklists.js";
import * as appeals from "./screens/appeals.js";
import { api } from "./lib/api.js";

const routes = [
  [/^#\/dashboard$/, dashboard, "dashboard"],
  [/^#\/list$/, list, "list"],
  [/^#\/c\/([^/]+)$/, card, "list"],
  [/^#\/checklists(?:\/([^/]+))?$/, checklists, "checklists"],
  [/^#\/appeals$/, appeals, "appeals"],
];

let current = null;
async function route() {
  const hash = location.hash || "#/dashboard";
  const root = document.getElementById("app");
  for (const [re, mod, nav] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("on", a.dataset.r === nav);
    current?.unmount?.();
    current = mod;
    root.innerHTML = '<div class="page"><div class="skel" style="width:220px;height:26px;margin-bottom:18px"></div><div class="skel" style="height:300px"></div></div>';
    try { await mod.render(root, m.slice(1).filter(Boolean).map(decodeURIComponent)); }
    catch (e) { root.innerHTML = `<div class="page"><div class="banner bad">${e.message}</div></div>`; }
    refreshBadges();
    return;
  }
  location.hash = "#/dashboard";
}

export async function refreshBadges() {
  try {
    const open = (await api("/api/appeals?status=open")).length;
    const b = document.getElementById("ap-count"); b.textContent = open; b.classList.toggle("hidden", !open);
  } catch {}
}

document.getElementById("theme").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("cqa-theme", t); } catch {}
};
// Accessibility mode (low vision): bigger type, high contrast, larger targets, no motion. Remembered per browser.
const a11yBtn = document.getElementById("a11y");
const setA11y = (on) => { document.documentElement.dataset.a11y = on ? "on" : ""; a11yBtn.setAttribute("aria-pressed", String(on)); try { localStorage.setItem("cqa-a11y", on ? "on" : ""); } catch {} };
setA11y(document.documentElement.dataset.a11y === "on");
a11yBtn.onclick = () => setA11y(document.documentElement.dataset.a11y !== "on");
const zoom = (d) => { const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1; const z = Math.min(1.6, Math.max(0.85, +(cur + d).toFixed(2))); document.documentElement.style.setProperty("--zoom", z); try { localStorage.setItem("cqa-zoom", z); } catch {} };
document.getElementById("zoom-in").onclick = () => zoom(0.1);
document.getElementById("zoom-out").onclick = () => zoom(-0.1);

api("/api/health").then((h) => {
  document.getElementById("model").textContent = h.llm === "MOCK" ? "MOCK — модель не подключена" : `${h.llm}${h.votes > 1 ? ` · ${h.votes} голоса` : ""}`;
  document.getElementById("model-dot").classList.toggle("mock", h.llm === "MOCK");
}).catch(() => {});
addEventListener("hashchange", route);
route();
