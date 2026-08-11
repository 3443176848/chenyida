import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const digest = (value) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const interfaceContract = JSON.parse(readFileSync("/fixture/interface.json", "utf8"));
const personaContract = JSON.parse(readFileSync("/fixture/personas.json", "utf8"));

if (interfaceContract.classification !== "PUBLIC_SYNTHETIC") {
  throw new Error("public synthetic interface required");
}

const observations = personaContract.personas.map((persona) => {
  const records = new Map();
  let accepted = 0;
  let replayed = 0;
  let rejected = 0;
  let appliedTotal = 0;

  for (const step of persona.steps) {
    if (!Number.isInteger(step.quantity) || step.quantity <= 0 || typeof step.request_id !== "string" || !step.request_id) {
      rejected += 1;
      continue;
    }
    const existing = records.get(step.request_id);
    if (step.action === "reconcile") {
      if (existing?.quantity === step.quantity) accepted += 1;
      else rejected += 1;
      continue;
    }
    if (existing) {
      if (existing.quantity === step.quantity) {
        accepted += 1;
        replayed += 1;
      } else {
        rejected += 1;
      }
      continue;
    }
    if (step.action !== "apply" && step.action !== "apply_unknown") {
      rejected += 1;
      continue;
    }
    records.set(step.request_id, { quantity: step.quantity });
    appliedTotal += step.quantity;
    if (step.action === "apply") accepted += 1;
  }

  const observed = { accepted, replayed, rejected, applied_total: appliedTotal };
  return {
    persona_id: persona.id,
    status: canonical(observed) === canonical(persona.expected) ? "PASS" : "FAIL",
    observed,
    expected: persona.expected,
  };
});

const report = {
  schema_version: "synthetic-blackbox-report/v1",
  isolation_claim: "PUBLIC_FIXTURE_ONLY_NO_REPOSITORY_OR_GIT_MOUNT",
  interface_digest: digest(interfaceContract),
  persona_digest: digest(personaContract),
  persona_count: observations.length,
  observations,
  status: observations.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
};
report.report_digest = digest(report);
process.stdout.write(`${canonical(report)}\n`);
process.exitCode = report.status === "PASS" ? 0 : 2;
