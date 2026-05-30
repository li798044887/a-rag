import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(
  __dirname,
  "../../node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core",
));

function svgData(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const coolingSvg = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460" viewBox="0 0 920 460">
  <rect width="920" height="460" fill="#f8faf8"/>
  <text x="34" y="42" font-family="Arial" font-size="24" font-weight="700" fill="#173f42">冷却ライン CL-2 異常箇所図</text>
  <rect x="70" y="160" width="120" height="70" rx="8" fill="#dff2ea" stroke="#176b6f" stroke-width="3"/>
  <text x="100" y="203" font-family="Arial" font-size="18" font-weight="700">P-04</text>
  <line x1="190" y1="195" x2="390" y2="195" stroke="#176b6f" stroke-width="14"/>
  <rect x="390" y="145" width="145" height="100" rx="8" fill="#fff5e7" stroke="#b86720" stroke-width="4"/>
  <text x="414" y="186" font-family="Arial" font-size="18" font-weight="700">HX-7</text>
  <text x="410" y="214" font-family="Arial" font-size="14">熱交換器</text>
  <line x1="535" y1="195" x2="720" y2="195" stroke="#176b6f" stroke-width="14"/>
  <circle cx="740" cy="195" r="38" fill="#ffffff" stroke="#176b6f" stroke-width="4"/>
  <text x="715" y="201" font-family="Arial" font-size="18" font-weight="700">V-12</text>
  <rect x="675" y="128" width="132" height="132" fill="none" stroke="#d0362f" stroke-width="6" stroke-dasharray="12 8"/>
  <text x="638" y="105" font-family="Arial" font-size="18" fill="#d0362f" font-weight="700">赤枠: 交換候補</text>
  <line x1="740" y1="233" x2="740" y2="350" stroke="#176b6f" stroke-width="12"/>
  <rect x="680" y="350" width="120" height="60" rx="8" fill="#e8eef7" stroke="#2e6fba" stroke-width="3"/>
  <text x="703" y="386" font-family="Arial" font-size="17" font-weight="700">BT-3</text>
  <circle cx="468" cy="96" r="28" fill="#fff" stroke="#d0362f" stroke-width="4"/>
  <text x="454" y="103" font-family="Arial" font-size="18" font-weight="700" fill="#d0362f">T2</text>
  <text x="504" y="102" font-family="Arial" font-size="15" fill="#333">温度上昇センサー</text>
  <circle cx="598" cy="304" r="28" fill="#fff" stroke="#d0362f" stroke-width="4"/>
  <text x="584" y="311" font-family="Arial" font-size="18" font-weight="700" fill="#d0362f">F1</text>
  <text x="634" y="311" font-family="Arial" font-size="15" fill="#333">流量低下センサー</text>
</svg>`);

const docs = [
  {
    file: "04-cross-page-table-semantic-loss.pdf",
    title: "月次設備点検台帳: ヘッダー欠落の継続表",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Maintenance Control</p>
        <h1>月次設備点検台帳</h1>
        <p class="subtitle">第2工場 主要設備の計測値・判定・対応予定</p>
        <div class="meta">対象月: 2026-05 / 保全部: 第2工場</div>
      </section>
      <section>
        <h2>1. 判定ルール</h2>
        <p>停止判断は、表中の「暫定判定」だけでは確定しない。同じ表の右側列にある注記コード、部品到着予定、本文の例外条件を照合すること。</p>
        <ul>
          <li>暫定判定が「停止候補」で、注記コードがN7の場合は、48時間以内に再測定する。</li>
          <li>暫定判定が「停止候補」で、注記コードがN9の場合は、即時停止を推奨する。</li>
          <li>ただし交換部品が翌営業日AMに到着する場合は、夜間停止枠まで運転継続できる。</li>
        </ul>
      </section>
      <section class="page-break">
        <h2>2. 点検表 A</h2>
        <p>点検表Aは設備ID順に記録する。判定時は計測値、暫定判定、注記コード、部品到着予定を同一行で確認する。</p>
        <table class="wide">
          <caption>表1: 点検表A（1/2）</caption>
          <thead><tr><th>設備ID</th><th>振動</th><th>温度</th><th>電流</th><th>暫定判定</th><th>注記コード</th><th>部品到着予定</th><th>担当班</th><th>補足</th></tr></thead>
          <tbody>
            <tr><td>MX-11</td><td>0.42</td><td>0.55</td><td>0.37</td><td>監視継続</td><td>N1</td><td>在庫あり</td><td>日勤A</td><td>通常点検</td></tr>
            <tr><td>MX-14</td><td>0.68</td><td>0.71</td><td>0.51</td><td>再点検</td><td>N7</td><td>翌々営業日</td><td>日勤B</td><td>センサー再校正</td></tr>
          </tbody>
        </table>
      </section>
      <section class="page-break no-heading">
        <table class="wide continued">
          <tbody>
            <tr><td>MX-17</td><td>0.91</td><td>0.88</td><td>0.74</td><td>停止候補</td><td>N9</td><td>翌営業日AM</td><td>夜勤C</td><td>軸受け交換が必要</td></tr>
            <tr><td>MX-21</td><td>0.49</td><td>0.63</td><td>0.58</td><td>監視継続</td><td>N2</td><td>在庫あり</td><td>日勤A</td><td>圧力変動あり</td></tr>
            <tr><td>MX-25</td><td>0.77</td><td>0.69</td><td>0.61</td><td>再点検</td><td>N7</td><td>翌営業日PM</td><td>夜勤C</td><td>潤滑状態を確認</td></tr>
          </tbody>
        </table>
        <h3>最終判断の補足</h3>
        <p>MX-17はN9のため即時停止推奨に該当する。ただし、部品到着予定が翌営業日AMであるため、夜間停止枠までの運転継続を例外的に認める。</p>
      </section>
    `,
  },
  {
    file: "05-image-grounding-cooling-line.pdf",
    title: "冷却ラインCL-2 異常報告",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Incident Report</p>
        <h1>冷却ライン CL-2 異常報告</h1>
        <p class="subtitle">温度上昇・流量低下の同時発生に関する一次対応記録</p>
        <div class="meta">発生日時: 2026-05-21 14:35 / 工場: 第2工場</div>
      </section>
      <section>
        <h2>1. 事象概要</h2>
        <p>冷却ラインCL-2で温度上昇と流量低下が同時に発生した。一次対応では、添付図面の赤枠部位を交換候補として扱う。</p>
        <table>
          <caption>表1: センサーイベント</caption>
          <thead><tr><th>センサー</th><th>値</th><th>閾値</th><th>状態</th></tr></thead>
          <tbody>
            <tr><td>T2</td><td>86.4℃</td><td>80.0℃</td><td>異常</td></tr>
            <tr><td>F1</td><td>42 L/min</td><td>55 L/min</td><td>異常</td></tr>
            <tr><td>P4</td><td>0.44 MPa</td><td>0.40 MPa以上</td><td>正常</td></tr>
          </tbody>
        </table>
      </section>
      <section class="page-break">
        <h2>2. 図面</h2>
        <figure>
          <img class="diagram" src="${coolingSvg}" alt="冷却ラインCL-2図面"/>
          <figcaption>図1: 冷却ラインCL-2の異常箇所。赤枠はV-12バイパス弁を示す。T2温度上昇とF1流量低下が同時に出た場合、V-12固着を第一候補として点検する。</figcaption>
        </figure>
        <h3>一次対応</h3>
        <p>V-12が固着している場合は、BT-3バイパスを閉じたうえでV-12を交換する。HX-7熱交換器は洗浄対象だが、交換対象ではない。</p>
      </section>
    `,
  },
  {
    file: "06-multi-file-requirement-request.pdf",
    title: "緊急購買要求: エッジAIゲートウェイ",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Purchase Request</p>
        <h1>緊急購買要求: エッジAIゲートウェイ</h1>
        <p class="subtitle">設備保全AI PoC 向けエッジ推論機器の要求仕様</p>
        <div class="meta">申請番号: PR-2026-0519 / 申請者: 保全部</div>
      </section>
      <section>
        <h2>1. 必須要件</h2>
        <ul>
          <li>納期は2026-06-07まで。これを超える場合はPoC開始に間に合わない。</li>
          <li>日本国内リージョンでログ保管できること。</li>
          <li>画像データをクラウドへ送信しないローカル推論モードを持つこと。</li>
          <li>初年度費用は80万円以下を目安とする。ただし緊急保守の場合は95万円まで許容する。</li>
        </ul>
        <h2>2. 評価の優先順位</h2>
        <p>必須要件を満たす候補のうち、納期、セキュリティ適合、費用の順で評価する。</p>
      </section>
    `,
  },
  {
    file: "07-multi-file-security-policy.pdf",
    title: "外部機器・クラウド接続セキュリティ規程",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Information Security</p>
        <h1>外部機器・クラウド接続セキュリティ規程</h1>
        <p class="subtitle">購買判断に必要な制約条件</p>
        <div class="meta">版: v2.2 / 施行日: 2026-05-01</div>
      </section>
      <section>
        <h2>1. 工場データの取り扱い</h2>
        <p>画像データ、設備ログ、異常検知結果は工場機密情報に該当する。外部クラウドへ送信する場合は、国内リージョン、暗号化、監査ログ保存180日以上を必須とする。</p>
        <p>画像データをクラウドに送信しないローカル推論モードを持つ機器は、情報システム部の簡易確認で導入可能である。</p>
        <h2>2. ベンダー要件</h2>
        <ul>
          <li>ISO 27001または同等のセキュリティ認証を持つこと。</li>
          <li>緊急保守目的で95万円以下の場合、CISO承認は不要。ただし情シス確認は必要。</li>
          <li>海外リージョンのみのログ保管は不可。</li>
        </ul>
      </section>
    `,
  },
  {
    file: "08-multi-file-vendor-quotes.pdf",
    title: "エッジAIゲートウェイ 見積比較",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Procurement</p>
        <h1>エッジAIゲートウェイ 見積比較</h1>
        <p class="subtitle">初年度費用、納期、ログ保管、ローカル推論対応の比較</p>
        <div class="meta">取得日: 2026-05-22 / 購買部</div>
      </section>
      <section>
        <h2>1. 見積一覧</h2>
        <table>
          <caption>表1: ベンダー比較</caption>
          <thead><tr><th>候補</th><th>初年度費用</th><th>納期</th><th>ログ保管</th><th>ローカル推論</th><th>認証</th></tr></thead>
          <tbody>
            <tr><td>AlphaGate X2</td><td>92万円</td><td>2026-06-05</td><td>国内リージョン / 365日</td><td>あり</td><td>ISO 27001</td></tr>
            <tr><td>BetaEdge Mini</td><td>74万円</td><td>2026-06-15</td><td>国内リージョン / 180日</td><td>あり</td><td>ISO 27001</td></tr>
            <tr><td>GammaVision Cloud</td><td>68万円</td><td>2026-06-04</td><td>海外リージョン / 90日</td><td>なし</td><td>SOC2</td></tr>
          </tbody>
        </table>
        <p>AlphaGate X2は緊急保守枠の95万円以内であり、納期も要求仕様を満たす。BetaEdge Miniは費用が安いが納期を満たさない。GammaVision Cloudはログ保管条件とローカル推論要件を満たさない。</p>
      </section>
    `,
  },
  {
    file: "09-query-rewrite-acronym-runbook.pdf",
    title: "運用略語集と障害Runbook",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech SRE Operations</p>
        <h1>運用略語集と障害Runbook</h1>
        <p class="subtitle">収益イベント配送経路の監視・一次対応手順</p>
        <div class="meta">版: 2026-05 / SREチーム</div>
      </section>
      <section>
        <h2>1. 略語集</h2>
        <table>
          <caption>表1: 運用略語</caption>
          <thead><tr><th>略語</th><th>正式名称</th><th>意味</th></tr></thead>
          <tbody>
            <tr><td>RED route</td><td>Revenue Event Delivery route</td><td>売上計上イベントを配送するKafka経路</td></tr>
            <tr><td>P2 chatter</td><td>Priority 2 alert chattering</td><td>P2アラートが短時間に発火と復旧を繰り返す状態</td></tr>
            <tr><td>shadow ack</td><td>shadow acknowledgement</td><td>本番通知前に検証用通知だけを確認する運用</td></tr>
          </tbody>
        </table>
      </section>
      <section class="page-break">
        <h2>2. RED route P2 chatter対応</h2>
        <p>RED routeでP2 chatterが発生した場合、最初にKafka consumer lagを確認し、次にdedupe windowを60秒から180秒へ一時変更する。</p>
        <p>dedupe window変更後も10分以内に再発する場合、shadow ackを有効化し、顧客通知を一時停止する。恒久対応はイベントIDのidempotency keyを注文ID + 明細IDに変更することである。</p>
      </section>
    `,
  },
  {
    file: "10-exception-latest-rule-conflict.pdf",
    title: "AI回答の顧客提示ルール: 例外メモ付き",
    html: `
      <section class="cover">
        <p class="eyebrow">Suntech Compliance Notice</p>
        <h1>AI回答の顧客提示ルール: 例外メモ付き</h1>
        <p class="subtitle">顧客向けFAQ回答に関するレビュー・承認・保存要件</p>
        <div class="meta">関連文書: v1.4規程 / 例外メモ EX-44</div>
      </section>
      <section>
        <h2>1. v1.4 基本ルール</h2>
        <p>AI回答を顧客へ提示する場合、担当者レビュー、根拠資料確認、レビュー記録180日保存を必須とする。高リスク顧客に提示する場合は、部長承認も必要である。</p>
        <h2>2. 例外メモ EX-44</h2>
        <p>2026-05-10から2026-06-10まで、カスタマーサクセス部の低リスク顧客向けFAQ回答に限り、部長承認を省略できる。ただし担当者レビュー、根拠資料確認、180日保存は省略できない。</p>
        <h2>3. 期限切れ時の扱い</h2>
        <p>例外期限を過ぎた場合は、自動的に基本ルールへ戻る。例外メモの延長にはCISOと法務の承認が必要である。</p>
      </section>
    `,
  },
];

const css = `
  @page { size: A4; margin: 17mm 15mm; }
  body { font-family: "Noto Sans CJK JP", "Yu Gothic", "Meiryo", Arial, sans-serif; color: #1d211f; line-height: 1.62; }
  .cover { min-height: 84vh; display: flex; flex-direction: column; justify-content: center; border-bottom: 5px solid #176b6f; }
  .eyebrow { color: #176b6f; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 700; }
  h1 { font-size: 32px; line-height: 1.2; margin: 8px 0 14px; }
  h2 { font-size: 21px; margin: 24px 0 8px; border-left: 5px solid #176b6f; padding-left: 10px; }
  h3 { font-size: 16px; margin: 18px 0 6px; color: #284b63; }
  .subtitle { font-size: 15px; color: #5a5148; }
  .meta { margin-top: 24px; color: #6c6258; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 20px; font-size: 12px; }
  table.wide { font-size: 10px; }
  table.continued { margin-top: 0; }
  caption { text-align: left; color: #5a5148; margin-bottom: 6px; font-weight: 700; }
  th { background: #e8f2f2; color: #173f42; }
  th, td { border: 1px solid #9bb8ba; padding: 8px 9px; vertical-align: top; }
  ul { padding-left: 1.2rem; }
  li { margin: 6px 0; }
  figure { margin: 16px 0; }
  figcaption { font-size: 12px; color: #554d45; margin-top: 8px; }
  .diagram { display: block; width: 100%; border: 1px solid #9bb8ba; background: #fff; }
  .page-break { break-before: page; }
  .no-heading { padding-top: 0; }
`;

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

let executablePath;
for (const candidate of chromeCandidates) {
  try {
    await fs.access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // try next
  }
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  for (const doc of docs) {
    await page.setContent(
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${doc.title}</title><style>${css}</style></head><body>${doc.html}</body></html>`,
      { waitUntil: "networkidle" },
    );
    await page.pdf({
      path: path.join(__dirname, doc.file),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  }
} finally {
  await browser.close();
}
