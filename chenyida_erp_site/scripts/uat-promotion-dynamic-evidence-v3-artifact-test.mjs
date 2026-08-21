#!/usr/bin/env node

import { createHash } from "node:crypto";

import {
  DynamicEvidenceV3Error,
  digestValue,
  loadAndValidateArtifact,
  loadAndValidatePolicy,
  validateArtifact,
} from "./uat-promotion-dynamic-evidence-v3.mjs";


function rehash(value, field) {
  const body = structuredClone(value);
  delete body[field];
  value[field] = digestValue(body);
}


function selectedCase(artifact) {
  if (!Array.isArray(artifact.cases) || artifact.cases.length !== 1) {
    throw new Error("TASK70_V3_ARTIFACT_TEST_FIXTURE_INVALID");
  }
  return artifact.cases[0];
}


function scenarioById(caseEvidence, id) {
  const value = caseEvidence.scenarios.find((item) => item.scenario_id === id);
  if (!value) throw new Error("TASK70_V3_ARTIFACT_TEST_FIXTURE_INVALID");
  return value;
}


function rehashCaseAndArtifact(artifact, caseEvidence, scenario = null) {
  if (scenario !== null) {
    const previous = scenario.scenario_sha256;
    rehash(scenario, "scenario_sha256");
    const replace = (value) => {
      let count = 0;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (value[index] === previous) {
            value[index] = scenario.scenario_sha256;
            count += 1;
          } else if (value[index] && typeof value[index] === "object") {
            count += replace(value[index]);
          }
        }
      } else if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          if (value[key] === previous) {
            value[key] = scenario.scenario_sha256;
            count += 1;
          } else if (value[key] && typeof value[key] === "object") {
            count += replace(value[key]);
          }
        }
      }
      return count;
    };
    let replacements = 0;
    for (const assertion of caseEvidence.assertions) {
      if (replace(assertion.evidence) > 0) {
        assertion.evidence_sha256 = digestValue(assertion.evidence);
        replacements += 1;
      }
    }
    if (replacements < 1) {
      throw new Error("TASK70_V3_ARTIFACT_TEST_FIXTURE_INVALID");
    }
  }
  rehash(caseEvidence, "case_evidence_sha256");
  rehash(artifact, "artifact_sha256");
}


function requireMutationRejected(label, artifact, policy, mutate) {
  const changed = structuredClone(artifact);
  mutate(changed);
  try {
    validateArtifact(changed, policy);
  } catch (error) {
    if (error instanceof DynamicEvidenceV3Error) return error.code;
    throw error;
  }
  throw new Error(`TASK70_V3_ARTIFACT_MUTATION_ACCEPTED:${label}`);
}


function main() {
  const policy = loadAndValidatePolicy();
  const artifact = loadAndValidateArtifact(policy);
  validateArtifact(structuredClone(artifact), policy);
  const rejected = {};

  rejected.canonical_gzip = requireMutationRejected(
    "canonical_gzip", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const evidence = caseEvidence.opcodes.production_sql_evidence;
      const compressed = Buffer.from(evidence.gzip_base64, "base64");
      compressed[4] = 1;
      evidence.gzip_base64 = compressed.toString("base64");
      evidence.gzip_sha256 = createHash("sha256").update(compressed).digest("hex");
      rehash(evidence, "sql_evidence_sha256");
      rehashCaseAndArtifact(changed, caseEvidence);
    },
  );

  rejected.recovery_classification = requireMutationRejected(
    "recovery_classification", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(
        caseEvidence, "PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY",
      );
      scenario.recovery_classification.layout = "MIXED";
      rehash(scenario.recovery_classification, "classification_sha256");
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.migration_receipt = requireMutationRejected(
    "migration_receipt", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const migration = caseEvidence.fixture.migration;
      const receipt = migration.ordered_apply_receipts[0].execution_receipt;
      receipt.execution.database = "postgres";
      rehash(receipt.execution, "execution_sha256");
      rehash(receipt, "receipt_sha256");
      migration.apply_receipt_set_sha256 = digestValue(migration.ordered_apply_receipts);
      rehashCaseAndArtifact(changed, caseEvidence);
    },
  );

  rejected.fault_receipt = requireMutationRejected(
    "fault_receipt", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(caseEvidence, "FIRST_RENAME_FAULT_ROLLBACK");
      const command = scenario.fault_command_receipt;
      const receipt = command.execution_receipt;
      receipt.execution.database = "postgres";
      rehash(receipt.execution, "execution_sha256");
      rehash(receipt, "receipt_sha256");
      rehash(command, "command_receipt_sha256");
      scenario.fault_command_receipt_sha256 = command.command_receipt_sha256;
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.fixed_success_argv = requireMutationRejected(
    "fixed_success_argv", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(caseEvidence, "EXACT_V3_SUCCESS");
      const receipt = scenario.execution_receipt;
      const index = receipt.arguments.indexOf("--username=postgres");
      if (index < 0) throw new Error("TASK70_V3_ARTIFACT_TEST_FIXTURE_INVALID");
      receipt.arguments[index] = "--username=chenyida_erp_owner";
      receipt.arguments_sha256 = digestValue(receipt.arguments);
      rehash(receipt, "execution_receipt_sha256");
      scenario.command.execution_receipt_sha256 = receipt.execution_receipt_sha256;
      rehash(scenario.command, "command_projection_sha256");
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.fixed_success_stdout = requireMutationRejected(
    "fixed_success_stdout", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(caseEvidence, "EXACT_V3_SUCCESS");
      const receipt = scenario.execution_receipt;
      const raw = Buffer.from("f\n", "ascii");
      receipt.stdout_base64 = raw.toString("base64");
      receipt.stdout_bytes = raw.length;
      receipt.stdout_sha256 = createHash("sha256").update(raw).digest("hex");
      rehash(receipt, "execution_receipt_sha256");
      scenario.mutation_ack.stdout_bytes = raw.length;
      scenario.mutation_ack.stdout_sha256 = receipt.stdout_sha256;
      rehash(scenario.mutation_ack, "ack_sha256");
      scenario.mutation_ack_sha256 = scenario.mutation_ack.ack_sha256;
      Object.assign(scenario.command, {
        mutation_ack_sha256: scenario.mutation_ack.ack_sha256,
        stdout_bytes: raw.length,
        stdout_sha256: receipt.stdout_sha256,
        execution_receipt_sha256: receipt.execution_receipt_sha256,
      });
      rehash(scenario.command, "command_projection_sha256");
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.fixed_content_stderr = requireMutationRejected(
    "fixed_content_stderr", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(caseEvidence, "CONTENT_DRIFT_REJECTED");
      const receipt = scenario.execution_receipt;
      const raw = Buffer.from(receipt.stderr_base64, "base64");
      raw[0] ^= 0x80;
      receipt.stderr_base64 = raw.toString("base64");
      receipt.stderr_bytes = raw.length;
      receipt.stderr_sha256 = createHash("sha256").update(raw).digest("hex");
      rehash(receipt, "execution_receipt_sha256");
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.journal = requireMutationRejected(
    "journal", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const journal = caseEvidence.journal_evidence.recovery;
      journal.event_count += 1;
      rehash(journal, "journal_projection_sha256");
      const scenario = scenarioById(
        caseEvidence, "PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY",
      );
      scenario.journal_projection_sha256 = journal.journal_projection_sha256;
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.terminal = requireMutationRejected(
    "terminal", artifact, policy, (changed) => {
      const caseEvidence = selectedCase(changed);
      const scenario = scenarioById(
        caseEvidence, "PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY",
      );
      scenario.terminal_evidence.restored_database_sessions_at_commit = 1;
      scenario.terminal_evidence_sha256 = digestValue(scenario.terminal_evidence);
      rehashCaseAndArtifact(changed, caseEvidence, scenario);
    },
  );

  rejected.cleanup = requireMutationRejected(
    "cleanup", artifact, policy, (changed) => {
      changed.cleanup.remaining_containers = ["f".repeat(64)];
      rehash(changed.cleanup, "cleanup_receipt_sha256");
      rehash(changed, "artifact_sha256");
    },
  );

  rejected.resource_wall_clock = requireMutationRejected(
    "resource_wall_clock", artifact, policy, (changed) => {
      const capturedAt = changed.resource_gate.samples[0].captured_at;
      for (const sample of changed.resource_gate.samples) sample.captured_at = capturedAt;
      rehash(changed.resource_gate, "resource_evidence_sha256");
      rehash(changed, "artifact_sha256");
    },
  );

  process.stdout.write(`${JSON.stringify({
    result: "PASS",
    artifact_sha256: artifact.artifact_sha256,
    rejected_mutations: rejected,
  })}\n`);
}


main();
