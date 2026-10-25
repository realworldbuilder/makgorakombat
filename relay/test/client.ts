/** A player at the far end of a socket: what it was sent, in order, and a way to wait for the next. */
export class Client {
  readonly got: (string | ArrayBuffer)[] = [];
  closed = false;
  private waiting: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      // Bytes arrive as a Blob here, as in a browser that has not asked for ArrayBuffers.
      const data = event.data as string | ArrayBuffer | Blob;
      const arrived = data instanceof Blob ? data.arrayBuffer() : Promise.resolve(data);
      void arrived.then((message) => {
        this.got.push(message);
        this.waiting.splice(0).forEach((wake) => wake());
      });
    });
    ws.addEventListener('close', () => {
      this.closed = true;
    });
  }

  /** Waits until `n` messages in all have come. */
  async until(n: number): Promise<void> {
    const deadline = Date.now() + 2000;
    while (this.got.length < n) {
      if (Date.now() > deadline) throw new Error(`waited for ${n} messages, got ${this.got.length}`);
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** Waits for a JSON message of kind `t` beyond the first `after`, and answers it. */
  async next<T = Record<string, unknown>>(t: string, after = 0): Promise<T & { k: number }> {
    const deadline = Date.now() + 2000;
    for (;;) {
      for (let k = after; k < this.got.length; k++) {
        const text = this.got[k];
        if (typeof text !== 'string' || text === 'pong') continue;
        const value = JSON.parse(text) as { t: string };
        if (value.t === t) return { ...(value as T), k };
      }
      if (Date.now() > deadline) throw new Error(`waited for "${t}", got ${this.got.slice(after).join(' ')}`);
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** The kinds of the JSON messages beyond the first `after`. */
  kinds(after = 0): string[] {
    return this.got.slice(after).flatMap((text) => (typeof text === 'string' && text !== 'pong' ? [(JSON.parse(text) as { t: string }).t] : []));
  }

  json(k: number): unknown {
    return JSON.parse(this.got[k] as string);
  }
}
