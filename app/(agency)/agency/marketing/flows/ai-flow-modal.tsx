"use client";

/**
 * AI で Flow を 生成 する モーダル。
 *
 * 流れ:
 *   1. admin が 自然文 で 配信 意図 を 入力
 *   2. 「AI で 生成」 → /api/agency/ma/flows/ai-generate を 呼び 提案 取得
 *   3. プレビュー (name / description / trigger / narrative / steps) を 表示
 *   4. 「この 内容 で 作成」 → POST /api/agency/ma/flows で Flow 作成 →
 *      PUT /steps で ステップ 一括 挿入 → onCreated 呼び 出し
 *   5. admin は Flow エディタ で 微調整 (template_id / tag_id / 分岐 条件 を 埋める)
 *
 * 制限:
 *   ・send_message / assign_tag / remove_tag は 一時的 に action_type='wait' に
 *     変換 して 保存 (DB の CHECK 制約 回避)。 元 の 意図 は action_config に 保管
 *   ・admin は Step 詳細 で action_type を 正式 な もの に 戻し、
 *     template_id / tag_id を 選択 する 必要 が ある
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
  "友だち追加後、まずウェルカムメッセージ。 3 日 以内 に 面談 予約 が なければ リマインド、 それ でも 予約 が なければ 7 日 後 に キャリア 相談 無料 キャンペーン を 案内 する",
  "面談 完了 後、 3 日 経っても 応募 が なければ 求人 紹介 を 送信。 応募 済 なら 何 も せず 終了",
  "沈黙 が 30 日 続く 求職者 に、 段階 的 に メッセージ を 送信 して 復帰 を 促す。 2 通目 まで 返信 なければ 卒業 メッセージ で 終了",
];

const TRIGGER_LABELS: Record<string, string> = {
  friend_added: "友だち追加",
  tag_assigned: "タグ 付与",
  segment_matched: "セグメント 一致",
  postback_received: "ボタン タップ",
  conversion_event: "CV 発生",
  manual: "手動",
};

const INTENT_LABELS: Record<string, string> = {
  send_message: "メッセージ 送信",
  assign_tag: "タグ 付与",
  remove_tag: "タグ 削除",
  wait: "待機",
  branch: "分岐",
  stop: "終了",
};

function formatDelay(seconds: number): string {
  if (seconds === 0) return "即時";
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間`;
  return `${Math.floor(seconds / 86400)}日`;
}

export function AiFlowModal({ open, onOpenChange, onCreated }: Props) {
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
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "生成 に 失敗 しました");
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
      // 1. Flow を 作成 (POST /api/agency/ma/flows)
      const flowRes = await fetch("/api/agency/ma/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset_key: null,
          name: proposal.name,
          description: proposal.description,
        }),
      });
      if (!flowRes.ok) {
        const body = (await flowRes.json().catch(() => ({}))) as { error?: string };
        setError(`Flow 作成 失敗: ${body.error ?? flowRes.status}`);
        return;
      }
      const { id: flowId } = (await flowRes.json()) as { id: string };

      // 2. Flow メタ を PATCH (trigger_type / goal / allow_reentry / trigger_config)
      await fetch("/api/agency/ma/flows", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: flowId,
          goal_event_key: proposal.goal_event_key,
          allow_reentry: proposal.allow_reentry,
          trigger_config: { ai_trigger_hint: proposal.trigger_hint },
        }),
      });

      // 3. Steps を PUT (proposal から マッピング)
      const saveable = mapProposalStepsToSaveable(proposal);
      const stepsRes = await fetch(`/api/agency/ma/flows/${flowId}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: saveable }),
      });
      if (!stepsRes.ok) {
        const body = (await stepsRes.json().catch(() => ({}))) as { error?: string };
        setError(`ステップ 保存 失敗: ${body.error ?? stepsRes.status}`);
        return;
      }

      // 完了:モーダル を 閉じて 一覧 を 再フェッチ
      setPrompt("");
      setProposal(null);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI で Flow を 生成
        </AlertDialogTitle>
        <AlertDialogDescription>
          配信 したい 内容 を 自然文 で 書いて ください。 AI が 起動 トリガー、 目標、 ステップ
          構成、 想定 メッセージ 本文 を 提案 します。
        </AlertDialogDescription>

        {!proposal && (
          <div className="my-3 space-y-2">
            <Label htmlFor="ai-prompt">配信 の 意図</Label>
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
              例:
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
            {error && <p className="text-destructive text-sm">エラー: {error}</p>}
          </div>
        )}

        {proposal && (
          <div className="my-3 max-h-[60vh] space-y-3 overflow-y-auto">
            <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm">
              <div className="font-semibold text-sky-900">{proposal.name}</div>
              <div className="mt-1 text-xs text-sky-800">{proposal.description}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-sky-900">
                <div>
                  <span className="opacity-70">トリガー:</span>{" "}
                  {TRIGGER_LABELS[proposal.trigger_type] ?? proposal.trigger_type}
                </div>
                <div>
                  <span className="opacity-70">目標 CV:</span> {proposal.goal_event_key ?? "なし"}
                </div>
                <div>
                  <span className="opacity-70">再エンロール:</span>{" "}
                  {proposal.allow_reentry ? "許可" : "1 度 のみ"}
                </div>
                <div>
                  <span className="opacity-70">ステップ 数:</span> {proposal.steps.length}
                </div>
              </div>
              <p className="mt-2 text-xs text-sky-900 opacity-80">{proposal.trigger_hint}</p>
            </div>

            <div className="border-border rounded border p-3 text-sm">
              <div className="mb-2 font-medium">動作 の 要約</div>
              <p className="text-muted-foreground text-xs">{proposal.narrative}</p>
            </div>

            <div className="border-border rounded border">
              <div className="border-border border-b p-2 text-xs font-medium">ステップ 一覧</div>
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
                      <p className="text-muted-foreground pl-8">送信 本文: {s.message_body}</p>
                    )}
                    {s.tag_name && (
                      <p className="text-muted-foreground pl-8">タグ 名: {s.tag_name}</p>
                    )}
                    {s.branch_description && (
                      <p className="text-muted-foreground pl-8">
                        分岐 条件: {s.branch_description}
                        {s.next_step_on_true != null && ` (true → Step ${s.next_step_on_true}`}
                        {s.next_step_on_false != null && `, false → Step ${s.next_step_on_false})`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              保存 後 の 追加 作業:各 「送信」 「タグ」 ステップ は 一時的 に 「待機」 として 保存
              されます。 Flow エディタ で 開き、 action_type を 正式 な もの に 戻し、 template /
              tag を 選択 して ください。
            </div>

            {error && <p className="text-destructive text-sm">エラー: {error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={generating || saving}
            onClick={() => onOpenChange(false)}
          >
            キャンセル
          </Button>
          {!proposal ? (
            <Button disabled={generating || prompt.trim().length < 5} onClick={generate}>
              {generating ? "生成 中..." : "AI で 生成"}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={() => setProposal(null)}>
                やり直し
              </Button>
              <Button disabled={saving} onClick={save}>
                {saving ? "作成 中..." : "この 内容 で 作成"}
              </Button>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
