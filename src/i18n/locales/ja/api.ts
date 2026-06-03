import { api as zhApi } from "../zh/api";

export const api: typeof zhApi = {
  // スレッド
  newThread: "新しいスレッド",
  updatedJustNow: "たった今",

  // 認証 — ログイン
  emailPasswordRequired: "メールアドレスとパスワードが必要です",
  invalidCredentials: "認証情報が正しくありません",

  // 認証 — 登録
  emailPasswordMinLength: "メールアドレスと 8 文字以上のパスワードが必要です",
  emailAlreadyRegistered: "このメールアドレスは登録済みです",

  // ファイルアップロード
  fileTooLarge: "ファイルサイズが上限(50MB)を超えています",
  duplicateFile: "同じ内容のファイルが既にアップロードされています",
  indexingFailed: "索引化の開始に失敗しました",

  // アップロードストリーム
  jobNotFound: "ジョブが見つかりません",
  responseParseError: "レスポンス解析エラー",

  // ページメタデータ
  metaTitle: "ARag — Agentic RAG",
  metaDescription:
    "社内ナレッジ（議事録・Wiki・Slack・DB）を横断するエージェント型 RAG アシスタント。",
};
