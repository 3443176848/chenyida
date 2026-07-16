export type MaterialImportHashState = "IDLE" | "HASHING" | "COMPLETED" | "CANCELLED" | "FAILED";
export type MaterialImportHashSnapshot = {
  state: MaterialImportHashState; processedBytes: number; totalBytes: number; sha256: string; message: string;
};

type WorkerMessage = {
  type: "PROGRESS" | "COMPLETED" | "CANCELLED" | "FAILED"; processedBytes?: number; totalBytes?: number; sha256?: string; message?: string;
};

export class MaterialImportHashWorkerController {
  #worker: Worker | null = null;
  #snapshot: MaterialImportHashSnapshot = { state: "IDLE", processedBytes: 0, totalBytes: 0, sha256: "", message: "" };
  #listener: ((snapshot: MaterialImportHashSnapshot) => void) | null = null;
  #factory: () => Worker;

  constructor(factory: () => Worker = () => new Worker(new URL("./material-import-hash.worker.ts", import.meta.url), { type: "module", name: "material-import-sha256" })) {
    this.#factory = factory;
  }

  get snapshot(): MaterialImportHashSnapshot { return { ...this.#snapshot }; }

  start(file: File, listener: (snapshot: MaterialImportHashSnapshot) => void): void {
    this.cancel(); this.#listener = listener; this.#snapshot = { state: "HASHING", processedBytes: 0, totalBytes: file.size, sha256: "", message: "" };
    listener(this.snapshot); const worker = this.#factory(); this.#worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      if (worker !== this.#worker) return;
      const message = event.data;
      if (message.type === "PROGRESS") this.#snapshot = { ...this.#snapshot, processedBytes: Number(message.processedBytes || 0), totalBytes: Number(message.totalBytes || file.size) };
      else if (message.type === "COMPLETED") this.#snapshot = { state: "COMPLETED", processedBytes: file.size, totalBytes: file.size, sha256: String(message.sha256 || ""), message: "" };
      else if (message.type === "CANCELLED") this.#snapshot = { state: "CANCELLED", processedBytes: 0, totalBytes: file.size, sha256: "", message: "" };
      else this.#snapshot = { state: "FAILED", processedBytes: 0, totalBytes: file.size, sha256: "", message: String(message.message || "无法计算文件摘要") };
      this.#listener?.(this.snapshot);
      if (["COMPLETED", "CANCELLED", "FAILED"].includes(this.#snapshot.state)) { worker.terminate(); if (worker === this.#worker) this.#worker = null; }
    });
    worker.addEventListener("error", () => {
      if (worker !== this.#worker) return;
      this.#snapshot = { state: "FAILED", processedBytes: 0, totalBytes: file.size, sha256: "", message: "无法启动文件摘要计算" };
      this.#listener?.(this.snapshot); worker.terminate(); this.#worker = null;
    });
    worker.postMessage({ type: "HASH", file });
  }

  cancel(): void {
    if (this.#worker) { this.#worker.postMessage({ type: "CANCEL" }); this.#worker.terminate(); this.#worker = null; }
    if (this.#snapshot.state === "HASHING") { this.#snapshot = { ...this.#snapshot, state: "CANCELLED", processedBytes: 0, sha256: "" }; this.#listener?.(this.snapshot); }
    this.#listener = null;
  }

  reset(): void { this.cancel(); this.#snapshot = { state: "IDLE", processedBytes: 0, totalBytes: 0, sha256: "", message: "" }; }
}
