import { EventEmitter } from "node:events";

/**
 * In-process pub/sub that powers the live UI over Server-Sent Events.
 *
 * Channels:
 *  - `app:<applicationId>`  applicant chat deltas + status changes
 *  - `fund:<fundId>`        public transparency feed
 *  - `staff`                reviewer console (new cases, AI results, payouts)
 *  - `copilot:<userId>`     treasurer copilot streaming
 */
export interface BusEvent {
  type: string;
  data: unknown;
  at: string;
}

export type Listener = (event: BusEvent) => void;

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(channel: string, type: string, data: unknown = {}): void {
    this.emitter.emit(channel, { type, data, at: new Date().toISOString() } satisfies BusEvent);
  }

  subscribe(channel: string, listener: Listener): () => void {
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  listenerCount(channel: string): number {
    return this.emitter.listenerCount(channel);
  }
}
