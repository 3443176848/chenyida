import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./digest.mjs";
import { fail } from "./errors.mjs";

export class CheckpointStore {
  constructor(workspace, inputDigest) {
    this.workspace = workspace;
    this.inputDigest = inputDigest;
    this.path = resolve(workspace, "checkpoint.json");
  }

  async load() {
    let value;
    try { value = JSON.parse(await readFile(this.path, "utf8")); } catch (error) {
      if (error?.code === "ENOENT") return { checkpoints: [], state: "CREATED", digest: "" };
      fail("CHECKPOINT_INVALID", "checkpoint 无法解析");
    }
    if (value.input_digest !== this.inputDigest) fail("CHECKPOINT_STALE", "输入或映射已变化，旧 checkpoint 失效");
    const expected = sha256({ input_digest: value.input_digest, checkpoints: value.checkpoints, state: value.state });
    if (expected !== value.digest) fail("CHECKPOINT_INVALID", "checkpoint digest 不一致");
    return value;
  }

  async append(stage, state, summary = {}) {
    const current = await this.load();
    if (current.checkpoints.some((entry) => entry.stage === stage)) return current;
    const checkpoints = [...current.checkpoints, { stage, state, completed_at: new Date().toISOString(), summary }];
    const value = { schema_version: 1, input_digest: this.inputDigest, checkpoints, state };
    value.digest = sha256({ input_digest: value.input_digest, checkpoints, state });
    await mkdir(this.workspace, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
    return value;
  }
}
