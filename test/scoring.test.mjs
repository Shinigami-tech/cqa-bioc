import test from "node:test";
import assert from "node:assert/strict";
import { computeTotals, round, validateChecklist } from "../lib/scoring.mjs";
import { sanitize } from "../lib/evaluator.mjs";

const cl = {
  max_score: 100, rounding: { decimals: 0, mode: "half_up" },
  criteria: [
    { id: "a", text: "t", section: "S1", weight: 50, type: "binary" },
    { id: "b", text: "t", section: "S1", weight: 30, type: "scale", scale: { min: 0, max: 2 }, na_allowed: true },
    { id: "c", text: "t", section: "S2", weight: 20, type: "binary", na_allowed: true },
    { id: "x", text: "t", weight: 0, type: "binary", critical: true },
  ],
};

test("weighted scale score", () => {
  const t = computeTotals(cl, [
    { criterion_id: "a", answer: "yes" }, { criterion_id: "b", score: 1 }, { criterion_id: "c", answer: "no" }, { criterion_id: "x", answer: "yes" },
  ]);
  assert.equal(t.total, 65); // 50 + 30*0.5 + 0
  assert.deepEqual(t.critical_errors, []);
});

test("N/A weight is redistributed over applicable criteria", () => {
  const t = computeTotals(cl, [
    { criterion_id: "a", answer: "yes" }, { criterion_id: "b", na: true }, { criterion_id: "c", answer: "no" }, { criterion_id: "x", answer: "yes" },
  ]);
  assert.equal(t.total, round((50 / 70) * 100)); // 71
  assert.equal(t.rows.find((r) => r.id === "b").effective_weight, 0);
});

test("sections and critical error flag", () => {
  const t = computeTotals({ ...cl, critical_zeroes_total: true }, [
    { criterion_id: "a", answer: "yes" }, { criterion_id: "b", score: 2 }, { criterion_id: "c", na: true }, { criterion_id: "x", answer: "no" },
  ]);
  assert.equal(t.sections.S1, 100);
  assert.equal(t.sections.S2, null);
  assert.deepEqual(t.critical_errors, ["x"]);
  assert.equal(t.total, 0);
  assert.equal(t.raw_total, 100);
});

test("rounding modes", () => {
  assert.equal(round(71.45, { decimals: 1 }), 71.5);
  assert.equal(round(71.99, { decimals: 0, mode: "floor" }), 71);
});

test("checklist validation", () => {
  assert.deepEqual(validateChecklist(cl), []);
  assert.ok(validateChecklist({ criteria: [{ id: "a", text: "t", weight: 1, type: "scale", scale: { min: 2, max: 2 } }] }).length);
});

test("sanitize drops bad evidence and illegal N/A", () => {
  const conv = { transcript: [{}, {}, {}] };
  const { results, problems } = sanitize(conv, { criteria: [{ id: "a", text: "t", type: "binary", na_allowed: false }] }, { results: [{ criterion_id: "a", na: true, evidence_ids: [1, 9] }] });
  assert.equal(results[0].na, false);
  assert.deepEqual(results[0].evidence_ids, [1]);
  assert.equal(problems.length, 2);
});
