// Prompt parity fixture: the Python backend must send the model exactly what the JS reference sends.
import fs from "node:fs";
import { buildPrompt } from "../lib/evaluator.mjs";
const cases = JSON.parse(fs.readFileSync(new URL("./fixtures/facts.json", import.meta.url))).filter((_, i, a) => i % 10 === 0 || i === a.length - 1);
const cls = ["chat", "call"].map((f) => JSON.parse(fs.readFileSync(new URL(`../checklists/${f}.json`, import.meta.url))));
const out = cases.map((c) => { const cl = c.conv.channel === "voice call" ? cls[1] : cls[0]; return { conv: c.conv, checklist_id: cl.id, prompt: buildPrompt(c.conv, cl) }; });
fs.writeFileSync(new URL("./fixtures/prompts.json", import.meta.url), JSON.stringify(out));
console.log(out.length, "prompts");
