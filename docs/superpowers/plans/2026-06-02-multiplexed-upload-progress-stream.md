# 多重化アップロード進捗ストリーム Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大量アップロード時に1ファイル=1本だった長命 SSE 接続を、ブラウザあたり常時1本の多重化ストリームに集約し、HTTP/1.1 の6接続上限による後続操作の挂起をなくす。

**Architecture:** Next.js 側に新エンドポイント `POST /api/uploads/stream` を設け、リクエストボディの jobId 集合を rag `/jobs/:id` へファンアウト並列ポーリングし、`jobId` 付きフレームを1接続で多重 push する（rag 無改修）。クライアント `use-uploads.ts` はファイル別ストリームを廃し、アクティブな jobId 集合の変化（デバウンス）で単一ストリームを再接続する。

**Tech Stack:** Next.js App Router (Route Handlers, `ReadableStream`), React hooks, Vitest（unit プロジェクト, node 環境）。

設計書: `docs/superpowers/specs/2026-06-02-multiplexed-upload-progress-stream-design.md`

---

## File Structure

- **Create** `src/app/api/uploads/stream/route.ts` — 多重化 SSE エンドポイント（POST）。純関数 `isTerminalJobStatus` / `formatFrame` を export。
- **Create** `src/app/api/uploads/stream/route.test.ts` — 上記純関数のユニットテスト。
- **Modify** `src/hooks/use-uploads.ts` — ファイル別ストリームを廃し単一多重化ストリームへ。純関数 `activeJobIds` / `reconnectKey` を export。
- **Modify** `src/hooks/use-uploads.test.ts` — 純関数テストを追加。
- **Delete** `src/app/api/uploads/[id]/stream/route.ts` — 不要になる旧ルート。

---

## Task 1: クライアント純関数 `activeJobIds` / `reconnectKey`

監視対象 jobId 集合の抽出と安定キー生成を純関数として切り出し、TDD で固める。

**Files:**
- Modify: `src/hooks/use-uploads.ts`
- Test: `src/hooks/use-uploads.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/hooks/use-uploads.test.ts` の末尾に追記する（既存の import 行 `import { uploadActionFor } from "@/hooks/use-uploads";` を下記へ置き換え、`StagedFile` 型も import）。

```ts
import { expect, test } from "vitest";
import { activeJobIds, reconnectKey, uploadActionFor } from "@/hooks/use-uploads";
import type { StagedFile } from "@/lib/types";

test("activeJobIds は queued/processing の jobId のみ返す", () => {
  const files: StagedFile[] = [
    { id: "1", name: "a", size: 1, status: "queued", progress: 0, jobId: "j1" },
    { id: "2", name: "b", size: 1, status: "processing", progress: 0, jobId: "j2" },
    { id: "3", name: "c", size: 1, status: "ready", progress: 100, jobId: "j3" },
    { id: "4", name: "d", size: 1, status: "uploading", progress: 0 },
  ];
  expect(activeJobIds(files)).toEqual(["j1", "j2"]);
});

test("reconnectKey はソート・重複排除して安定キーを返す", () => {
  expect(reconnectKey(["j2", "j1", "j2"])).toBe("j1,j2");
  expect(reconnectKey([])).toBe("");
});
```

（既存の `uploadActionFor` テスト群はそのまま残し、ファイル先頭の重複 import 行のみ上記に統合する。）

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test -- src/hooks/use-uploads.test.ts`
Expected: FAIL（`activeJobIds` / `reconnectKey` が未 export でインポートエラー）

- [ ] **Step 3: 最小実装を追加**

`src/hooks/use-uploads.ts` の `import type { ... } from "@/lib/types";` の直後あたり（`uploadActionFor` 関数の近く）に追加する。

```ts
/** 進捗監視が必要なファイル（queued/processing）の jobId を返す。 */
export function activeJobIds(files: StagedFile[]): string[] {
  return files
    .filter((f) => (f.status === "queued" || f.status === "processing") && !!f.jobId)
    .map((f) => f.jobId as string);
}

/** jobId 集合を順序非依存・重複排除した安定キーにする（再接続判定に使う）。 */
export function reconnectKey(jobIds: string[]): string {
  return Array.from(new Set(jobIds)).sort().join(",");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/hooks/use-uploads.test.ts`
Expected: PASS（5 件すべて green）

- [ ] **Step 5: コミット**

```bash
git add src/hooks/use-uploads.ts src/hooks/use-uploads.test.ts
git commit -m "feat: アップロード進捗の監視対象 jobId 抽出/キー化の純関数を追加"
```

---

## Task 2: サーバ純関数 `isTerminalJobStatus` / `formatFrame`

多重化ルートのうち、テスト可能なフレーム整形・終端判定を純関数として先に作る。

**Files:**
- Create: `src/app/api/uploads/stream/route.ts`
- Test: `src/app/api/uploads/stream/route.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/app/api/uploads/stream/route.test.ts` を新規作成。

```ts
import { expect, test } from "vitest";
import { formatFrame, isTerminalJobStatus } from "./route";

test("ready/error は終端、それ以外は継続", () => {
  expect(isTerminalJobStatus("ready")).toBe(true);
  expect(isTerminalJobStatus("error")).toBe(true);
  expect(isTerminalJobStatus("processing")).toBe(false);
  expect(isTerminalJobStatus("queued")).toBe(false);
});

test("formatFrame は jobId 付き SSE フレームを返す", () => {
  const frame = formatFrame("j1", { status: "ready", progress: 100, stage_detail: "" });
  expect(frame).toBe(`data: {"jobId":"j1","status":"ready","progress":100,"stage_detail":""}\n\n`);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test -- src/app/api/uploads/stream/route.test.ts`
Expected: FAIL（`./route` が存在せず解決エラー）

- [ ] **Step 3: ルートと純関数を実装**

`src/app/api/uploads/stream/route.ts` を新規作成。

```ts
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// rag ジョブ状態をサーバ側でポーリングし、複数ジョブを1本の SSE に多重化して push する。
// rag は無改修。1ファイル=1接続だった旧 /api/uploads/:id/stream を集約し、
// ブラウザの「1オリジン同時6接続」上限の枯渇を防ぐ。
const POLL_MS = 600;
const MAX_MS = 10 * 60 * 1000; // 上限10分（迷子ストリーム防止）。

interface JobSnapshot {
  status: string;
  progress: number;
  stage_detail: string;
  chunks?: number;
  page_count?: number | null;
  error?: string | null;
}

/** rag のジョブ status が終端（これ以上更新が来ない）かどうか。 */
export function isTerminalJobStatus(status: string): boolean {
  return status === "ready" || status === "error";
}

/** SSE フレーム文字列を組み立てる（jobId を必ず先頭に含める）。 */
export function formatFrame(jobId: string, snapshot: JobSnapshot): string {
  return `data: ${JSON.stringify({ jobId, ...snapshot })}\n\n`;
}

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return new Response("unauthorized", { status: 401 });

  let jobIds: string[] = [];
  try {
    const body = (await req.json()) as { jobIds?: unknown };
    if (Array.isArray(body.jobIds)) {
      jobIds = body.jobIds.filter((j): j is string => typeof j === "string");
    }
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const owner = encodeURIComponent(claims.sub);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); } catch { close(); }
      };

      // クライアント切断（モーダルを閉じる/ナビゲート/再接続）で即停止する。
      req.signal.addEventListener("abort", close);

      // 監視中ジョブの集合。終端に達したものは外し、空になれば終了する。
      const pending = new Set(jobIds);
      if (pending.size === 0) { close(); return; }

      const started = Date.now();
      try {
        while (!closed && pending.size > 0 && Date.now() - started < MAX_MS) {
          // 各ジョブを並列ポーリングし、スナップショットを jobId 付きで push する。
          await Promise.all(
            Array.from(pending).map(async (jobId) => {
              const r = await ragFetch(
                `/jobs/${encodeURIComponent(jobId)}?owner_user_id=${owner}`,
              ).catch(() => null);
              if (!r || !r.ok) {
                send(formatFrame(jobId, { status: "error", progress: 0, stage_detail: "", error: "ジョブが見つかりません" }));
                pending.delete(jobId);
                return;
              }
              const job = (await r.json()) as JobSnapshot;
              send(formatFrame(jobId, job));
              if (isTerminalJobStatus(job.status)) pending.delete(jobId);
            }),
          );
          if (pending.size === 0) break;
          await new Promise((res) => setTimeout(res, POLL_MS));
        }
      } catch {
        // 全体例外時は接続を閉じるのみ（個別ジョブのエラーは上で送出済み）。
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // リバースプロキシのバッファリングを無効化（Nginx 等）。
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- src/app/api/uploads/stream/route.test.ts`
Expected: PASS（2 件 green）

- [ ] **Step 5: コミット**

```bash
git add src/app/api/uploads/stream/route.ts src/app/api/uploads/stream/route.test.ts
git commit -m "feat: 複数ジョブを多重化する進捗SSEエンドポイントを追加"
```

---

## Task 3: クライアントを単一多重化ストリームへ書き換え

`use-uploads.ts` のファイル別ストリーム（`streams` / `clearStream` / `startStreaming`）を廃し、`activeJobIds` の変化に応じてデバウンス再接続する単一ストリームへ置き換える。

このタスクはストリーム処理の性質上 TDD が難しいため、Task 1 の純関数テスト・型チェック・既存テスト維持・手動確認で担保する。

**Files:**
- Modify: `src/hooks/use-uploads.ts`

- [ ] **Step 1: ストリーム関連 ref と clearStream を置き換える**

`useUploads` 冒頭の ref 宣言部（現状の `timers` / `streams` / `uploads`）を以下に変更する。`streams` を削除し、`progressStream` / `streamKey` / `debounce` / `syncRef` を追加する。

```ts
  const [files, setFiles] = useState<StagedFile[]>([]);
  // アップロード進捗アニメ用の interval、送信中POSTのAbortController を id ごとに保持。
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const uploads = useRef<Record<string, AbortController>>({});
  // 進捗は全ジョブを1本の多重化ストリームで購読する。
  const progressStream = useRef<AbortController | null>(null);
  const streamKey = useRef<string>("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRef = useRef<() => void>(() => {});
```

続けて、現状の `clearStream` 定義（`streams.current[id]?.abort(); delete ...`）を削除する。`clearTimer` はそのまま残す。

- [ ] **Step 2: applyFrame / readStream / syncProgressStream / scheduleSync を実装**

削除した `startStreaming` の位置に、以下を挿入する。

```ts
  interface ProgressFrame {
    jobId: string;
    status: string;
    progress: number;
    stage_detail: string;
    chunks?: number;
    page_count?: number | null;
    error?: string | null;
  }

  /** 1フレームを jobId で該当ファイルに反映し、ready/error はトースト通知する。 */
  const applyFrame = useCallback((j: ProgressFrame) => {
    const target = filesRef.current.find((f) => f.jobId === j.jobId);
    setFiles((prev) =>
      prev.map((f) =>
        f.jobId === j.jobId
          ? {
              ...f,
              status: toUploadStatus(j.status),
              progress: j.progress,
              stage: asStage(j.status),
              stageDetail: j.stage_detail || undefined,
              chunks: j.chunks ?? f.chunks,
              pages: j.page_count ?? f.pages,
              error: j.error ?? undefined,
              durationMs: j.status === "ready" && f.startedAt ? Date.now() - f.startedAt : f.durationMs,
            }
          : f,
      ),
    );
    if (j.status === "ready") onToastRef.current?.(`「${target?.name ?? ""}」を索引化しました`, "success");
    if (j.status === "error") onToastRef.current?.(j.error || "索引化に失敗しました", "error");
  }, []);

  /** POST /api/uploads/stream を購読し、jobId 付きフレームを reduce する。 */
  const readStream = useCallback(
    async (ctrl: AbortController, key: string) => {
      try {
        const res = await fetch("/api/uploads/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: key ? key.split(",") : [] }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error("stream failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            applyFrame(JSON.parse(line.slice(5).trim()) as ProgressFrame);
          }
        }
        // 正常終了（サーバが全ジョブ完了で close）。取りこぼしがあれば再同期する。
        if (progressStream.current === ctrl) {
          progressStream.current = null;
          streamKey.current = "";
          if (activeJobIds(filesRef.current).length > 0) syncRef.current();
        }
      } catch {
        if (ctrl.signal.aborted) return; // 切り替え/clear による中断は無視。
        if (progressStream.current !== ctrl) return; // すでに別接続に置き換わっている。
        // 予期せぬ切断: 未完了ジョブが残っていれば backoff 再接続（全件 error にはしない）。
        progressStream.current = null;
        streamKey.current = "";
        if (activeJobIds(filesRef.current).length > 0) {
          setTimeout(() => syncRef.current(), 1000);
        }
      }
    },
    [applyFrame],
  );

  /** アクティブ jobId 集合に合わせてストリームを1本に保つ。変化が無ければ no-op。 */
  const syncProgressStream = useCallback(() => {
    const key = reconnectKey(activeJobIds(filesRef.current));
    if (key === streamKey.current && progressStream.current) return;
    progressStream.current?.abort();
    progressStream.current = null;
    streamKey.current = key;
    if (!key) return; // 監視対象なし。
    const ctrl = new AbortController();
    progressStream.current = ctrl;
    void readStream(ctrl, key);
  }, [readStream]);

  useEffect(() => { syncRef.current = syncProgressStream; }, [syncProgressStream]);

  /** バースト（連続アップロード）を1回の再接続にまとめる。 */
  const scheduleSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { debounce.current = null; syncRef.current(); }, 300);
  }, []);

  // アンマウント時に接続・タイマーを片付ける。
  useEffect(
    () => () => {
      progressStream.current?.abort();
      if (debounce.current) clearTimeout(debounce.current);
      Object.values(timers.current).forEach((t) => clearInterval(t));
    },
    [],
  );
```

- [ ] **Step 3: removeFile を新方式に合わせる**

`removeFile` 内の `clearStream(id)` 呼び出しをすべて削除し、集合が変化しうる箇所で `scheduleSync()` を呼ぶ。`removeFile` を以下へ置き換える。

```ts
  const removeFile = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id);
    const action = file ? uploadActionFor(file.status) : "remove";

    // processing は取り消し不可（✕ は出さないが、保険でここでも no-op）。
    if (action === "none") return;

    // uploading: 送信中の upload POST を中断してから除去。
    if (action === "abort") {
      uploads.current[id]?.abort();
      delete uploads.current[id];
      // この後、共通のローカル除去へフォールスルーする。
    }

    // queued: サーバ側キャンセルAPIを呼ぶ。成功で除去、409 は処理中として残す。
    if (action === "cancel" && file?.jobId) {
      const jobId = file.jobId;
      fetch(`/api/uploads/${jobId}/cancel`, { method: "POST" })
        .then((res) => {
          if (res.status === 409) {
            onToastRef.current?.("処理中のため取り消せません", "info");
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing" } : f)));
            return;
          }
          if (!res.ok) {
            onToastRef.current?.("取り消しに失敗しました", "error");
            return;
          }
          clearTimer(id);
          setFiles((prev) => prev.filter((f) => f.id !== id));
          scheduleSync();
        })
        .catch(() => onToastRef.current?.("取り消しに失敗しました", "error"));
      return;
    }

    // abort / remove: ローカル除去。
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimer(id);
    scheduleSync();
  }, [clearTimer, scheduleSync]);
```

- [ ] **Step 4: enqueue の POST 解決で scheduleSync を呼ぶ**

`enqueue` 内 `fetch("/api/upload", ...)` の `.then` で、`queued` を反映した直後の `startStreaming(id, jobId, file.name);` を以下へ置き換える。

```ts
            const { documentId, jobId } = (await res.json()) as { documentId: string; jobId: string };
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "queued", progress: 0, jobId, documentId } : f)));
            scheduleSync();
```

あわせて `enqueue` の `useCallback` 依存配列を `[clearTimer, startStreaming]` から `[clearTimer, scheduleSync]` に変更する。

- [ ] **Step 5: retry を新方式に合わせる**

`retry` 内の `clearStream(id);` を削除し、retry POST 成功時の `startStreaming(id, jobId, name);` を `scheduleSync();` に置き換える。依存配列 `[clearStream, startStreaming]` を `[scheduleSync]` に変更する。置き換え後の `retry`:

```ts
  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.find((f) => f.id === id);
      if (!file?.jobId) return;
      const { jobId } = file;

      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 0, stage: undefined, stageDetail: undefined, error: undefined, startedAt: Date.now(), durationMs: undefined } : f)));

      fetch(`/api/uploads/${jobId}/retry`, { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({ error: "再試行に失敗しました" }));
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
            return;
          }
          scheduleSync();
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
        });
    },
    [scheduleSync],
  );
```

（`name` は不要になったため分割代入から外す。）

- [ ] **Step 6: clear を新方式に合わせる**

`clear` を以下へ置き換える（`streams` 参照と `clearStream` を撤去し、単一ストリームと debounce を片付ける）。

```ts
  const clear = useCallback(() => {
    Object.keys(timers.current).forEach(clearTimer);
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    progressStream.current?.abort();
    progressStream.current = null;
    streamKey.current = "";
    Object.values(uploads.current).forEach((c) => c.abort());
    uploads.current = {};
    setFiles([]);
  }, [clearTimer]);
```

- [ ] **Step 7: 型チェックと lint**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし（未使用の `startStreaming` / `clearStream` 残骸や依存配列の型不整合が無いこと）

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 8: ユニットテスト全体を確認**

Run: `pnpm test`
Expected: PASS（Task 1・Task 2 の追加分含め全 green。既存 `uploadActionFor` テストも維持）

- [ ] **Step 9: コミット**

```bash
git add src/hooks/use-uploads.ts
git commit -m "refactor: アップロード進捗を単一の多重化ストリームに集約"
```

---

## Task 4: 旧ルート削除

ファイル別ストリーム `/api/uploads/[id]/stream` は参照されなくなるため削除する。

**Files:**
- Delete: `src/app/api/uploads/[id]/stream/route.ts`

- [ ] **Step 1: 参照が無いことを確認**

Run: `grep -rn "uploads/.*\${.*}/stream\|\[id\]/stream\|/stream" src --include="*.ts" --include="*.tsx"`
Expected: `src/app/api/uploads/stream/route.ts`（新ルート）以外に、旧 `[id]/stream` への参照が無いこと。`use-uploads.ts` から `startStreaming` / 旧 fetch が消えていること。

- [ ] **Step 2: 旧ルートを削除**

```bash
git rm src/app/api/uploads/[id]/stream/route.ts
```

- [ ] **Step 3: 型チェックとテストで回帰が無いことを確認**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git commit -m "refactor: 不要になった1ファイル単位の進捗SSEルートを削除"
```

---

## Task 5: 手動検証

**Files:** なし（動作確認のみ）

- [ ] **Step 1: dev サーバを起動**

Run: `pnpm dev`（別途 rag / postgres が起動済みであること）

- [ ] **Step 2: 大量アップロードで接続枠の枯渇が解消したことを確認**

7件以上のファイルを同時にアップロードし、DevTools Network を開いて以下を確認する。
- `stream` 系の接続が**1本のみ**で、`(pending)` で滞留する `stats` / `documents` / `chat` が無いこと。
- 各ファイルの段階表示（parsing→…→ready）が従来どおり進むこと。
- アップロード中にチャット送信・ドキュメント一覧取得が**待たされず通る**こと。

- [ ] **Step 3: 操作系の整合を確認**

- アップロード中に ✕（uploading=中断 / queued=キャンセル）で除去 → 残ファイルの進捗は継続。
- 1件を error にして再試行 → 単一ストリームで再購読され ready になる。
- 「クリア」で全件除去 → ストリーム接続が閉じる（Network で stream が消える）。

---

## Self-Review メモ

- **Spec coverage:** 新エンドポイント（Task 2）、フレーム jobId 付与・完了除外（Task 2）、単一化/デバウンス再接続/再接続バックオフ/トースト遷移（Task 3）、旧ルート削除（Task 4）、純関数テスト（Task 1・2）、手動検証（Task 5）— 設計書の各項目に対応。
- **Placeholder scan:** プレースホルダなし。各コードステップは実コードを記載。
- **Type consistency:** `activeJobIds` / `reconnectKey` / `isTerminalJobStatus` / `formatFrame` / `ProgressFrame` / `syncProgressStream` / `scheduleSync` を全タスクで一貫使用。`JobSnapshot`（サーバ）と `ProgressFrame`（クライアント, jobId 付き）を区別。
