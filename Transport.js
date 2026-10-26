// In-process network link with configurable latency and jitter. Messages are deep-copied on
// send, so client and server can never share object references by accident: the same code
// can later sit on a WebSocket / WebTransport channel unchanged.

export class Channel {
  constructor(name) {
    this.name = name;
    this.queue = [];
    this.latencyMs = 0;
    this.jitterMs = 0;
    this.lastDeliver = 0;
    this.bytesSent = 0;
  }
  setConditions(latencyMs, jitterMs) {
    this.latencyMs = latencyMs;
    this.jitterMs = jitterMs;
  }
  send(msg, nowMs) {
    let at = nowMs + this.latencyMs + Math.random() * this.jitterMs;
    // Ordered delivery (like a reliable ordered channel): never overtake an earlier packet.
    if (at < this.lastDeliver) at = this.lastDeliver;
    this.lastDeliver = at;
    this.queue.push({ at, msg: structuredClone(msg) });
  }
  receive(nowMs) {
    const out = [];
    while (this.queue.length && this.queue[0].at <= nowMs) out.push(this.queue.shift().msg);
    return out;
  }
}

/** A client <-> server pair of channels. */
export function createLoopback() {
  return { up: new Channel('client->server'), down: new Channel('server->client') };
}
