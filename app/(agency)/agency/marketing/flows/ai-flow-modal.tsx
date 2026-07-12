"use client";

/**
 * AI で Flow を生成するモーダル。
 *
 * 流れ:
 *   1. 担当者が自然文で配信の意図を入力
 *   2. 「AI に提案してもらう」→ 組織の既存タグ・セグメント・テンプレをコンテキストに
 *      Claude が提案を生成
 *   3. プレビュー(名前 / 起動条件 / 目標 / 概要 / ステップ一覧)を表示
 *   4. 「この内容で作成」→ 送信ステップのテンプレを自動作成 → Flow + ステップを保存
 */
import { Sparkles } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mapProposalStepsToSaveable, type AIFlowProposal } from "@/lib/ai/prompts/flow-generation";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const EXAMPLE_PROMPTS = [
  "友だち追加後、まず歓迎メッセージ。3日以内に面談予約がなければリマインドを送り、それでも予約がなければ7日後にキャリア相談無料キャンペーンを案内する",
  "面談が完了してから3日経っても応募がなければ求人紹介を送信。応募済みなら何もせず終了",
  "沈黙が30日続く求職者に、段階的にメッセージを送信して復帰を促す。2通目まで返信がなければ卒業メッセージで終了",
];

const TRIGGER_LABELS: Record<string, string> = {
  friend_added: "友だち追加時",
  tag_assigned: "タグが付いたとき",
  segment_matched: "セグメントに一致したとき",
  postback_received: "ボタンタップ時",
  conversion_event: "目標達成イベント発生時",
  manual: "手動で登録",
};

const INTENT_LABELS: Record<string, string> = {
  send_message: "メッセージを送る",
  assign_tag: "タグをつける",
  remove_tag: "タグを外す",
  wait: "待つ",
  branch: "条件で分岐",
  stop: "終了する",
};

function formatDelay(seconds: number): string {
  if (seconds === 0) return "すぐ";
  if (seconds < 60) return `${seconds}秒後`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分後`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間後`;
  return `${Math.floor(seconds / 86400)}日後`;
}

type Channel = "line" | "email";

export function AiFlowModal({ open, onOpenChange, onCreated }: Props) {
  const [channel, setChannel] = useState<Channel>("line");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<AIFlowProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/agency/ma/flows/ai-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), channel }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(body.message ?? body.error ?? "AI からの提案取得に失敗しました");
        return;
      }
      const json = (await res.json()) as { proposal: AIFlowProposal };
      setProposal(json.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!proposal) return;
    setSaving(true);
    setError(null);
    try {
      // 1. Flow を作成(channel を明示)
      const flowRes = await fetch("/api/agency/ma/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset_key: null,
          channel,
          name: proposal.name,
          description: proposal.description,
        }),
      });
      if (!flowRes.ok) {
        const body = (await flowRes.json().catch(() => ({}))) as { error?: string };
        setError(`Flow の作成に失敗しました: ${body.error ?? flowRes.status}`);
        return;
      }
      const { id: flowId } = (await flowRes.json()) as { id: string };

      // 2. 起動条件・目標などのメタ情報を更新
      const triggerConfig: Record<string, unknown> = {
        ai_trigger_hint: proposal.trigger_hint,
      };
      if (proposal.trigger_tag_id) triggerConfig.tag_id = proposal.trigger_tag_id;
      if (proposal.trigger_segment_id) triggerConfig.segment_id = proposal.trigger_segment_id;

      await fetch("/api/agency/ma/flows", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: flowId,
          goal_event_key: proposal.goal_event_key,
          allow_reentry: proposal.allow_reentry,
          trigger_config: triggerConfig,
          target_segment_id: proposal.trigger_segment_id ?? null,
        }),
      });

      // 3. 送信ステップぶんのテンプレを自動作成(email なら subject も同送)
      const templateIdByStep: Record<number, string> = {};
      for (const step of proposal.steps) {
        if (step.action_type === "send_message" && step.message_body) {
          const templRes = await fetch("/api/agency/ma/templates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: `${proposal.name} - ステップ${step.step_order}`,
              body: step.message_body,
              ...(channel === "email"
                ? { subject: step.message_subject ?? `${proposal.name} - お知らせ` }
                : {}),
            }),
          });
          if (templRes.ok) {
            const { id: templateId } = (await templRes.json()) as { id: string };
            templateIdByStep[step.step_order] = templateId;
          }
        }
      }

      // 4. ステップを一括保存
      const saveable = mapProposalStepsToSaveable(proposal, templateIdByStep);
      const stepsRes = await fetch(`/api/agency/ma/flows/${flowId}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: saveable }),
      });
      if (!stepsRes.ok) {
        const body = (await stepsRes.json().catch(() => ({}))) as { error?: string };
        setError(`ステップの保存に失敗しました: ${body.error ?? stepsRes.status}`);
        return;
      }

      setPrompt("");
      setProposal(null);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // 提案の中の要検討ステップを数える(admin にわかりやすくするため)
  const stepsNeedingAttention = proposal
    ? proposal.steps.filter(
        (s) =>
          (s.action_type === "assign_tag" || s.action_type === "remove_tag") &&
          !isUuid(s.tag_id ?? ""),
      ).length
    : 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI に Flow を提案してもらう
        </AlertDialogTitle>
        <AlertDialogDescription>
          配信したい内容を自然な言葉で書いてください。組織で使っているタグやセグメントを踏まえて、そのまま動く
          Flow を提案します。
        </AlertDialogDescription>

        {!proposal && (
          <div className="my-3 space-y-2">
            <div className="space-y-1">
              <Label>送信チャネル</Label>
              <div className="inline-flex overflow-hidden rounded border">
                <button
                  type="button"
                  onClick={() => setChannel("line")}
                  disabled={generating}
                  className={`px-3 py-1 text-xs ${
                    channel === "line"
                      ? "bg-emerald-500 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  公式 LINE
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  disabled={generating}
                  className={`px-3 py-1 text-xs ${
                    channel === "email"
                      ? "bg-emerald-500 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  メール
                </button>
              </div>
              {channel === "email" && (
                <p className="text-muted-foreground text-xs">
                  メール Flow は件名 + 長めの本文で提案されます。 LINE 連携済み +
                  メール登録済みの求職者だけに届きます。
                </p>
              )}
            </div>

            <Label htmlFor="ai-prompt">配信の意図</Label>
            <Textarea
              id="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={EXAMPLE_PROMPTS[0]}
              rows={5}
              maxLength={2000}
              disabled={generating}
            />
            <div className="text-muted-foreground text-xs">
              例(クリックで挿入):
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {EXAMPLE_PROMPTS.map((e, i) => (
                  <li
                    key={i}
                    className="cursor-pointer hover:underline"
                    onClick={() => setPrompt(e)}
                  >
                    {e.slice(0, 60)}...
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {proposal && (
          <div className="my-3 max-h-[60vh] space-y-3 overflow-y-auto">
            <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm">
              <div className="font-semibold text-sky-900">{proposal.name}</div>
              <div className="mt-1 text-xs text-sky-800">{proposal.description}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-sky-900">
                <div>
                  <span className="opacity-70">起動タイミング:</span>{" "}
                  {TRIGGER_LABELS[proposal.trigger_type] ?? proposal.trigger_type}
                </div>
                <div>
                  <span className="opacity-70">達成目標:</span> {proposal.goal_event_key ?? "なし"}
                </div>
                <div>
                  <span className="opacity-70">対象を再度追加:</span>{" "}
                  {proposal.allow_reentry ? "する" : "しない"}
                </div>
                <div>
                  <span className="opacity-70">ステップ数:</span> {proposal.steps.length}
                </div>
              </div>
              <p className="mt-2 text-xs text-sky-900 opacity-80">{proposal.trigger_hint}</p>
            </div>

            <div className="border-border rounded border p-3 text-sm">
              <div className="mb-2 font-medium">この Flow の動き</div>
              <p className="text-muted-foreground text-xs">{proposal.narrative}</p>
            </div>

            <div className="border-border rounded border">
              <div className="border-border border-b p-2 text-xs font-medium">ステップ一覧</div>
              <div className="divide-border divide-y">
                {proposal.steps.map((s) => (
                  <div key={s.step_order} className="space-y-1 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="bg-muted rounded px-1.5 py-0.5 font-mono">
                        {s.step_order}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDelay(s.delay_from_previous_seconds)}
                      </span>
                      <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5">
                        {INTENT_LABELS[s.action_type] ?? s.action_type}
                      </span>
                      <span className="font-medium">{s.name}</span>
                    </div>
                    {s.message_body && (
                      <p className="text-muted-foreground pl-8">送る本文: {s.message_body}</p>
                    )}
                    {s.tag_name && !isUuid(s.tag_id ?? "") && (
                      <p className="pl-8 text-amber-700">
                        新規タグを想定: 「{s.tag_name}」(保存後にタグを選び直してください)
                      </p>
                    )}
                    {s.tag_name && isUuid(s.tag_id ?? "") && (
                      <p className="text-muted-foreground pl-8">既存タグ: {s.tag_name}</p>
                    )}
                    {s.branch_condition_json_stringified && (
                      <p className="text-muted-foreground pl-8">
                        分岐条件: {summarizeBranchCondition(s.branch_condition_json_stringified)}
                        {s.next_step_on_true != null && ` / Yes → ステップ${s.next_step_on_true}`}
                        {s.next_step_on_false != null && ` / No → ステップ${s.next_step_on_false}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {stepsNeedingAttention === 0 ? (
              <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
                この Flow
                はすべて自動で埋まりました。「この内容で作成」を押せば、そのまま動く状態で保存されます。
              </div>
            ) : (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                保存後に {stepsNeedingAttention}{" "}
                件のステップで新規タグの割り当てが必要です。ステップ編集画面でタグを選ぶか、新しいタグを作成してください。
              </div>
            )}

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={generating || saving}
            onClick={() => onOpenChange(false)}
          >
            閉じる
          </Button>
          {!proposal ? (
            <Button disabled={generating || prompt.trim().length < 5} onClick={generate}>
              {generating ? "AI に提案してもらっています..." : "AI に提案してもらう"}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={() => setProposal(null)}>
                やり直す
              </Button>
              <Button disabled={saving} onClick={save}>
                {saving ? "作成中..." : "この内容で作成"}
              </Button>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function summarizeBranchCondition(stringified: string): string {
  try {
    const obj = JSON.parse(stringified) as { kind?: string };
    if (!obj?.kind) return "設定済み";
    if (obj.kind === "and") return "複数条件をすべて満たす";
    if (obj.kind === "or") return "いずれかの条件を満たす";
    if (obj.kind === "not") return "条件を満たさない";
    if (obj.kind === "has_tag") return "特定のタグを持っている";
    if (obj.kind === "not_has_tag") return "特定のタグを持っていない";
    if (obj.kind === "field_equals") return "自由項目が特定の値";
    if (obj.kind === "field_exists") return "自由項目が存在する";
    if (obj.kind === "days_since_last_activity_gte") return "最終活動から N 日以上";
    if (obj.kind === "days_since_added_gte") return "追加から N 日以上";
    if (obj.kind === "days_since_added_lte") return "追加から N 日以内";
    if (obj.kind === "clicked_link_in_flow") return "Flow のリンクをクリック済み";
    return obj.kind;
  } catch {
    return "設定済み";
  }
}
