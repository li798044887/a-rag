import { modals as zhModals } from "../zh/modals";

export const modals: typeof zhModals = {
  // 言語切替（既存、維持）
  languageLabel: "言語",
  languageHint: "UI と回答の言語",
  languageSwitchTitle: "言語を切り替える",
  languageSwitchDesc: "言語を切り替えるとページが再読み込みされます。続けますか？",

  // ===== settings-modal =====
  settingsTitle: "設定",

  navModel: "モデル",
  navSources: "データソース",
  navAgent: "エージェント挙動",
  navAppearance: "外観",
  navSecurity: "セキュリティ",
  navAccount: "アカウント",

  modelPrivacyNote:
    "プロンプト・回答はログに保存されますが、モデル提供元に利用・または学習されることがありません。",

  agentMaxStepsLabel: "最大ステップ数",
  agentMaxStepsHint: "エージェントが取れる最大のツール呼出し回数",
  agentParallelToolsLabel: "並列ツール実行",
  agentParallelToolsHint: "同時に走らせるツール数",
  agentRequireCitationsLabel: "引用の必須化",
  agentRequireCitationsHint: "回答中の各事実に引用を付けることを強制",
  agentAdmitUnknownLabel: '未知の場合に "わからない" と返す',

  appearanceDarkModeLabel: "ダークモード",
  appearanceDarkModeHint: "目に優しい暗い配色に切り替えます",
  appearanceAccentColorLabel: "アクセントカラー",
  appearanceToolViewLabel: "ツール実行の表示",
  appearanceToolViewHint: "エージェントのツール呼び出しの見せ方",
  appearanceToolViewCard: "カード（折りたたみ）",
  appearanceToolViewTimeline: "タイムライン",
  appearanceToolViewLog: "ターミナル風ログ",
  appearanceDensityLabel: "情報密度",
  appearanceDensityCompact: "コンパクト",
  appearanceDensityComfy: "快適",
  appearanceCitationStyleLabel: "引用スタイル",
  appearanceCitationStyleNumbered: "上付き番号",
  appearanceCitationStyleChip: "[N] チップ",
  appearanceCitationStylePill: "ピル形",

  securityJwtTitle: "現在のJWT (デコード)",
  securityCopyBtn: "コピー",
  securityCopiedBtn: "コピーしました",
  securityClaimsLoading: "// セッションを読み込み中…",
  securityTokenExpiryLabel: "トークン有効期限",
  securityTokenExpiryHint: "exp 到達時に自動で再ログインが必要になります",
  securityTokenRemainingFormat: "{lifetime} (残り {remaining})",
  securityTokenExpired: "期限切れ",
  securityTokenLifetimeHours: "{h}時間",
  securityRememberTokenLabel: "Refresh Token を保存",
  securityRememberTokenHint:
    "ON: ブラウザを閉じても 30 日間サインインを保持 / OFF: 終了で破棄",
  securityRevokeAllBtn: "全デバイスでサインアウト",
  securityRevokingBtn: "サインアウト中…",

  accountDisplayNameLabel: "表示名",
  accountLanguageLabel: "言語",

  // ===== help-modal =====
  helpAriaLabel: "ARag ヘルプ",
  helpVersion: "v2.4 · ヘルプ",

  helpTabOverview: "概要",
  helpTabWorkflow: "基本の流れ",
  helpTabFeatures: "主要機能",
  helpTabShortcuts: "ショートカット",
  helpTabTips: "うまく使うコツ",

  helpDocs: "ドキュメント",
  helpContactSupport: "サポートに連絡",

  overviewHeroTag: "AGENTIC RAG",
  overviewHeroTitle: "社内ナレッジに、エージェントの目で。",
  overviewHeroBody:
    "ARag は議事録・Wiki・Slack・DB を横断して質問に答える <strong>エージェント型 RAG アシスタント</strong> です。単純な検索ではなく、複数ステップで情報源を辿り、引用付きで根拠を示します。",
  overviewStatDocs: "索引中のドキュメント",
  overviewStatSources: "接続データソース",
  overviewStatSpeed: "平均回答時間",
  overviewCard01Title: "基本の流れ",
  overviewCard01Desc: "質問 → エージェント実行 → 引用付き回答までの3ステップ。",
  overviewCard02Title: "主要機能",
  overviewCard02Desc: "スコープ・添付・ツール可視化・引用パネル・共有の使い方。",
  overviewCard03Title: "ショートカット",
  overviewCard03Desc: "⌘N / ⌘K / ⌘B など、手を止めずに操作するためのキー。",
  overviewCard04Title: "うまく使うコツ",
  overviewCard04Desc: "質問の書き方・精度を上げる小ワザ・避けたい使い方。",

  workflowLead: "ARag は <strong>3つのフェーズ</strong> で動きます。各フェーズはすべて画面上で可視化され、いつでも介入できます。",
  workflowStep01Title: "質問を入力する",
  workflowStep01Body:
    "画面下のコンポーザーに自然文で質問を入力します。「いつ」「誰が」「なぜ」など5W1Hを含めると精度が上がります。",
  workflowStep01Hint:
    "左のスコープピッカーで対象範囲（全社・プロジェクト・特定チーム）を絞り込めます。",
  workflowStep02Title: "エージェントが情報源を辿る",
  workflowStep02Body:
    "クエリ分解 → ベクトル検索 → 一次資料の取得 → 重複排除 → 回答生成、と複数ステップで動作します。途中経過はツール実行カードでリアルタイムに確認できます。",
  workflowStep02Hint: "誤った方向に進んだら ⌘⌫ または停止ボタンで即座にキャンセル可能。",
  workflowStep03Title: "引用付きの回答を受け取る",
  workflowStep03Body:
    "回答中の番号 [1] [2] が一次資料への引用です。クリックすると右パネルで該当セクションがハイライトされ、根拠を確認できます。",
  workflowStep03Hint:
    "👍/👎 でフィードバック、コピー・再生成・Markdown エクスポートにも対応。",

  featuresLead: "ARag の各機能は <strong>少ない操作で深く掘る</strong> ことを目的に設計されています。",
  featScopeTitle: "検索範囲のスコープ",
  featScopeBody:
    "コンポーザー左のピッカーから「全社」「プロジェクト単位」「データソース指定」など対象を絞り込めます。広すぎる範囲はノイズの原因に。まずは狭く始めて広げるのがおすすめ。",
  featAttachTitle: "ファイル添付",
  featAttachBody:
    "PDF・Word・スプレッドシート・画像をドラッグ＆ドロップで質問に添付できます。「この資料の要点をまとめて」「決定事項を抽出して」など、添付ファイル前提の質問にそのまま対応。",
  featStepsTitle: "ツール実行の可視化",
  featStepsBody:
    "各ステップ（クエリ分解・検索・取得・要約）がカードで表示されます。Tweaks パネルから「カード」「タイムライン」「ターミナル風ログ」の3表示に切り替え可能。",
  featCiteTitle: "引用と一次資料パネル",
  featCiteBody:
    "回答中の [1] [2] をクリックすると右パネルが開き、該当箇所がハイライトされます。一次資料はそのままダウンロード・新規タブで閲覧・共有リンクで配布できます。",
  featThreadTitle: "スレッド管理",
  featThreadBody:
    "過去の質問はサイドバーから即座に再オープン。検索ボックスで履歴を絞り込み、スター・プロジェクト・データソースのコレクションにまとめられます。",
  featShareTitle: "共有とエクスポート",
  featShareBody:
    "スレッド全体を共有リンク or Markdown でエクスポート。一次資料は単体でも共有できます。社内向けは閲覧権限を引き継ぎ、社外向けはマスク済みコピーを生成。",

  shortcutsLead: "<strong>⌘</strong> は macOS、Windows / Linux では <strong>Ctrl</strong> に読み替えてください。",
  shortcutsGroupBasic: "基本操作",
  shortcutsNewThread: "新規スレッドを開く",
  shortcutsOpenSettings: "設定を開く",
  shortcutsToggleSidebar: "サイドバーを開閉",
  shortcutsOpenSidebar: "サイドバーを開く",
  shortcutsCloseModal: "モーダル / パネルを閉じる",
  shortcutsGroupRunning: "実行中",
  shortcutsStopAgent: "エージェントの実行を停止",
  shortcutsSend: "質問を送信",
  shortcutsNewline: "コンポーザーで改行",
  shortcutsGroupAnswer: "回答",
  shortcutsCopyAnswer: "回答をコピー（フォーカス時）",
  shortcutsRegenerate: "回答を再生成",
  shortcutsJumpCitation: "引用 [N] にジャンプ",

  tipsLead: "質問の書き方ひとつで、エージェントの体感速度と精度は大きく変わります。",
  tipDo01Title: "具体的な制約を含める",
  tipDo01Body:
    "「2024年Q3の」「営業チームの」など期間・主体・対象を明示すると、エージェントが検索範囲を絞れます。",
  tipDo02Title: "複数の質問は分割する",
  tipDo02Body:
    "「Aの背景と、Bの今後の方針」のような複合質問は精度が下がります。スレッドを分けるか、順番に聞きましょう。",
  tipDo03Title: "略語は展開する",
  tipDo03Body:
    "社内特有の略語（例: PJK, OKR-Q3）は初出で展開すると、エージェントが正しい索引にヒットしやすくなります。",
  tipDont01Title: "機密情報の社外共有",
  tipDont01Body:
    "スレッド共有時は権限が引き継がれます。社外向けには「マスク済みコピー」を選択してください。",
  tipDont02Title: "広すぎるスコープ",
  tipDont02Body:
    "常に「全社」で検索するとノイズが増えます。プロジェクト / チーム単位に絞ると速度も精度も向上します。",
  tipDont03Title: "回答の鵜呑み",
  tipDont03Body:
    "エージェントは引用元を示しますが、解釈は必ず一次資料で確認してください。👎 フィードバックは改善に反映されます。",
  tipsTryTitle: "まずは試してみる",
  tipsTryDesc: "空のスレッドにあるサジェスト質問から、エージェントの動きを体感できます。",
  tipsTryNewThread: "で新規スレッド",

  // ===== share-modal =====
  shareItemTitle: "資料を共有",
  shareThreadTitle: "スレッドを共有",
  shareAccessLabel: "アクセス権限",
  sharePermPrivateLabel: "自分のみ",
  sharePermPrivateDesc: "リンクを知っていてもアクセスできません",
  sharePermTeamLabel: "チーム内 (ARag, Inc.)",
  sharePermTeamDesc: "ログインしている社員のみ",
  sharePermLinkLabel: "リンクを知っている人",
  sharePermLinkDesc: "社外でも閲覧可能",
  shareCopyBtn: "コピー",
  shareCopiedBtn: "コピー済",
  shareCancelBtn: "キャンセル",
  shareCopyAndCloseBtn: "リンクをコピーして閉じる",

  // ===== confirm-modal =====
  confirmDefaultLabel: "OK",
  cancelDefaultLabel: "キャンセル",
};
