/**
 * 運営 営業パイプライン(sales_prospects / sales_meetings)の型・スキーマ。
 *
 * 機密テキスト(トランスクリプト / 議事録 / AIアドバイス)は queries.ts の暗号化境界で
 * 暗号化 / 復号する。本ファイルの型は復号済み(平文)を扱う。
 */
import { z } from "zod";

/** 営業ステージ(DB の check 制約と一致させること)。 */
export const SALES_STAGE_KEYS = [
  "lead",
  "sales_1",
  "sales_2",
  "test_decided",
  "account_signed",
  "csv_onsite",
  "csv_followup",
  "trial",
  "proposal",
  "follow",
  "won",
  "lost",
] as const;

export type SalesStage = (typeof SALES_STAGE_KEYS)[number];

/** ステージ定義(表示ラベル + AI/プレイブック用の説明 + 終端フラグ)。 */
export type SalesStageDef = {
  key: SalesStage;
  label: string;
  /** このステージで何をすべきか(プレイブック。AI コーチングの前提に使う)。 */
  description: string;
  /** 終端(受注 / 失注)かどうか。 */
  terminal?: boolean;
  /** 失注など「負け」の終端。 */
  lost?: boolean;
};

export const SALES_STAGES: readonly SalesStageDef[] = [
  {
    key: "lead",
    label: "リード",
    description: "問い合わせ・見込みの段階。まだ商談前。初回営業のアポ取りを目指す。",
  },
  {
    key: "sales_1",
    label: "営業1回目",
    description: "初回の営業 Zoom。課題のヒアリングと Myaira の価値訴求を行う。",
  },
  {
    key: "sales_2",
    label: "営業2回目",
    description: "2回目の営業 Zoom。ここでテスト導入の意思決定を取りにいく。",
  },
  {
    key: "test_decided",
    label: "テスト導入決定",
    description: "テスト導入が決定。Zoom の終わり際に、その場で Myaira アカウントを即作成する。",
  },
  {
    key: "account_signed",
    label: "アカウント作成・NDA/規約署名",
    description:
      "初回オンボーディングで NDA と利用規約に署名。署名できれば、その場で CSV をもらう流れに繋げる。",
  },
  {
    key: "csv_onsite",
    label: "その場CSV",
    description: "署名直後にその場で CSV を受領・取込済み(最も速い理想経路)。",
  },
  {
    key: "csv_followup",
    label: "2〜3日後CSV(先導)",
    description:
      "その場で CSV を渡さない会社向け。2〜3日後にフォローミーティングを設定し、必ず CSV 取込作業を先導する。",
  },
  {
    key: "trial",
    label: "トライアル中(2週間)",
    description:
      "CSV 取込後、2週間のトライアル。旧来の1ヶ月・週次はハマらなかったため2週間に短縮している。",
  },
  {
    key: "proposal",
    label: "本契約提案",
    description: "トライアルの手応えを踏まえ、本契約(有料プラン)を提案する。",
  },
  {
    key: "follow",
    label: "フォロー",
    description: "検討中・保留のフォロー。再検討のきっかけ作りを行う。",
  },
  { key: "won", label: "受注", description: "本契約が成立(受注)。", terminal: true },
  { key: "lost", label: "失注", description: "見送り(失注)。", terminal: true, lost: true },
];

export const SALES_STAGE_LABEL: Record<SalesStage, string> = SALES_STAGES.reduce(
  (acc, s) => {
    acc[s.key] = s.label;
    return acc;
  },
  {} as Record<SalesStage, string>,
);

export type SalesMeetingSource = "upload" | "text";
export type SalesMeetingStatus = "processing" | "ready" | "failed";

// ── DB 行(snake_case) ──────────────────────────────────────────────
export type SalesProspectRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  stage: SalesStage;
  owner_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesMeetingRow = {
  id: string;
  prospect_id: string;
  meeting_no: number;
  stage: SalesStage | null;
  title: string | null;
  meeting_date: string | null;
  source: SalesMeetingSource;
  storage_path: string | null;
  original_filename: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  status: SalesMeetingStatus;
  status_message: string | null;
  encrypted_transcript: string | null;
  encrypted_minutes: string | null;
  encrypted_advice: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

// ── アプリ表現(camelCase・復号済み) ───────────────────────────────
export type SalesProspect = {
  id: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  stage: SalesStage;
  ownerUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SalesMeeting = {
  id: string;
  prospectId: string;
  meetingNo: number;
  stage: SalesStage | null;
  title: string | null;
  meetingDate: string | null;
  source: SalesMeetingSource;
  storagePath: string | null;
  originalFilename: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  status: SalesMeetingStatus;
  statusMessage: string | null;
  /** 復号済み。未生成 / 復号失敗時は空文字。 */
  transcript: string;
  minutes: string;
  advice: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── zod スキーマ ───────────────────────────────────────────────────
const emailOrEmpty = z
  .string()
  .max(254)
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "メール形式が不正です");

export const createProspectSchema = z.object({
  company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().max(100).optional().nullable(),
  contact_email: emailOrEmpty.optional().nullable(),
  stage: z.enum(SALES_STAGE_KEYS).optional(),
  notes: z.string().max(8000).optional().nullable(),
});
export type CreateProspectInput = z.infer<typeof createProspectSchema>;

export const updateProspectSchema = z.object({
  company_name: z.string().trim().min(1).max(200).optional(),
  contact_name: z.string().max(100).nullable().optional(),
  contact_email: emailOrEmpty.nullable().optional(),
  stage: z.enum(SALES_STAGE_KEYS).optional(),
  notes: z.string().max(8000).nullable().optional(),
});
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;

/** ミーティングのメタ情報(録音アップロード時は multipart、テキスト時は JSON で受ける)。 */
export const meetingMetaSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  meeting_date: z.string().max(20).optional().nullable(),
  stage: z.enum(SALES_STAGE_KEYS).optional().nullable(),
});
