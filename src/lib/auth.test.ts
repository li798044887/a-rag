import { expect, test } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/lib/auth";

test("token carries the real user id as sub", async () => {
  const token = await signAccessToken({ id: "user-uuid-1", email: "a@b.com", org: "Acme" });
  const claims = await verifyAccessToken(token);
  expect(claims?.sub).toBe("user-uuid-1");
  expect(claims?.email).toBe("a@b.com");
  expect(claims?.org).toBe("Acme");
  // rem は省略時 false
  expect(claims?.rem).toBe(false);
});

test("rem claim mirrors the remember flag", async () => {
  const token = await signAccessToken({ id: "u2", email: "c@d.com", org: "Acme", remember: true });
  const claims = await verifyAccessToken(token);
  expect(claims?.rem).toBe(true);
});

test("iat / exp are populated with a 24h spread", async () => {
  const token = await signAccessToken({ id: "u3", email: "e@f.com", org: "Acme" });
  const claims = await verifyAccessToken(token);
  expect(typeof claims?.iat).toBe("number");
  expect(typeof claims?.exp).toBe("number");
  // 24h = 86400s。発行と検証の間に若干差が出るので幅を取る。
  expect((claims!.exp! - claims!.iat!) >= 86_000).toBe(true);
});
