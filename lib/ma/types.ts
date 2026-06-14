/**
 * マーケティングオートメーション(MA)機能の型定義
 *
 * 4 つのテーブルに対応:
 *   - ma_scenario_presets    全組織共通のシナリオ定義
 *   - ma_scenarios           組織別の有効化状態
 *   - ma_templates           シナリオごとの件名・本文(暗号化)
 *   - ma_consent_log         配信特約の同意ログ
 *
 * UI ではプリセット 7 件すべてを「シナリオカード」として表示し、
 * 組織が有効化したものだけ ma_scenarios に行ができる(LEFT JOIN)。
 */

import { z } from "zod";

// プリセットの配信対象軸(求職者向け / 採用担当者向け)。
// Phase C-1 では candidate のみ実装し、recruiter は将来追加。
export type MAAudience = "candidate" | "recruiter";

// 配信チャネル。Phase C-1 ではメールのみ。
export type MAChannel = "email";

// 同意ログの機能識別子。Phase C-1 では email_ma のみ運用。
export type MAFeature = "email_ma" | "line_ma";

// 配信特約のバージョン。UI 側で同意モーダルに表示する。
// バージョンを上げた場合は、既存組織は「再同意」が必要(古い consent では送信させない)。
export const CURRENT_EMAIL_MA_CONSENT_VERSION = "1.0";

/**
 * ma_scenario_presets 行の型
 */
export type ScenarioPreset = {
  id: string;
  key: string;
  audience: MAAudience;
  channel: MAChannel;
  name: string;
  description: string;
  triggerEvent: string;
  defaultTriggerDays: number;
  sortOrder: number;
};

/**
 * ma_scenarios 行の型(組織別の有効化状態)
 */
export type ScenarioActivation = {
  id: string;
  organizationId: string;
  presetId: string;
  isActive: boolean;
  triggerDaysOverride: number | null;
};

/**
 * UI / API で扱うシナリオビュー
 *
 * プリセットと、組織側の有効化レコード(あれば)を統合した「表示用」型。
 *   - activation === null:    まだ一度も有効化していない(プリセットのみ)
 *   - activation.isActive:    現在配信中かどうか
 *   - effectiveTriggerDays:   実際に使う日数(override が null ならプリセットのデフォルト)
 */
export type ScenarioView = {
  preset: ScenarioPreset;
  activation: ScenarioActivation | null;
  effectiveTriggerDays: number;
};

/**
 * ma_consent_log 行の型
 */
export type ConsentLogEntry = {
  id: string;
  organizationId: string;
  feature: MAFeature;
  consentVersion: string;
  acceptedAt: string; // ISO timestamp
  acceptedByMemberId: string;
  revokedAt: string | null;
  revokedByMemberId: string | null;
};

/**
 * 同意状態のサマリ(UI で表示しやすい形)
 */
export type ConsentStatus = {
  feature: MAFeature;
  isActive: boolean; // 有効な同意が存在するか
  acceptedAt: string | null;
  acceptedByMemberName: string | null; // 表示用に既に展開済み
  consentVersion: string | null;
};

// ============================================
// API リクエスト/レスポンスのバリデーション
// ============================================

/**
 * PATCH /api/agency/ma/scenarios/[id] のリクエストボディ
 *
 * シナリオの有効化状態と、必要なら日数の上書きを更新する。
 * 一方だけ更新したい場合もあるため両方 optional。
 */
export const updateScenarioActivationSchema = z.object({
  presetId: z.string().uuid(),
  isActive: z.boolean().optional(),
  triggerDaysOverride: z
    .number()
    .int()
    .min(-365, "起点より前は最大365日前まで")
    .max(365, "起点より後は最大365日後まで")
    .nullable()
    .optional(),
});
export type UpdateScenarioActivationRequest = z.infer<typeof updateScenarioActivationSchema>;

/**
 * POST /api/agency/ma/consent のリクエストボディ
 *
 * 同意モーダルで「同意して進む」を押したときに呼ばれる。
 * バージョンはアプリ側の定数を送る(改竄防止のため API 側で再検証する)。
 */
export const recordConsentSchema = z.object({
  feature: z.enum(["email_ma", "line_ma"]),
  consentVersion: z.string().min(1),
});
export type RecordConsentRequest = z.infer<typeof recordConsentSchema>;

/**
 * DELETE /api/agency/ma/consent のリクエストボディ
 */
export const revokeConsentSchema = z.object({
  feature: z.enum(["email_ma", "line_ma"]),
});
export type RevokeConsentRequest = z.infer<typeof revokeConsentSchema>;

// ============================================
// テンプレート編集
// ============================================

/**
 * テンプレート内で利用可能な変数定義
 *
 * EMPRO の観測結果(candidate_* / agent_* / organization_name)に、
 * Maira の業務文脈で必須となる紹介先企業・求人・面談日の変数を追加。
 * cron 側の送信処理(Phase C-2 Step 3)で同じキーを使って実値展開する。
 *
 * UI(右パネル)では category でグルーピングして表示。
 */
export type TemplateVariable = {
  key: string;
  // 表示時のラベル(日本語)
  label: string;
  // 説明(クリック前のホバー or 説明文)
  description: string;
  // UI でのグルーピング用
  category: "candidate" | "agent" | "organization" | "referral";
};

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  // 候補者(求職者)
  {
    key: "candidate_name",
    label: "候補者のフルネーム",
    description: "姓 名 を 1 つにつなげた表記(例:山田 太郎)",
    category: "candidate",
  },
  {
    key: "candidate_last_name",
    label: "候補者の姓",
    description: "姓のみ(例:山田)",
    category: "candidate",
  },
  {
    key: "candidate_first_name",
    label: "候補者の名",
    description: "名のみ(例:太郎)",
    category: "candidate",
  },
  {
    key: "candidate_email",
    label: "候補者のメールアドレス",
    description: "登録済みのメールアドレス",
    category: "candidate",
  },
  // 担当アドバイザー
  {
    key: "agent_name",
    label: "担当者のフルネーム",
    description: "担当 CA の姓 名(例:大川 亮介)",
    category: "agent",
  },
  {
    key: "agent_last_name",
    label: "担当者の姓",
    description: "担当 CA の姓のみ",
    category: "agent",
  },
  {
    key: "agent_first_name",
    label: "担当者の名",
    description: "担当 CA の名のみ",
    category: "agent",
  },
  // 自社組織
  {
    key: "organization_name",
    label: "自社の組織名",
    description: "エージェント企業の組織名",
    category: "organization",
  },
  // 紹介(referral)コンテキスト — 紹介中の求人がある場合のみ展開可能
  {
    key: "company_name",
    label: "紹介先企業名",
    description: "現在進行中の選考プロセスの企業名(紹介が無いシナリオでは空文字)",
    category: "referral",
  },
  {
    key: "job_title",
    label: "求人名",
    description: "現在進行中の選考プロセスの求人タイトル",
    category: "referral",
  },
  {
    key: "interview_date",
    label: "面談予定日",
    description: "次回の面談予定日(yyyy/mm/dd 形式)",
    category: "referral",
  },
] as const;

/**
 * テンプレート 1 件の表示用ビュー
 *
 * 編集 UI に渡す。subject / body は復号済みの平文。
 * テンプレートが未作成(プリセット直後)なら subject/body は null。
 */
export type TemplateView = {
  scenarioId: string;
  presetName: string;
  presetDescription: string;
  presetAudience: MAAudience;
  presetChannel: MAChannel;
  subject: string | null;
  body: string | null;
  updatedAt: string | null;
};

/**
 * PUT /api/agency/ma/templates/[scenarioId] のリクエストボディ
 *
 * 件名と本文を一括上書きする。両方とも空文字を許容しない
 * (空テンプレで配信されるのを防ぐため、UI でも保存ボタンを disable する)。
 */
export const upsertTemplateSchema = z.object({
  subject: z.string().min(1, "件名を入力してください").max(500, "件名は500文字以内"),
  body: z.string().min(1, "本文を入力してください").max(50000, "本文は50000文字以内"),
});
export type UpsertTemplateRequest = z.infer<typeof upsertTemplateSchema>;

// ============================================
// 実送信(Phase C-3)
// ============================================

/**
 * 「Edge Function 側で判定ロジックが実装済み」のシナリオキー
 *
 * 現状の Maira の DB スキーマ(client_records / client_interactions のみ)で
 * 動作するシナリオに限定する。残りは将来テーブル追加(interviews / job_wants
 * / candidate_birthdays)後に有効化する。
 *
 * UI 側でこの集合に含まれないシナリオは「未対応」バッジを出し、
 * 有効化ボタンを disable する(無意味なテンプレ編集を防ぐため)。
 */
export const IMPLEMENTED_SCENARIO_KEYS = [
  "register_meeting_promotion", // client_records 作成 N 日後、interactions が 0 件
  "dormant_outreach", // 最終 interaction から N 日経過
] as const;

export type ImplementedScenarioKey = (typeof IMPLEMENTED_SCENARIO_KEYS)[number];

/**
 * シナリオキーが実装済みかどうかの判定ヘルパー。
 * UI でも Edge Function でも使う想定。
 */
export function isScenarioImplemented(key: string): key is ImplementedScenarioKey {
  return (IMPLEMENTED_SCENARIO_KEYS as readonly string[]).includes(key);
}

/**
 * ma_send_logs 1 行の型(画面表示・JSON シリアライズ用)
 *
 * 件名・本文は復号後の平文を入れる前提。RLS で同 org メンバーは閲覧可能。
 * 監査ログとして UI 表示する場合は復号して見せる(送信履歴画面、未実装)。
 */
export type SendLog = {
  id: string;
  organizationId: string;
  scenarioId: string;
  recipientClientRecordId: string | null;
  recipientEmail: string;
  subject: string; // 復号後
  body: string; // 復号後
  sentAt: string;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  resendMessageId: string | null;
};

/**
 * 送信ログ書き込み時の入力(Edge Function から service_role で書き込む)
 */
export type RecordSendLogInput = {
  organizationId: string;
  scenarioId: string;
  recipientClientRecordId: string | null;
  recipientEmail: string;
  subject: string; // 平文(関数内で暗号化)
  body: string; // 平文(関数内で暗号化)
  status: "sent" | "failed" | "skipped";
  errorMessage?: string | null;
  resendMessageId?: string | null;
};
