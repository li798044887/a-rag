import { http, HttpResponse } from "msw";

/** Story がレンダー時に叩く可能性のあるエンドポイントのみをモックする（catch-all は置かない）。
 *  現状の Story はすべて props 駆動のリーフで、レンダー時に fetch するものは無い。
 *  認証状態を読む経路だけ将来の取りこぼし防止に用意しておく。 */
export const mswHandlers = {
  auth: [
    http.get("/api/auth/me", () =>
      HttpResponse.json({
        user: {
          name: "田中 寛志",
          firstName: "寛志",
          org: "ARag, Inc.",
          initials: "HT",
          email: "hiroshi.tanaka@arag.dev",
        },
      })
    ),
  ],
};
