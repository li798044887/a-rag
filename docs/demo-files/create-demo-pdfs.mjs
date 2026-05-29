import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(__dirname, "../../node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core"));

const docs = [
  {
    file: "01-mineru-layout-report.pdf",
    title: "MinerU 前処理デモ用: レイアウト混在レポート",
    html: `
      <section class="cover">
        <p class="eyebrow">ARag Demo Fixture</p>
        <h1>設備保全AI導入レポート</h1>
        <p class="subtitle">表・図表キャプション・数式・階層見出しを含むPDF</p>
        <div class="meta">版: 2026-05-28 / 作成: サンテック DX推進室</div>
      </section>
      <section>
        <h2>1. 要約</h2>
        <p>2026年度第2四半期の設備保全AI導入では、ラインAの予兆検知を優先する。最重要KPIは「停止時間を月間18時間から12時間へ削減すること」である。</p>
        <p>PoCは2026年6月10日に開始し、2026年7月19日に終了する。判定会議は2026年7月22日 10:00から開催する。</p>
        <h3>1.1 採用判断</h3>
        <p>採用条件は、重大アラートの適合率が82%以上、平均通知遅延が90秒以内、現場確認工数が週6時間以内であること。</p>
      </section>
      <section>
        <h2>2. 対象ライン比較</h2>
        <table>
          <caption>表1: PoC対象ラインの比較。MinerUで表ブロックとして抽出されることを想定。</caption>
          <thead>
            <tr><th>ライン</th><th>月間停止時間</th><th>主要センサー</th><th>優先度</th><th>備考</th></tr>
          </thead>
          <tbody>
            <tr><td>A</td><td>18時間</td><td>振動・温度・電流</td><td>高</td><td>ベアリング劣化の兆候が多い</td></tr>
            <tr><td>B</td><td>9時間</td><td>温度・圧力</td><td>中</td><td>材料ロット差の影響が大きい</td></tr>
            <tr><td>C</td><td>4時間</td><td>画像・電流</td><td>低</td><td>既存ルールで十分に検知可能</td></tr>
          </tbody>
        </table>
      </section>
      <section class="page-break">
        <h2>3. スコアリング式</h2>
        <p>設備リスクスコアは以下の式で算出する。</p>
        <div class="equation">Risk = 0.45 × Vibration + 0.35 × Temperature + 0.20 × Current</div>
        <p>Riskが0.72以上の場合は「要点検」、0.86以上の場合は「即時停止推奨」とする。</p>
        <figure>
          <div class="chart">
            <span style="height: 52%"></span><span style="height: 68%"></span><span style="height: 81%"></span><span style="height: 47%"></span>
          </div>
          <figcaption>図1: ラインAの直近4週間リスク推移。第3週に0.81まで上昇したが、停止推奨閾値0.86は超えていない。</figcaption>
        </figure>
      </section>
      <section>
        <h2>4. 体制とアクション</h2>
        <ul>
          <li>責任者: 佐藤（保全部）、副責任者: 林（DX推進室）。</li>
          <li>初回モデルレビューは2026年6月24日、最終レビューは2026年7月17日に行う。</li>
          <li>ラインAのセンサー欠損率が3%を超えた場合、PoC評価から該当日を除外する。</li>
        </ul>
      </section>
    `,
  },
  {
    file: "02-agentic-rag-policy-handbook.pdf",
    title: "Agentic RAG デモ用: 多段検索ポリシー",
    html: `
      <section class="cover">
        <p class="eyebrow">ARag Demo Fixture</p>
        <h1>出張・購買・例外申請ハンドブック</h1>
        <p class="subtitle">複数箇所の参照とフォローアップ質問を見せるための社内規程PDF</p>
        <div class="meta">施行日: 2026-04-01 / 改定: 2026-05-15</div>
      </section>
      <section>
        <h2>1. 国内出張</h2>
        <p>国内出張の交通費は、片道100km以上の場合に新幹線普通車指定席を標準とする。グリーン車は部長承認がある場合のみ利用できる。</p>
        <p>宿泊費の上限は東京都内が1泊18,000円、政令指定都市が1泊15,000円、その他地域が1泊12,000円である。</p>
        <h3>1.1 事前申請期限</h3>
        <p>国内出張の事前申請は、出発日の3営業日前17:00までに提出する。例外的な緊急保守対応では、事後2営業日以内の申請を認める。</p>
      </section>
      <section>
        <h2>2. 海外出張</h2>
        <p>海外出張は本部長承認を必須とし、航空券は原則エコノミークラスとする。ただし、連続飛行時間が8時間を超える場合はプレミアムエコノミーを選択できる。</p>
        <p>海外出張の事前申請は、出発日の10営業日前までに提出する。渡航リスクがレベル2以上の国・地域では法務確認も必要である。</p>
      </section>
      <section class="page-break">
        <h2>3. 購買申請</h2>
        <table>
          <caption>表1: 金額別の承認ルート</caption>
          <thead><tr><th>金額</th><th>承認者</th><th>見積書</th><th>SLA</th></tr></thead>
          <tbody>
            <tr><td>10万円未満</td><td>課長</td><td>任意</td><td>1営業日</td></tr>
            <tr><td>10万円以上50万円未満</td><td>部長</td><td>1社以上</td><td>2営業日</td></tr>
            <tr><td>50万円以上</td><td>本部長 + 経理</td><td>2社以上</td><td>4営業日</td></tr>
          </tbody>
        </table>
        <p>クラウドサービスの年間契約は、金額にかかわらず情報システム部のセキュリティ確認を必要とする。</p>
      </section>
      <section>
        <h2>4. 例外申請</h2>
        <p>例外申請には、理由、影響範囲、代替案、期限、承認者を明記する。承認者は原則として通常ルートの一段上位者とする。</p>
        <p>同一案件で出張と購買が同時に発生する場合、出張規程と購買規程の両方を満たす必要がある。矛盾がある場合は、より厳しい承認条件を採用する。</p>
        <h3>4.1 Agentic RAG向け確認例</h3>
        <p>「大阪への緊急保守で当日出発し、同時に60万円の交換部品を購入する場合」は、国内出張の緊急保守例外と、50万円以上の購買承認ルートの両方を確認する必要がある。</p>
      </section>
    `,
  },
  {
    file: "03-version-conflict-faq.pdf",
    title: "比較デモ用: 版差分FAQ",
    html: `
      <section class="cover">
        <p class="eyebrow">ARag Demo Fixture</p>
        <h1>社内AI利用FAQ 改定履歴</h1>
        <p class="subtitle">複数版の記述差分を比較させるためのPDF</p>
        <div class="meta">v1.3: 2026-03-01 / v1.4: 2026-05-20</div>
      </section>
      <section>
        <h2>v1.3 旧ルール</h2>
        <p>外部AIサービスへ投入できる文書は、公開情報または社外共有済み資料に限る。社内限定資料は、担当部長の個別許可がある場合のみ投入できる。</p>
        <p>生成AIの回答を顧客へ提示する場合は、担当者レビューを必須とする。レビュー記録の保存期間は90日である。</p>
      </section>
      <section class="page-break">
        <h2>v1.4 新ルール</h2>
        <p>外部AIサービスへ投入できる文書は、公開情報、社外共有済み資料、または匿名化済みの社内限定資料である。個人情報、未公開財務情報、顧客秘密情報は投入禁止とする。</p>
        <p>生成AIの回答を顧客へ提示する場合は、担当者レビューと根拠資料の確認を必須とする。レビュー記録の保存期間は180日である。</p>
        <h3>改定ポイント</h3>
        <ul>
          <li>匿名化済み社内限定資料の利用を条件付きで許可した。</li>
          <li>顧客提示時に根拠資料確認を追加した。</li>
          <li>レビュー記録の保存期間を90日から180日に延長した。</li>
        </ul>
      </section>
    `,
  },
];

const css = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Noto Sans CJK JP", "Yu Gothic", "Meiryo", Arial, sans-serif; color: #1d1b18; line-height: 1.62; }
  .cover { min-height: 84vh; display: flex; flex-direction: column; justify-content: center; border-bottom: 5px solid #176b6f; }
  .eyebrow { color: #176b6f; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 700; }
  h1 { font-size: 34px; line-height: 1.18; margin: 8px 0 14px; }
  h2 { font-size: 21px; margin: 26px 0 8px; border-left: 5px solid #176b6f; padding-left: 10px; }
  h3 { font-size: 16px; margin: 18px 0 6px; color: #284b63; }
  .subtitle { font-size: 15px; color: #5a5148; }
  .meta { margin-top: 24px; color: #6c6258; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 20px; font-size: 12px; }
  caption { text-align: left; color: #5a5148; margin-bottom: 6px; font-weight: 700; }
  th { background: #e8f2f2; color: #173f42; }
  th, td { border: 1px solid #9bb8ba; padding: 8px 9px; vertical-align: top; }
  .equation { margin: 14px 0; padding: 14px 18px; border: 1px solid #9bb8ba; background: #f3f8f8; font-family: Georgia, serif; font-size: 18px; text-align: center; }
  figure { margin: 16px 0; }
  figcaption { font-size: 12px; color: #554d45; margin-top: 8px; }
  .chart { height: 150px; border: 1px solid #9bb8ba; background: linear-gradient(#ffffff, #f6f6f2); display: flex; gap: 20px; align-items: flex-end; padding: 14px; }
  .chart span { display: block; width: 46px; background: #176b6f; }
  .page-break { break-before: page; }
`;

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
try {
  const page = await browser.newPage();
  for (const doc of docs) {
    await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${doc.title}</title><style>${css}</style></head><body>${doc.html}</body></html>`, {
      waitUntil: "networkidle",
    });
    await page.pdf({
      path: path.join(__dirname, doc.file),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  }
  await fs.writeFile(
    path.join(__dirname, "README.md"),
    `# ARag demo upload files\n\nGenerated PDF fixtures for tomorrow's demo.\n\n- 01-mineru-layout-report.pdf: table, equation, figure caption, headings. Use this to highlight MinerU preprocessing.\n- 02-agentic-rag-policy-handbook.pdf: multi-hop policy lookup and follow-up questions. Use this to highlight Agentic RAG.\n- 03-version-conflict-faq.pdf: version comparison and stricter/latest rule selection.\n`,
    "utf8",
  );
} finally {
  await browser.close();
}
