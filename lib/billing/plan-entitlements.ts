/**
 * プラン tier ごと の 「機能 開放」 の 単一 source of truth。
 *
 * Solo プラン (¥5,980 / ¥9,800) を 追加 する に あたり、 「席数 上限」 「AI 月次
 * 上限」 「招待 可否」 「CSV / MA / ATS 使用 可否」 等 の tier 別 権限 を 全部
 * ここ で 一元化 する。
 *
 * 目的:
 *   ・UI が 「これ 出す か 出さ ない か」 を 判定 する 単一 API を 提供
 *   ・API が 「これ 実行 可 か」 を 判定 する 単一 API を 提供
 *   ・tier を 増やす とき、 このファイル 1 箇所 の 更新 で 済む
 *
 * 非対象:
 *   ・アドオン (meeting_recording_auto 等) の 契約 判定 は lib/features/entitlements.ts。
 *     プラン tier とは 別 概念。
 *   ・プラン ステータス (past_due / canceled) の read-only 判定 は
 *     lib/billing/plan-status.ts。 このモジュール は 「アクティブ な プラン」
 *     が 前提 で、 tier に よる 差 だけ を 表現 する。
 */
import type { PlanTierValue } from "./tier-limits";
import {
  AI_TOTAL_SOLO_MONTHLY,
  AI_TOTAL_SOLO_PRO_MONTHLY,
  AI_TOTAL_STANDARD_MONTHLY,
  AI_TOTAL_STANDARD_PRO_MONTHLY,
} from "./tier-limits";

/**
 * サポート 応答 SLA (時間 単位)。 メール返信 の 目安。
 * UI 側 で 「◯ 時間 以内 に 返信」 と 表示 する のに 使う。
 */
export type SupportSlaHours = 48 | 24 | 12;

/**
 * プラン tier ごと の 機能 開放。
 *
 * すべて 「真偽 値 or 数値」 で 表現 する (処理 実行 ロジック は 呼出 側)。
 * 判定 の 集約 場所 を 統一 する こと が 目的 で、 実際 の ガード (「ボタン を
 * 隠す」 「API で 402 を 返す」) は 呼出 側 に 任せる。
 */
export type PlanEntitlements = {
  /** 席数 上限 (organization_members の 現役 上限)。 Solo 系 = 1、 Team 系 = 3-10 */
  seatCap: number;
  /**
   * 月次 AI 総量 上限 (全 kind 合算 で org 単位)。 実効 上限 は トライアル 中 は
   * getAiTotalLimitForPlan (tier-limits.ts) が 上位相当 を 返す ため、 ここ の
   * 値 は 「非トライアル 時 の 上限」。
   */
  aiMonthlyLimit: number;
  /** AI 証明写真 の 月次 上限 (seeker_per_user scope。 Solo Pro で 少し 上乗せ) */
  photoEnhanceLimit: number;
  /**
   * 面談 録音 → AI 処理 の 月次 件数 上限。
   * Team 系 (standard_rec / standard_premium) は 50 件、 Solo Pro は お試し
   * 5 件、 それ 以外 は 0 (機能 使用 不可)。
   */
  recordingLimit: number;
  /** メンバー招待 の 使用 可否。 Solo 系 は 1 席 固定 な ので 招待 不可 */
  canInviteMembers: boolean;
  /** 求職者 の CSV 一括 インポート */
  canUseCsvImport: boolean;
  /** 求職者 の CSV 一括 エクスポート */
  canUseCsvExport: boolean;
  /** MA (Flow / Segment) 機能。 Solo 系 に は 過剰 な ので Team 系 のみ */
  canUseMaFlows: boolean;
  /** ATS 外部連携 (HERP 等)。 Phase 1 以降、 現状 は 未実装 だが 権限 は 予約 */
  canUseAtsIntegrations: boolean;
  /** レポート の アドバイザー別 絞込 セレクター (先日 実装、 admin + Team 系 のみ) */
  canUseAdvancedReports: boolean;
  /** レポート の 詳細 (月次 PDF エクスポート 等、 Solo Pro 以上) */
  canUseDetailedReports: boolean;
  /** メール サポート の 応答 SLA (時間 以内 の 返信 目安) */
  supportSlaHours: SupportSlaHours;
};

/**
 * tier ごと の 権限 マップ を 返す 純関数。
 *
 * この関数 だけ が 「tier → 機能 の 対応 表」 の source of truth。
 * 追加 / 削除 は ここ を 触る のみ で、 呼出 側 (UI / API) は 変わら ない。
 */
export function getPlanEntitlements(tier: PlanTierValue): PlanEntitlements {
  switch (tier) {
    // ── Solo プラン (1 席 固定、 個人 事業主 / フリー 想定)
    case "solo":
      return {
        seatCap: 1,
        aiMonthlyLimit: AI_TOTAL_SOLO_MONTHLY, // 100
        photoEnhanceLimit: 5,
        recordingLimit: 0,
        canInviteMembers: false,
        canUseCsvImport: false,
        canUseCsvExport: false,
        canUseMaFlows: false,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: false,
        canUseDetailedReports: false,
        supportSlaHours: 48,
      };

    // ── Solo Pro (1 席 固定、 CSV + 詳細レポート + 少量 録音、 24h サポート)
    case "solo_pro":
      return {
        seatCap: 1,
        aiMonthlyLimit: AI_TOTAL_SOLO_PRO_MONTHLY, // 200
        photoEnhanceLimit: 10,
        recordingLimit: 5,
        canInviteMembers: false,
        canUseCsvImport: true,
        canUseCsvExport: true,
        canUseMaFlows: false,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: false, // アドバイザー別絞込 は 1 席 では 意味 なし
        canUseDetailedReports: true,
        supportSlaHours: 24,
      };

    // ── Team Standard (¥25,000、 2-3 席、 録音 なし)
    case "standard":
      return {
        seatCap: 3,
        aiMonthlyLimit: AI_TOTAL_STANDARD_MONTHLY, // 500
        photoEnhanceLimit: 5,
        recordingLimit: 0,
        canInviteMembers: true,
        canUseCsvImport: true,
        canUseCsvExport: true,
        canUseMaFlows: true,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: true,
        canUseDetailedReports: true,
        supportSlaHours: 24,
      };

    // ── Team Standard + 録音 (¥25,000 + ¥10,000、 録音 50 件)
    case "standard_rec":
      return {
        seatCap: 3,
        aiMonthlyLimit: AI_TOTAL_STANDARD_MONTHLY,
        photoEnhanceLimit: 5,
        recordingLimit: 50,
        canInviteMembers: true,
        canUseCsvImport: true,
        canUseCsvExport: true,
        canUseMaFlows: true,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: true,
        canUseDetailedReports: true,
        supportSlaHours: 24,
      };

    // ── Team Standard + Pro (¥25,000 + ¥4,200、 AI 1000 回、 5 席)
    case "standard_pro":
      return {
        seatCap: 5,
        aiMonthlyLimit: AI_TOTAL_STANDARD_PRO_MONTHLY, // 1000
        photoEnhanceLimit: 5,
        recordingLimit: 0,
        canInviteMembers: true,
        canUseCsvImport: true,
        canUseCsvExport: true,
        canUseMaFlows: true,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: true,
        canUseDetailedReports: true,
        supportSlaHours: 12,
      };

    // ── Team Standard + Premium (Pro + 録音 + 10 席)
    case "standard_premium":
      return {
        seatCap: 10,
        aiMonthlyLimit: AI_TOTAL_STANDARD_PRO_MONTHLY,
        photoEnhanceLimit: 5,
        recordingLimit: 50,
        canInviteMembers: true,
        canUseCsvImport: true,
        canUseCsvExport: true,
        canUseMaFlows: true,
        canUseAtsIntegrations: false,
        canUseAdvancedReports: true,
        canUseDetailedReports: true,
        supportSlaHours: 12,
      };
  }
}
