/**
 * 営業ミーティングの議事録生成プロンプト。
 *
 * 文字起こし(または貼り付けテキスト)から、構造化された議事録本文を生成する。
 * 出力は議事録テキストそのもの(JSON ではない)。表示は whitespace-pre-wrap。
 */

const SYSTEM = `あなたは営業ミーティングの議事録作成アシスタントです。
与えられた文字起こし(または貼り付けテキスト)から、簡潔で構造化された議事録を日本語で作成します。

# 出力形式(次の見出しをこの順で。該当が無ければ「特になし」と書く)
【参加者・状況】
【要点】
【相手の課題・ニーズ】
【決定事項】
【懸念・反論】
【ネクストアクション】

# ルール
1. 文字起こしに書かれていない事実(数値・社名・約束等)を創作しない。推測は「(推測)」と明記する。
2. 箇条書き中心で簡潔に。固有名詞・数字・日付は正確に拾う。
3. 出力は議事録の本文のみ。前置き・解説・コードブロック・マークダウンの見出し記号(#)は使わない。`;

export function buildSalesMinutesPrompt(
  sourceText: string,
  companyContext?: string | null,
): { system: string; prompt: string } {
  const ctx = (companyContext ?? "").trim();
  const ctxBlock = ctx ? `# この会社について特に注目してほしい観点\n${ctx}\n\n` : "";
  const prompt = `${ctxBlock}以下の内容から営業ミーティングの議事録を作成してください。

---
${sourceText}
---`;
  return { system: SYSTEM, prompt };
}
