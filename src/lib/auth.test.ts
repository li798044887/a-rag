import { expect, test } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/lib/auth";

test("token carries the real user id as sub", async () => {
  const token = await signAccessToken({ id: "user-uuid-1", email: "a@b.com", org: "Acme" });
  const claims = await verifyAccessToken(token);
  expect(claims?.sub).toBe("user-uuid-1");
  expect(claims?.email).toBe("a@b.com");
  expect(claims?.org).toBe("Acme");
});
