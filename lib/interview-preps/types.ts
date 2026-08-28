/**
 * 面接対策(interview_preps)の型定義。
 *
 * 内容は「見出し + 箇条書き項目」のセクション配列(構造化)。DB には
 * この構造を JSON 文字列にして AES-256-GCM 暗号化した encrypted_content で保存する。
 */

/** 面接対策の 1 セクション(例:「想定される質問」+ 箇条書き)。 */
export type InterviewPrepSection = {
  heading: string;
  items: string[];
};

/** 面接対策本文(構造化)。 */
export type InterviewPrepContent = {
  sections: InterviewPrepSection[];
};

/** DB 行(snake_case、encrypted_content は暗号化済み)。 */
export type InterviewPrepRow = {
  id: string;
  organization_id: string;
  referral_id: string;
  encrypted_content: string;
  model: string | null;
  generated_by_member_id: string | null;
  generated_at: string;
  // 求職者へ共有した日時。not null なら共有済み(求職者が閲覧可能)。再生成でリセットされる。
  shared_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 復号済みのアプリ表現(camelCase)。 */
export type InterviewPrep = {
  id: string;
  organizationId: string;
  referralId: string;
  content: InterviewPrepContent;
  model: string | null;
  generatedByMemberId: string | null;
  generatedAt: string;
  // 求職者へ共有した日時。not null なら共有済み(求職者が閲覧可能)。再生成で null に戻る。
  sharedAt: string | null;
  updatedAt: string;
};
