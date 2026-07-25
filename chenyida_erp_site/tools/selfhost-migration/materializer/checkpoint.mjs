import { CheckpointStore } from "../checkpoint.mjs";

export class MaterializerCheckpointStore extends CheckpointStore {
  async complete(stage, summary = {}) { return this.append(`Materialize:${stage}`, "COMMITTING", summary); }
}
