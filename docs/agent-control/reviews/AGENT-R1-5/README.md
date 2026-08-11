# AGENT-R1-5 review evidence

This directory is an immutable audit trail for the synthetic R1.5 Native-Orchestrated Design MVP. It contains review contexts and receipts from multiple rejected candidates as well as the final implementation candidate. None of these artifacts authorizes ERP product changes, product Schema/Migration work, database or network access, UAT/production access, deployment, or unfreezing `PHASE4-TASK03`.

## Final acceptance set

The final implementation candidate is Git commit `25cbbfab87925a8601b844fe59c634ae0b651297`. Its acceptance set is limited to these exact Context Manifests and messages:

| Gate | Context Manifest | Message |
| --- | --- | --- |
| ERP contract | `contexts/erp-guardian-r1-5-25cbbfa.json` | `messages/erp-guardian-r1-5-25cbbfa.json` |
| Security | `contexts/security-r1-5-25cbbfa.json` | `messages/security-r1-5-25cbbfa.json` |
| Adversarial | `contexts/adversarial-r1-5-25cbbfa.json` | `messages/adversarial-r1-5-25cbbfa.json` |
| QA | `contexts/qa-r1-5-25cbbfa.json` | `messages/qa-r1-5-25cbbfa.json` |
| Source-blind black box | `contexts/blackbox-r1-5-25cbbfa.json` | `messages/blackbox-r1-5-25cbbfa.json` |

Each final message must validate against the final `message-v1.schema.json`, bind to the matching canonical Context Manifest digest, use the same candidate, revision, and lease, and have evidence locators equal to its declared input artifacts. The final gate decision uses only this set; earlier PASS, VETO, FAIL, and superseded-candidate receipts remain history rather than acceptance evidence.

## Historical receipts

Historical JSON is retained byte-for-byte so rejected candidates and repairs remain auditable. The protocol Schema evolved during the pilot; therefore a historical receipt is not rewritten merely to satisfy the final Schema. In particular, `messages/security-r1-5-2843b3d.json` is a pre-repair receipt whose old verification/disposition combination is intentionally rejected by the final conditional Schema. All Context Manifests still validate and retain correct canonical digests, all JSON parses, and message IDs are unique.

## Source-blind black-box run

The published observation is `blackbox/observed-report-25cbbfa.json`:

- byte digest: `sha256:0653f91f95a94be4057656d89e9473c5ff66033105171ed8873b5654a76f4678`;
- canonical report digest: `sha256:206bc6da9a4ea94f37510c8d8096e433a3d85decab6b5113899a453bf7b4136a`;
- four public risk-derived personas, all with expected results equal to observed results;
- isolation claim: `PUBLIC_FIXTURE_ONLY_NO_REPOSITORY_OR_GIT_MOUNT`.

Only one temporary container existed at a time. The first run, `agent-r1-5-blackbox-25cbbfa`, failed closed before execution because UID 65534 could not read the root-owned mode-0600 fixture. The second run, `agent-r1-5-blackbox-25cbbfa-r2`, used UID 0 only to read that fixture while retaining a read-only root filesystem, network `none`, all capabilities dropped, `no-new-privileges`, one read-only public-fixture bind, 256 MiB memory/swap, one CPU, and a 64-PID ceiling. It exited 0 with the published canonical observation. `docker diff` showed only the read-only `/fixture` mount in both attempts, neither attempt was OOM-killed, and both exact containers were removed.

Before the black-box work, available memory was 2.2 GiB, Swap use 357 MiB of 1.0 GiB, root free space 17 GiB, and load was `0.20 0.45 0.33`. After cleanup, the same values were 2.2 GiB, 357 MiB, 17 GiB, and `0.12 0.30 0.29`. Existing ERP-parallel containers remained at restart count 0 with no OOM flag; all four protected volumes remained present. The Compose status check failed closed before Compose execution because required environment values were absent, and it was not retried with any environment or secret file.

The independent black-box verifier receives only the final black-box Context Manifest, the public interface, the public persona set, and this emitted observation. It is forbidden from reading the runner, repository implementation, Git internals, owner input, product source, secrets, or any real environment.
