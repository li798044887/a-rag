# フェーズ2: 認証の実体化

> 前提・共通規約は [README.md](./README.md) を参照。

**このフェーズのゴール:** デモ認証（任意 cred で通過）を、`users` テーブル + argon2 による実認証に置換。register/login を DB 照合にし、JWT の `sub` を実ユーザー ID にする。`AppUser` を DB 行から導出。

**依存:** フェーズ1

**作成/変更するファイル:**
- Modify: `src/lib/db/schema.ts`（users 追加）
- Create: `drizzle/`（マイグレーション、`drizzle-kit generate` で生成）
- Create: `src/lib/users.ts`（ユーザーリポジトリ + AppUser 変換）
- Modify: `src/lib/auth.ts`（`signAccessToken` が user id/org を受け取る）
- Modify: `src/app/api/auth/login/route.ts`（DB 照合）
- Create: `src/app/api/auth/register/route.ts`
- Modify: `src/app/api/auth/me/route.ts`（DB から導出）
- Create: `src/lib/users.test.ts`, `src/app/api/auth/auth.test.ts`
- Modify: `package.json`（argon2 依存）

---

### Task 1: users テーブル定義とマイグレーション

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: スキーマに users を追加**

`src/lib/db/schema.ts`（`export {};` を置換）:
```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").notNull(),
  org: text("org").notNull().default("ARag, Inc."),
  initials: text("initials").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
```

- [ ] **Step 2: マイグレーション生成**

Run: `pnpm drizzle-kit generate`
Expected: `drizzle/0000_*.sql` が生成され、`CREATE TABLE "users"` を含む。

- [ ] **Step 3: マイグレーション適用**

Run: `docker compose up -d postgres && pnpm drizzle-kit migrate`
Expected: `migrations applied`。`psql` で `\d users` が見える。

- [ ] **Step 4: コミット**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: users テーブルとマイグレーションを追加"
```

---

### Task 2: ユーザーリポジトリ（TDD）

**Files:**
- Create: `src/lib/users.ts`, `src/lib/users.test.ts`
- Modify: `package.json`

- [ ] **Step 1: argon2 を追加**

Run: `pnpm add @node-rs/argon2`

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/users.test.ts`:
```ts
import { afterAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createUser, findUserByEmail, verifyPassword, toAppUser } from "@/lib/users";

const email = `t_${Date.now()}@example.com`;

afterAll(async () => {
  await db.execute(sql`delete from users where email = ${email}`);
});

test("createUser then findUserByEmail roundtrips and hashes password", async () => {
  const created = await createUser({ email, password: "pw-secret-123", name: "山田 太郎" });
  expect(created.email).toBe(email);
  expect(created.passwordHash).not.toContain("pw-secret-123");

  const found = await findUserByEmail(email);
  expect(found?.id).toBe(created.id);
  expect(await verifyPassword(found!, "pw-secret-123")).toBe(true);
  expect(await verifyPassword(found!, "wrong")).toBe(false);
});

test("toAppUser derives initials and firstName", async () => {
  const found = await findUserByEmail(email);
  const app = toAppUser(found!);
  expect(app.email).toBe(email);
  expect(app.name).toBe("山田 太郎");
});
```

- [ ] **Step 3: 失敗を確認**

Run: `pnpm test src/lib/users.test.ts`
Expected: FAIL（`@/lib/users` 未作成）

- [ ] **Step 4: リポジトリを実装**

`src/lib/users.ts`:
```ts
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type UserRow } from "@/lib/db/schema";
import type { AppUser } from "@/lib/types";

/** 「山田 太郎」→「山太」/「Hiroshi Tanaka」→「HT」。1語なら先頭2文字。 */
function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function deriveFirstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : parts[0];
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  org?: string;
}): Promise<UserRow> {
  const passwordHash = await hash(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      firstName: deriveFirstName(input.name),
      org: input.org ?? "ARag, Inc.",
      initials: deriveInitials(input.name),
    })
    .returning();
  return row;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}

export async function verifyPassword(user: UserRow, password: string): Promise<boolean> {
  return verify(user.passwordHash, password);
}

export function toAppUser(user: UserRow): AppUser {
  return {
    name: user.name,
    firstName: user.firstName,
    org: user.org,
    initials: user.initials,
    email: user.email,
  };
}
```

- [ ] **Step 5: 合格を確認**

Run: `pnpm test src/lib/users.test.ts`
Expected: `2 passed`

- [ ] **Step 6: コミット**

```bash
git add src/lib/users.ts src/lib/users.test.ts package.json pnpm-lock.yaml
git commit -m "feat: ユーザーリポジトリ（argon2 ハッシュ）を追加"
```

---

### Task 3: signAccessToken をユーザー ID 対応にする

**Files:**
- Modify: `src/lib/auth.ts:20-38`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/auth.test.ts`:
```ts
import { expect, test } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/lib/auth";

test("token carries the real user id as sub", async () => {
  const token = await signAccessToken({ id: "user-uuid-1", email: "a@b.com", org: "Acme" });
  const claims = await verifyAccessToken(token);
  expect(claims?.sub).toBe("user-uuid-1");
  expect(claims?.email).toBe("a@b.com");
  expect(claims?.org).toBe("Acme");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm test src/lib/auth.test.ts`
Expected: FAIL（`signAccessToken` の引数 `id`/`org` を受け取れず sub がメール由来になる）

- [ ] **Step 3: `signAccessToken` を変更**

`src/lib/auth.ts` の `signAccessToken` を置換:
```ts
/** Issue a 24h access token for the given user. */
export async function signAccessToken(input: {
  id: string;
  email: string;
  org: string;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    org: input.org,
    role: "member",
    scopes: ["read:kb", "chat", "tools:python"],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.id)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("24h")
    .sign(secret);
}
```

- [ ] **Step 4: 合格を確認**

Run: `pnpm test src/lib/auth.test.ts`
Expected: `1 passed`

- [ ] **Step 5: コミット**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: JWT の sub を実ユーザー ID にする"
```

---

### Task 4: register / login / me を DB 照合に

**Files:**
- Create: `src/app/api/auth/register/route.ts`
- Modify: `src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`
- Create: `src/app/api/auth/auth.test.ts`

- [ ] **Step 1: 失敗するテスト（ルートハンドラを直接呼ぶ統合テスト）**

`src/app/api/auth/auth.test.ts`:
```ts
import { afterAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";

const email = `auth_${Date.now()}@example.com`;
const password = "pw-secret-123";

afterAll(async () => {
  await db.execute(sql`delete from users where email = ${email}`);
});

function jsonReq(body: unknown): Request {
  return new Request("http://test/local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("register creates a user and returns it", async () => {
  const res = await register(jsonReq({ email, password, name: "新規 ユーザー" }));
  expect(res.status).toBe(200);
  const { user } = await res.json();
  expect(user.email).toBe(email);
});

test("login rejects wrong password and accepts correct one", async () => {
  const bad = await login(jsonReq({ email, password: "nope" }));
  expect(bad.status).toBe(401);

  const ok = await login(jsonReq({ email, password }));
  expect(ok.status).toBe(200);
  const { user } = await ok.json();
  expect(user.email).toBe(email);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm test src/app/api/auth/auth.test.ts`
Expected: FAIL（`register/route` 未作成）

- [ ] **Step 3: register ルートを作成**

`src/app/api/auth/register/route.ts`:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signAccessToken, authCookieName } from "@/lib/auth";
import { createUser, findUserByEmail, toAppUser } from "@/lib/users";

export async function POST(req: Request) {
  const { email, password, name } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "メールアドレスと 8 文字以上のパスワードが必要です" },
      { status: 400 },
    );
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json({ error: "このメールアドレスは登録済みです" }, { status: 409 });
  }

  const row = await createUser({ email, password, name: name || email.split("@")[0] });
  const token = await signAccessToken({ id: row.id, email: row.email, org: row.org });

  const jar = await cookies();
  jar.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.json({ user: toAppUser(row) });
}
```

- [ ] **Step 4: login を DB 照合に変更**

`src/app/api/auth/login/route.ts` を置換:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signAccessToken, authCookieName } from "@/lib/auth";
import { findUserByEmail, verifyPassword, toAppUser } from "@/lib/users";

export async function POST(req: Request) {
  const { email, password, remember } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "メールアドレスとパスワードが必要です" }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(user, password))) {
    return NextResponse.json({ error: "認証情報が正しくありません" }, { status: 401 });
  }

  const token = await signAccessToken({ id: user.id, email: user.email, org: user.org });
  const jar = await cookies();
  jar.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });

  return NextResponse.json({ user: toAppUser(user) });
}
```

- [ ] **Step 5: me を DB から導出に変更**

`src/app/api/auth/me/route.ts` を置換:
```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { toAppUser } from "@/lib/users";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  if (!token) return NextResponse.json({ user: null });

  const claims = await verifyAccessToken(token);
  if (!claims) return NextResponse.json({ user: null });

  const [row] = await db.select().from(users).where(eq(users.id, claims.sub));
  if (!row) return NextResponse.json({ user: null });

  return NextResponse.json({ user: toAppUser(row), claims });
}
```

- [ ] **Step 6: 合格を確認**

Run: `pnpm test src/app/api/auth/auth.test.ts`
Expected: `2 passed`

- [ ] **Step 7: 回帰確認（lint + 全テスト）**

Run: `pnpm lint && pnpm test`
Expected: lint クリーン、全テスト green

- [ ] **Step 8: コミット**

```bash
git add src/app/api/auth
git commit -m "feat: register/login/me を実ユーザー DB 照合に置換"
```

---

### Task 5: ログイン UI に登録導線を追加

**Files:**
- Modify: `src/components/auth/login.tsx`, `src/hooks/use-auth.ts`

- [ ] **Step 1: `use-auth` に register を追加**

`src/hooks/use-auth.ts` を確認し、既存の `login` と同形で `register(email, password, name)` を追加（`POST /api/auth/register` を叩き、成功時に `me` を再取得 or 返却 user をセット）。実装は既存 `login` 関数のパターンに厳密に倣う（同ファイル内の fetch・状態更新の書式をコピーしてエンドポイントとボディだけ変える）。

- [ ] **Step 2: ログイン画面に「新規登録」トグル**

`src/components/auth/login.tsx` に、メール/パスワードに加え登録時のみ表示する「氏名」入力と、ログイン⇄登録を切り替えるリンクを追加。送信時にモードに応じて `login`/`register` を呼ぶ。既存のフォーム要素のクラス・構造を流用する。

- [ ] **Step 3: 手動確認**

Run: `pnpm dev`（別途 `docker compose up -d postgres` 済み）
ブラウザで新規登録 → ログアウト → 同 cred でログインできることを確認。

- [ ] **Step 4: コミット**

```bash
git add src/components/auth/login.tsx src/hooks/use-auth.ts
git commit -m "feat: ログイン画面に新規登録導線を追加"
```

---

## フェーズ2 完了条件
- 未登録 cred ではログイン不可（401）
- 登録 → ログイン → `me` が DB 由来の `AppUser` を返す
- `pnpm test` green、`pnpm lint` クリーン
