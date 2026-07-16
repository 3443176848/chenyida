import { importStatusNeedsPolling, pollingDelay, retryAfterMilliseconds, type MaterialImportBatch, type MaterialImportBatchStatus } from "./material-import";

type PollResult = { batch: MaterialImportBatch; preparation?: string };
type PollCallbacks = { onData: (result: PollResult) => void; onError: (error: unknown) => void };

export class MaterialImportPollingController {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #abort: AbortController | null = null;
  #sequence = 0;
  #startedAt = 0;
  #networkFailures = 0;
  #batchId = 0;
  #load: ((batchId: number, signal: AbortSignal) => Promise<PollResult>) | null = null;
  #callbacks: PollCallbacks | null = null;
  #visibility = () => { if (document.visibilityState === "visible") void this.refresh(); };

  start(batchId: number, load: (batchId: number, signal: AbortSignal) => Promise<PollResult>, callbacks: PollCallbacks): void {
    this.stop(); this.#batchId = batchId; this.#load = load; this.#callbacks = callbacks; this.#startedAt = Date.now();
    document.addEventListener("visibilitychange", this.#visibility); void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.#load || !this.#callbacks || document.visibilityState === "hidden" || this.#abort) return;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    const sequence = ++this.#sequence; const batchId = this.#batchId; this.#abort = new AbortController();
    try {
      const result = await this.#load(batchId, this.#abort.signal);
      if (sequence !== this.#sequence || batchId !== this.#batchId) return;
      this.#networkFailures = 0; this.#callbacks.onData(result);
      if (importStatusNeedsPolling(result.batch.status, result.preparation)) this.#schedule(pollingDelay(Date.now() - this.#startedAt));
    } catch (error) {
      if (sequence !== this.#sequence || (error as { name?: string })?.name === "AbortError") return;
      this.#callbacks.onError(error);
      const status = Number((error as { status?: number })?.status || 0);
      if ([401, 403, 404].includes(status)) { this.stop(); return; }
      this.#networkFailures += 1;
      const retry = status === 429 ? retryAfterMilliseconds(String((error as { retryAfter?: string })?.retryAfter || "")) : null;
      this.#schedule(retry ?? pollingDelay(Date.now() - this.#startedAt, this.#networkFailures));
    } finally {
      if (sequence === this.#sequence) this.#abort = null;
    }
  }

  #schedule(delay: number): void {
    if (!this.#load) return;
    this.#timer = setTimeout(() => { this.#timer = null; void this.refresh(); }, delay);
  }

  updateStatus(status: MaterialImportBatchStatus, preparation?: string): void {
    if (!importStatusNeedsPolling(status, preparation) && this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
  }

  stop(): void {
    this.#sequence += 1; if (this.#timer) clearTimeout(this.#timer); this.#timer = null; this.#abort?.abort(); this.#abort = null;
    document.removeEventListener("visibilitychange", this.#visibility); this.#load = null; this.#callbacks = null;
  }
}
