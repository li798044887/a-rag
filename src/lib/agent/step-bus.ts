import type { AgentEvent } from "@/lib/types";

/** ツール execute と runAgent ジェネレータをつなぐ単一消費者向け async キュー。
 *  push された順に drain し、close で終端する。 */
export class StepBus {
  private queue: AgentEvent[] = [];
  private waiting: ((r: IteratorResult<AgentEvent>) => void)[] = [];
  private closed = false;

  push(event: AgentEvent): void {
    if (this.closed) return;
    const w = this.waiting.shift();
    if (w) w({ value: event, done: false });
    else this.queue.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let w: ((r: IteratorResult<AgentEvent>) => void) | undefined;
    while ((w = this.waiting.shift())) w({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<AgentEvent>>((resolve) => this.waiting.push(resolve));
      if (r.done) return;
      yield r.value;
    }
  }
}
