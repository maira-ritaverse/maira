/**
 * キャリア面談アップロード(career_intake_recordings)の型 + zod スキーマ
 */
import { z } from "zod";

export type IntakeStatus =
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "failed_transcribe"
  | "extracting"
  | "extracted"
  | "failed_extract";

export type IntakeRecording = {
  id: string;
  userId: string;
  storagePath: string;
  originalFilename: string;
  sizeBytes: number;
  durationSeconds: number | null;
  status: IntakeStatus;
  statusMessage: string | null;
  /** 復号後の文字起こし(復号 API のみ) */
  transcript: string | null;
  /** 復号後の Claude 抽出 JSON(復号 API のみ) */
  extraction: ExtractionResult | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Claude による抽出結果の JSON スキーマ。
 * 履歴書 / 職務経歴書の下書きに利用する構造。
 */
export const extractionResultSchema = z.object({
  // 履歴書系
  nameKana: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  educationHistory: z
    .array(
      z.object({
        year: z.number().int().min(1950).max(2100).nullable(),
        month: z.number().int().min(1).max(12).nullable(),
        description: z.string().max(200),
      }),
    )
    .default([]),
  workHistory: z
    .array(
      z.object({
        year: z.number().int().min(1950).max(2100).nullable(),
        month: z.number().int().min(1).max(12).nullable(),
        description: z.string().max(200),
      }),
    )
    .default([]),
  licenses: z
    .array(
      z.object({
        year: z.number().int().min(1950).max(2100).nullable(),
        month: z.number().int().min(1).max(12).nullable(),
        name: z.string().max(200),
      }),
    )
    .default([]),
  motivationNote: z.string().nullable().optional(),
  // 職務経歴書系
  // - careerSummary:CV 冒頭の総括
  // - workExperiences:CV の構造化職歴
  // - skills:CV のスキル一覧(category は固定 enum、軽くマッピングする)
  // - selfPr:自己 PR
  careerSummary: z.string().nullable().optional(),
  selfPr: z.string().nullable().optional(),
  workExperiences: z
    .array(
      z.object({
        // 会話の流れで「会社名が出てこない」状態(業界の話だけしている等)で AI が
        // null を返すケースがある。required にすると スキーマ検証で 全エントリ脱落
        // するので、nullable で受けて 表示側で フォールバック("(社名不明)")する。
        companyName: z.string().max(200).nullable().optional(),
        industry: z.string().max(100).nullable().optional(),
        position: z.string().max(200).nullable().optional(),
        // 期間(年月で扱う、不明なら null)
        startYear: z.number().int().min(1950).max(2100).nullable().optional(),
        startMonth: z.number().int().min(1).max(12).nullable().optional(),
        endYear: z.number().int().min(1950).max(2100).nullable().optional(),
        endMonth: z.number().int().min(1).max(12).nullable().optional(),
        jobDescription: z.string().max(2000).default(""),
        achievements: z.string().max(2000).default(""),
      }),
    )
    .default([]),
  // 旧 skillsSummary はバックアップ(文章形式)
  skillsSummary: z.string().nullable().optional(),
  skills: z
    .array(
      z.object({
        category: z
          .enum(["language", "framework", "tool", "soft_skill", "domain", "other"])
          .default("other"),
        name: z.string().max(100),
        level: z.enum(["basic", "intermediate", "advanced"]).nullable().optional(),
      }),
    )
    .default([]),
  // 希望条件
  desiredIndustries: z.array(z.string()).default([]),
  desiredOccupations: z.array(z.string()).default([]),
  desiredLocations: z.array(z.string()).default([]),
  desiredAnnualIncome: z.number().int().min(0).max(99999).nullable().optional(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// ────────────────────────────────────────────
// クエリ層から戻す行型(暗号文のまま、UI には渡さない)
// ────────────────────────────────────────────
export type IntakeRecordingRow = {
  id: string;
  user_id: string;
  storage_path: string;
  original_filename: string;
  size_bytes: number;
  duration_seconds: number | null;
  status: IntakeStatus;
  status_message: string | null;
  encrypted_transcript: string | null;
  encrypted_extraction: string | null;
  created_at: string;
  updated_at: string;
};

// ────────────────────────────────────────────
// API リクエスト型
// ────────────────────────────────────────────
/**
 * 履歴書への反映方針:
 *   - targetResumeId 指定なし → 新規作成(targetTitle 必須、デフォルト値あり)
 *   - targetResumeId 指定あり → 既存にマージ(配列は追記、空フィールドのみ埋める)
 *
 * マージ方針:
 *   - 配列(education_history、licenses):description / name の重複は除外して追記
 *   - 文字列(motivation_note):既存が空のときだけ抽出値で埋める。ユーザ編集を尊重
 */
export const applyToResumeSchema = z.object({
  targetTitle: z.string().min(1).max(100).default("AIヒアリングからの下書き"),
  targetResumeId: z.string().uuid().nullable().optional(),
});
export type ApplyToResumeRequest = z.infer<typeof applyToResumeSchema>;

export const applyToCvSchema = z.object({
  targetTitle: z.string().min(1).max(100).default("AIヒアリングからの下書き"),
  targetCvId: z.string().uuid().nullable().optional(),
});
export type ApplyToCvRequest = z.infer<typeof applyToCvSchema>;
