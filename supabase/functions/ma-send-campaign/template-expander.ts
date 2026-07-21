/**
 * テンプレート変数展開エンジン(Deno)
 *
 * テンプレート文中の `{{key}}` を実値で置換する。Web 側 `lib/ma/types.ts`
 * の TEMPLATE_VARIABLES と同じキーを Deno 側でも認識する。
 *
 * 設計方針:
 *   - 既知キーのみ置換する(未知の `{{xxx}}` はそのまま残す)
 *   - 値が null/undefined の場合は空文字に置換(`未設定` のようなプレースホルダは出さない)
 *     → 例:「{{organization_name}} の {{agent_name}} です」で agent 不在時に
 *        「Myaira の  です」となる。プレースホルダ文字列が本番メールに残るより自然。
 *   - 同じ {{key}} が複数回出てきても全部置換する(g フラグ)
 *
 * 変数値の供給:
 *   呼び出し側が VariableContext を組み立ててから渡す。クエリ済みのレコード
 *   (client_record / referral / organization 等)から値を引き出すのは index.ts の責務。
 */

export type VariableContext = {
  // 候補者(求職者)
  candidate_name?: string | null;
  candidate_last_name?: string | null;
  candidate_first_name?: string | null;
  candidate_email?: string | null;
  // 担当アドバイザー
  agent_name?: string | null;
  agent_last_name?: string | null;
  agent_first_name?: string | null;
  // 自社組織
  organization_name?: string | null;
  // 紹介・選考コンテキスト(Phase C-1 段階では未対応のシナリオで使う)
  company_name?: string | null;
  job_title?: string | null;
  interview_date?: string | null;
};

// アプリ全体で許可された変数キーの集合(タイポ検知用)
const ALLOWED_KEYS = new Set<keyof VariableContext>([
  "candidate_name",
  "candidate_last_name",
  "candidate_first_name",
  "candidate_email",
  "agent_name",
  "agent_last_name",
  "agent_first_name",
  "organization_name",
  "company_name",
  "job_title",
  "interview_date",
]);

/**
 * テンプレート文字列内の `{{key}}` を ctx の値で置換する。
 * 既知キーのみ対象。未知キーはそのまま残す(運用ミスを目立たせる)。
 */
export function expandTemplate(template: string, ctx: VariableContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, rawKey: string) => {
    const key = rawKey as keyof VariableContext;
    if (!ALLOWED_KEYS.has(key)) {
      // 未知キーは触らない(本番文面に `{{xxx}}` が残ると一目で運用ミスと分かる)
      return match;
    }
    const value = ctx[key];
    return value ?? "";
  });
}

/**
 * 件名と本文を一括展開する小ヘルパー(呼び出し側の見通しを良くする)
 */
export function expandSubjectAndBody(
  subject: string,
  body: string,
  ctx: VariableContext,
): { subject: string; body: string } {
  return {
    subject: expandTemplate(subject, ctx),
    body: expandTemplate(body, ctx),
  };
}
