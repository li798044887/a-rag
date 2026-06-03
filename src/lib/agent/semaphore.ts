/** 非同期処理の同時実行数を max 件に制限する最小セマフォ。
 *  ツールの execute をラップして並列ツール実行数の上限を強制するために使う。 */
export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(max: number) {
    const n = Math.floor(max);
    this.max = Number.isFinite(n) && n >= 1 ? n : 1;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    // 待機者がいればスロットを直接引き渡す（active は据え置き）。いなければ解放。
    if (next) next();
    else this.active--;
  }
}
