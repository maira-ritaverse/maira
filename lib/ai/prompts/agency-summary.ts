/**
 * エージェント向け「クライアント状況サマリー」用プロンプト
 *
 * クライアント詳細画面で、エージェントが既に画面で見られるデータのみを文脈に
 * 与え、状況把握と次アクション提示を 2 部構成の Markdown で返す。
 *
 * 開示境界(最重要):
 *   この関数の引数は「エージェントが既に詳細画面で見られるデータ」のみで
 *   構成されている。特に求職者本人のプロフィールは DisclosableProfile 型に
 *   限定し、内面(strengths/values/concerns/summary/diagnosis)は型レベルで
 *   含まれない。本ファイルの引数に CareerProfile を取らないこと(将来差し戻し
 *   防止のため、import もしない)。
 */
import { getAgencyTaskPriorityConfig } from "@/lib/agency-tasks/types";
import type { AgencyTaskWithAssignee } from "@/lib/agency-tasks/types";
import type { ClientRecord } from "@/lib/clients/types";
import { clientLinkStatusLabels, clientStatusLabels } from "@/lib/clients/types";
import type { DisclosableProfile } from "@/lib/connections/disclosable-profile";
import { getInteractionTypeConfig } from "@/lib/interactions/types";
import type { ClientInteractionWithAuthor } from "@/lib/interactions/types";
import { getPlacementEventTypeConfig } from "@/lib/placements/types";
import type { PlacementWithAuthor } from "@/lib/placements/types";
import { formatReferralStatusTransition, getReferralStatusConfig } from "@/lib/referrals/types";
import type { ReferralStatusHistoryWithAuthor, ReferralWithJob } from "@/lib/referrals/types";

export const AGENCY_CLIENT_SUMMARY_SYSTEM_PROMPT = `あなたは転職エージェントの業務を支援するアシスタントです。

# 役割
担当アドバイザーが、特定のクライアント(求職者)の現在の状況を素早く把握し、
次に何をすべきかを判断できるよう、対応履歴・紹介状況・タスク・希望条件を
踏まえた簡潔なサマリーを返します。

# 最重要ルール

1. **事実ベース**:
   提供されたデータに含まれていない情報は推測しない。
   特に候補者の内面評価・性格診断・適性判断は行わない
   (それらの情報は提供されていません)。

2. **提供データの引用は具体的に**:
   日付・ステータス・件数・会社名などは具体的に引用する。
   「最近対応しました」ではなく「2026年6月3日に面接を実施」のように。

3. **次のアクションは実行可能な単位で**:
   「フォローアップする」ではなく
   「○○社の選考結果(締切: 6/15)について、来週前半に企業へ確認連絡」のように
   いつ・誰に・何をするかが分かる粒度で書く。

# 出力フォーマット(厳守)

以下の 2 セクションを Markdown 見出しで出力する。

## 状況
2〜3 文の文章で、このクライアントの現在地を要約する。
含めるべき要素:現在のステータス、進行中の紹介の主要な動き、最近の対応の傾向。

## 次のアクション
2〜4 項目の箇条書き(- 記号)で、優先度が高い順に並べる。
各項目は 1 文で、いつ・何を・なぜ を含める。

# 避けること
- 一般論(「丁寧に対応しましょう」など、コンテキストを使わない文)
- 提供データの単なるリスト化(整理されていない再掲)
- 「素晴らしい」「順調」などの主観評価
- 候補者の人物像・性格・適性についての推測
- 絵文字
`;

type SummaryContext = {
  client: ClientRecord;
  referrals: ReferralWithJob[];
  historiesByReferral: Map<string, ReferralStatusHistoryWithAuthor[]>;
  interactions: ClientInteractionWithAuthor[];
  placements: PlacementWithAuthor[];
  tasks: AgencyTaskWithAssignee[];
  disclosableProfile: DisclosableProfile | null;
};

/**
 * モデルに渡す user prompt 文字列を組み立てる。
 *
 * 引数の型はすべて、エージェントが画面で見られるデータのみ。
 * disclosableProfile は DisclosableProfile 型(wants + user_facts のみ)で、
 * 内面は型レベルで含まれない。
 */
export function buildAgencyClientSummaryPrompt(ctx: SummaryContext): string {
  const lines: string[] = [];

  lines.push("【クライアント基本情報】");
  lines.push(`名前: ${ctx.client.name}`);
  lines.push(`現在のステータス: ${clientStatusLabels[ctx.client.status]}`);
  lines.push(`連携状態: ${clientLinkStatusLabels[ctx.client.linkStatus]}`);
  if (ctx.client.notes) {
    // エージェント内部メモ。本人非開示の運用なので AI にも「内部メモ」と明示。
    lines.push(`エージェント内部メモ: ${ctx.client.notes}`);
  }

  // 求職者本人の開示プロフィールは linked / 期限内 revoke_requested のときのみ。
  // 型レベルで wants + user_facts のみ、内面は含まれない。
  if (ctx.disclosableProfile) {
    const p = ctx.disclosableProfile;
    lines.push("");
    lines.push("【本人の希望条件と現職情報(開示分のみ)】");
    if (p.user_facts.current_role) lines.push(`現職: ${p.user_facts.current_role}`);
    if (p.user_facts.industry) lines.push(`現在の業界: ${p.user_facts.industry}`);
    if (p.user_facts.years_of_experience !== null) {
      lines.push(`実務経験年数: ${p.user_facts.years_of_experience} 年`);
    }
    if (p.wants.industries.length > 0) {
      lines.push(`希望業界: ${p.wants.industries.join(" / ")}`);
    }
    if (p.wants.role_types.length > 0) {
      lines.push(`希望職種: ${p.wants.role_types.join(" / ")}`);
    }
    if (p.wants.company_sizes.length > 0) {
      lines.push(`希望会社規模: ${p.wants.company_sizes.join(" / ")}`);
    }
  }

  // 紹介一覧と、各紹介の状態遷移履歴(時系列)
  if (ctx.referrals.length > 0) {
    lines.push("");
    lines.push("【紹介状況(新しい順)】");
    for (const r of ctx.referrals) {
      const statusLabel = getReferralStatusConfig(r.status).label;
      const createdAt = formatJaDate(r.createdAt);
      lines.push(
        `- ${r.jobCompanyName} / ${r.jobPosition}(状態: ${statusLabel}, 推薦日: ${createdAt})`,
      );
      if (r.notes) lines.push(`  紹介メモ: ${r.notes}`);
      const histories = ctx.historiesByReferral.get(r.id) ?? [];
      if (histories.length > 0) {
        lines.push("  選考の足跡:");
        for (const h of histories) {
          const transition = formatReferralStatusTransition(h.fromStatus, h.toStatus);
          const at = formatJaDateTime(h.changedAt);
          const by = h.changedByName ? `(${h.changedByName})` : "";
          const memo = h.memo ? ` — ${h.memo}` : "";
          lines.push(`    - ${at} ${transition} ${by}${memo}`.trimEnd());
        }
      }
    }
  }

  // 対応履歴(新しい順)。summary/body の両方を渡すが、長文化を避けるため
  // body は先頭 400 文字でトリムする。
  if (ctx.interactions.length > 0) {
    lines.push("");
    lines.push("【対応履歴(新しい順)】");
    for (const it of ctx.interactions) {
      const typeLabel = getInteractionTypeConfig(it.interactionType).label;
      const at = formatJaDateTime(it.occurredAt);
      const by = it.authorName ? `(${it.authorName})` : "";
      const headParts = [at, typeLabel, by].filter((s) => s.length > 0);
      lines.push(`- ${headParts.join(" / ")}`);
      if (it.summary) lines.push(`  概要: ${it.summary}`);
      if (it.body) lines.push(`  詳細: ${truncate(it.body, 400)}`);
    }
  }

  // 成約イベント
  if (ctx.placements.length > 0) {
    lines.push("");
    lines.push("【成約・入金イベント】");
    for (const p of ctx.placements) {
      const typeLabel = getPlacementEventTypeConfig(p.eventType).label;
      const at = formatJaDate(p.eventDate);
      const amountStr = p.amount !== null ? `${p.amount.toLocaleString("ja-JP")}円` : "金額未入力";
      const by = p.authorName ? `(${p.authorName})` : "";
      lines.push(`- ${at} ${typeLabel} / ${amountStr} ${by}`.trimEnd());
      if (p.notes) lines.push(`  メモ: ${p.notes}`);
      if (p.reason) lines.push(`  理由: ${p.reason}`);
    }
  }

  // タスク(未完了優先)
  if (ctx.tasks.length > 0) {
    lines.push("");
    lines.push("【関連タスク】");
    for (const t of ctx.tasks) {
      const statusMark = t.status === "completed" ? "✓" : "○";
      const priorityLabel = t.priority ? getAgencyTaskPriorityConfig(t.priority).label : null;
      const dueText = t.dueAt ? `期限: ${formatJaDateTime(t.dueAt)}` : "期限なし";
      const assignee = t.assigneeName ? `担当: ${t.assigneeName}` : "担当未割当";
      const priParts = priorityLabel ? `優先度: ${priorityLabel}` : "";
      const meta = [dueText, assignee, priParts].filter((s) => s.length > 0).join(" / ");
      lines.push(`- ${statusMark} ${t.title}(${meta})`);
    }
  }

  lines.push("");
  lines.push(
    "上記データのみを根拠に、フォーマットに従って【状況】と【次のアクション】を作成してください。",
  );

  return lines.join("\n");
}

function formatJaDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatJaDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
