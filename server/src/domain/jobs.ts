/**
 * Minimal in-process job runner: fire-and-forget work with logging, plus
 * per-key serialization so two jobs for the same application never interleave
 * (e.g. two chat turns, or an assessment racing a document analysis).
 */
export interface JobLogger {
  error(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

export class JobRunner {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(private readonly log: JobLogger) {}

  /** Runs `fn` after any previous job with the same key has finished. */
  run(key: string, name: string, fn: () => Promise<unknown>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(fn)
      .catch((err) => {
        this.log.error({ err, job: name, key }, `job ${name} failed`);
      });
    this.chains.set(key, next);
    this.inflight.add(next);
    void next.finally(() => {
      this.inflight.delete(next);
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    return next.then(() => undefined);
  }

  /** Test helper: wait until every queued job (including ones they enqueue) is done. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }
}
