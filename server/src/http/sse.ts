import type { FastifyReply, FastifyRequest } from "fastify";
import type { BusEvent, EventBus } from "../lib/events.js";

/**
 * Streams bus events to the browser as Server-Sent Events. Sends an initial
 * snapshot (so reconnects never miss state) and a keep-alive comment so proxies
 * (Render, Cloudflare) don't close idle connections.
 */
export async function streamEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  bus: EventBus,
  channels: string[],
  snapshot?: () => Promise<BusEvent[]>,
): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  });
  const write = (event: BusEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...((event.data as object) ?? {}), _at: event.at })}\n\n`);
  };
  res.write(`retry: 3000\n\n`);
  if (snapshot) {
    try {
      for (const ev of await snapshot()) write(ev);
    } catch (err) {
      request.log.warn({ err }, "SSE snapshot failed");
    }
  }
  const unsubscribers = channels.map((ch) => bus.subscribe(ch, write));
  const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
  const close = () => {
    clearInterval(ping);
    unsubscribers.forEach((u) => u());
  };
  request.raw.on("close", close);
  res.on("error", close);
}
