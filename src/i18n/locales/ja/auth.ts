import { auth as zhAuth } from "../zh/auth";

export const auth: typeof zhAuth = {
  // ブランドサブタイトル
  brandSubtitle: "社内ナレッジ・エージェント",

  // ページ見出し
  headingSignin: "おかえりなさい",
  headingSignup: "アカウント作成",
  headingReset: "パスワードリセット",

  // ページ説明
  descSignin: "社内SSOまたはメールでサインインしてください",
  descSignup: "メールアドレスとパスワードでアカウントを作成してください",
  descReset: "リセット用のリンクをメールで送信します",

  // フィールドラベル
  labelEmail: "メールアドレス",
  labelName: "氏名",
  labelPassword: "パスワード",

  // プレースホルダー
  placeholderName: "山田 太郎",
  placeholderPassword: "8文字以上",

  // パスワードトグル
  forgotPassword: "お忘れですか？",
  showPassword: "表示",
  hidePassword: "隠す",

  // ログイン状態保持
  rememberDevice: "このデバイスを記憶する",
  rememberDeviceHint: "(JWT refresh token を 30日間保存)",

  // エラーメッセージ
  errorSignin: "サインインに失敗しました。もう一度お試しください。",
  errorSignup: "登録に失敗しました。もう一度お試しください。",

  // 送信ボタン — アイドル
  submitSignin: "サインイン",
  submitSignup: "アカウントを作成",
  submitReset: "リセットリンクを送信",

  // 送信ボタン — 処理中
  busySignin: "JWTを発行中…",
  busySignup: "作成中…",
  busyReset: "送信中…",

  // SSOセパレーター
  orDivider: "または",

  // フッターリンク / 切り替え
  newHere: "初めて？",
  signUp: "サインアップ",
  alreadyHaveAccount: "既にアカウントがある？",
  backToSignin: "← サインインに戻る",

  // セキュリティフッター
  securityBadge: "JWT認証 · HS256 · 24h アクセストークン",
};
