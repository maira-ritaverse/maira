/**
 * AI 抽出 description の ★ 見出し セクション 解析
 *
 * job-extract-from-document.ts のプロンプトで AI に 下記の 区切りを 出力させる:
 *   ★ 仕事内容
 *   ...
 *   ★ 募集背景
 *   ...
 *   ★ 配属先 / チーム
 *   ...
 *
 * UI(求職者向け 詳細ページ / PDF 出力)で 各セクションを 個別 表示 する ために、
 * description を セクション配列 に 分解する 純粋関数。
 *
 * 設計判断:
 *   ・★ が 無い 場合(手動入力 / 旧 AI 出力)は section.title=null の 1 件 配列を 返す。
 *   ・★ の 行頭 / 行末の 空白は 許容。
 *   ・本文中の "★" は 引っかからない(行頭+ 空白+ タイトル文字列 まで を 見出しと 判定)。
 */
export type DescriptionSection = {
  /** "仕事内容" "募集背景" 等。★ 区切りなし or 「(冒頭の セクション無し 部分)」は null */
  title: string | null;
  /** 本文(複数行、改行保持) */
  body: string;
};

/** 各 ★ 見出しに 対応する 表示 メタ(順序 / 説明 アイコン)。UI 側で 使う。 */
export const JOB_DESCRIPTION_SECTION_ORDER = [
  "仕事内容",
  "募集背景",
  "配属先",
  "ポイント",
  "特徴",
  "給与備考",
  "福利厚生",
  "会社情報",
  "求人ID",
] as const;

/** プロンプトで 指示している ★ 見出し ラベルの 揺れを 吸収する 正規化テーブル。 */
const SECTION_TITLE_ALIASES: Record<string, string> = {
  仕事内容: "仕事内容",
  募集背景: "募集背景",
  配属先: "配属先",
  "配属先 / チーム": "配属先",
  チーム: "配属先",
  ポイント: "ポイント",
  "ポイント / 魅力": "ポイント",
  魅力: "ポイント",
  特徴: "特徴",
  給与備考: "給与備考",
  給与詳細: "給与備考",
  福利厚生: "福利厚生",
  会社情報: "会社情報",
  会社概要: "会社情報",
  求人ID: "求人ID",
};

// 見出しは「★ + 空白 + 既知タイトル」のみ。
// AI には 「原文の ★ や ◎ は 残して OK」と 指示している ため、本文中に
// "★コツコツ丁寧に..." のような 行が 入る。空白の 有無 + 既知タイトル の
// ホワイトリストで 見出しと 本文を 明確に 区別する。
const HEADING_PATTERN = /^\s*★\s+(.+?)\s*$/;

function isKnownHeading(raw: string): string | null {
  const aliased = SECTION_TITLE_ALIASES[raw];
  if (aliased) return aliased;
  // タイトル末尾の 補足を 落として 再判定:
  //   ・末尾コロン ":" "："(モデルが 「★ 仕事内容:」と 復唱する ケース)
  //   ・"(必須)" "(任意、ある場合のみ)" 等の 括弧補足
  // 先に コロンを 落とし、その後 括弧を 落とす(「仕事内容(…):」の 順にも 対応)。
  const stripped = raw
    .replace(/[:：]\s*$/u, "")
    .replace(/[((].*?[))]\s*$/u, "")
    .trim();
  if (stripped && stripped !== raw) {
    const aliased2 = SECTION_TITLE_ALIASES[stripped];
    if (aliased2) return aliased2;
  }
  return null;
}

export function parseJobDescription(description: string | null | undefined): DescriptionSection[] {
  if (!description) return [];
  const lines = description.split(/\r?\n/);
  const sections: DescriptionSection[] = [];
  let current: DescriptionSection = { title: null, body: "" };

  const flush = () => {
    const trimmed = current.body.replace(/^\s*\n+|\n+\s*$/g, "");
    if (current.title || trimmed.length > 0) {
      sections.push({ title: current.title, body: trimmed });
    }
  };

  for (const line of lines) {
    const m = line.match(HEADING_PATTERN);
    const known = m ? isKnownHeading(m[1].trim()) : null;
    if (m && known) {
      flush();
      current = { title: known, body: "" };
    } else {
      // ★ 始まりでも 既知 タイトル に 該当しなければ 本文として 扱う
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  flush();
  return sections;
}

/**
 * セクション配列を、表示順(JOB_DESCRIPTION_SECTION_ORDER)で ソート する。
 * 一覧に無い セクション は 末尾に 元の 順序を 保って 並べる。
 * 「null セクション」(★ 無しの 冒頭部分)は 常に 先頭。
 */
export function sortJobDescriptionSections(sections: DescriptionSection[]): DescriptionSection[] {
  const orderIndex = new Map<string, number>();
  JOB_DESCRIPTION_SECTION_ORDER.forEach((t, i) => orderIndex.set(t, i));
  const nullSec = sections.filter((s) => s.title === null);
  const rest = sections.filter((s) => s.title !== null);
  rest.sort((a, b) => {
    const ai = orderIndex.get(a.title!) ?? 999;
    const bi = orderIndex.get(b.title!) ?? 999;
    return ai - bi;
  });
  return [...nullSec, ...rest];
}

/**
 * 一覧カード用の「仕事内容」冒頭抜粋を返す。
 *
 * ・AI 抽出済み(★ 区切りあり)なら「★ 仕事内容」セクションの本文を使う。
 * ・★ が無い(手動入力 / 旧データ)場合は、最初の本文があるセクション
 *   (= ★無しなら description 全体の冒頭部分)にフォールバックする。
 * ・改行・連続空白は 1 スペースに畳んで 1 行の要約にし、maxLen で切って "…" を付ける。
 * ・本文が空 / description 無しなら null(呼び出し側で非表示にする)。
 *
 * 詳細ページの ★ セクション表示(parseJobDescription)と同じ解析を再利用するので、
 * 見出しの ★ マーカーは抜粋に混ざらない。
 */
export function jobSummaryExcerpt(
  description: string | null | undefined,
  maxLen = 100,
): string | null {
  const sections = parseJobDescription(description);
  if (sections.length === 0) return null;

  const jobContent = sections.find((s) => s.title === "仕事内容" && s.body.trim().length > 0);
  const source = jobContent ?? sections.find((s) => s.body.trim().length > 0);
  if (!source) return null;

  const text = source.body.replace(/\s+/g, " ").trim();
  if (!text) return null;

  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
}
