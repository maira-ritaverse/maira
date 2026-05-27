import type { Application } from "@/lib/applications/types";
import type { CareerProfile } from "@/lib/career/profile-schema";
import type { Task } from "@/lib/tasks/types";

/**
 * 応募アドバイザー(application_tracker モジュール)用のシステムプロンプト
 *
 * 設計思想:
 * - キャリア棚卸しの「雑談で引き出す」とは違い、特定の応募について実用的なアドバイスを返す
 * - career_profile と応募情報の両方を文脈として持つ
 * - 「次に何をすべきか」を能動的に返す
 * - 押し付けがましさは抑えつつ、具体性は優先する
 *
 * DB の module カラムには既存 enum 値の "application_tracker" を入れる
 * (役割名称としては「アドバイザー」だが、enum 設計時点の命名に合わせる)。
 */
export const APPLICATION_ADVISOR_SYSTEM_PROMPT = `あなたはMaira(マイラ)、20-30代の日本人転職者を伴走するAI採用エージェントです。

【今回の役割】
ユーザーが特定の応募について相談しに来ています。
あなたは、その応募の進捗・タスク・ユーザーのキャリア情報を踏まえて、実用的なアドバイスを返します。

【あなたのトーン】
- 優秀な転職エージェントの先輩のような存在
- フレンドリーだが、実用的・具体的なアドバイスを優先する
- ユーザーが「次に何をすべきか」を明確にする
- キャリア棚卸しと違って雑談ではない、具体的な行動指針を返す

【できること】
- 応募のステータスに応じた次のアクション提案
  例:書類選考中 → 「他の応募と並行して進めましょう」
  例:面接前 → 「想定質問と回答準備をしましょう」
  例:内定 → 「条件確認のチェックポイントは...」
- 面接対策(想定質問、回答案、対策方法)
- 書類のブラッシュアップ提案
- 期限管理(タスクの整理、優先度付け)
- 不安・迷いへの相談相手

【質問の仕方】
- ユーザーの相談に応じて、必要なら追加の質問をする
- 一度に複数の質問は避ける
- 抽象的な質問より具体的な質問

【1メッセージの長さ】
- 状況に応じて適切な長さ
- 単純な確認なら短く(1-2文)
- 戦略的アドバイスなら詳しく(箇条書きを活用)
- 絵文字は使わない(プロフェッショナルさを保つ)

【避けること】
- 一般論のキャリアアドバイス
- 「素晴らしい」「すごい」の連発
- 結論を急ぐ
- 応募情報・キャリア情報にない事実を捏造する`;

/**
 * 応募ステータスの日本語表示(プロンプト文脈用)
 *
 * lib/applications/types.ts の applicationStatusLabels と同じ意味だが、
 * ここでは循環参照を避けるためにローカル定義する(types.ts は AI 層を import しない設計)。
 * ステータス値を増やした際はここも更新が必要。
 */
const STATUS_LABELS_FOR_PROMPT: Record<Application["status"], string> = {
  considering: "検討中",
  applied: "応募済",
  document_review: "書類選考中",
  interview: "面接中",
  offer: "内定",
  rejected: "不採用",
  declined: "辞退",
  withdrawn: "取り下げ",
};

/**
 * アドバイザー用のコンテキストを構築
 *
 * システムプロンプトに連結して渡す。ここで渡した値が、Maira が応募について
 * 何を知っているかの全てになる(モデルがコンテキスト外の事実を作らないよう、
 * 「ない事実は捏造しない」をシステムプロンプトでも釘を刺している)。
 */
export function buildAdvisorContext(params: {
  application: Application;
  tasks: Task[];
  profile: CareerProfile;
}): string {
  const { application, tasks, profile } = params;

  const parts: string[] = [
    "【相談対象の応募】",
    `会社:${application.details.company}`,
    `職種:${application.details.position}`,
    `ステータス:${STATUS_LABELS_FOR_PROMPT[application.status]}`,
  ];

  if (application.details.salary_range) {
    parts.push(`想定年収:${application.details.salary_range}`);
  }
  if (application.details.location) {
    parts.push(`勤務地:${application.details.location}`);
  }
  if (application.applied_at) {
    parts.push(`応募日:${new Date(application.applied_at).toLocaleDateString("ja-JP")}`);
  }
  if (application.next_action_at) {
    parts.push(
      `次のアクション期限:${new Date(application.next_action_at).toLocaleString("ja-JP")}`,
    );
  }
  if (application.details.notes) {
    parts.push(`メモ:${application.details.notes}`);
  }

  if (tasks.length > 0) {
    parts.push("", "【現在のタスク】");
    for (const task of tasks) {
      const statusMark = task.status === "done" ? "✓" : "○";
      const dueText = task.due_at ? `(期限: ${new Date(task.due_at).toLocaleString("ja-JP")})` : "";
      parts.push(`${statusMark} ${task.title} ${dueText}`.trim());
    }
  }

  parts.push("", "【ユーザーのキャリア情報】");
  parts.push(`サマリー:${profile.summary}`);

  if (profile.strengths.length > 0) {
    parts.push("強み:");
    for (const s of profile.strengths) {
      parts.push(`- ${s.label}:${s.evidence}`);
    }
  }
  if (profile.values.length > 0) {
    parts.push(`価値観:${profile.values.join(" / ")}`);
  }
  if (profile.user_facts.current_role) {
    parts.push(`現職:${profile.user_facts.current_role}`);
  }

  return parts.join("\n");
}
