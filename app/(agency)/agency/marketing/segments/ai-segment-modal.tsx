"use client";

/**
 * AI で Segment を 生成 する モーダル。
 *
 * 流れ:
 *   1. admin が 自然文 で 絞り 込み 意図 を 入力
 *   2. 「AI で 生成」 → /api/agency/ma/segments/ai-generate を 呼ぶ
 *   3. プレビュー (name / description / narrative / 生成 filter を JSON で 表示)
 *   4. 「この 内容 で 作成」 → POST /api/agency/ma/segments で 作成
 *   5. admin は Segment 編集 画面 で 微調整 (tag_id を 実際 の タグ に 差替え 等)
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
import type { SegmentFilter } from "@/lib/ma/segment-dsl";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type Proposal = {
  name: string;
  description: string;
  filter: SegmentFilter;
  narrative: string;
  uses_reserved_kinds: boolean;
};

const EXAMPLE_PROMPTS = [
  "追加 から 30 日 以上 経って いる のに 最終 活動 も 30 日 以上 前 の 沈黙 求職者",
  "希望勤務地 が 東京 で、 職務要約 が 記入 済 の 友だち",
  "特定 タグ 「面談 予約 済」 が 付いて いる が 応募 が まだ の 人",
];

export function AiSegmentModal({ open, onOpenChange, onCreated }: Props) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    setProposal(null);
    try {
      const res = await fetch("/api/agency/ma/segments/ai-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "生成 に 失敗 しました");
        return;
      }
      const json = (await res.json()) as { proposal: Proposal };
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
      const res = await fetch("/api/agency/ma/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: proposal.name,
          description: proposal.description,
          filter_dsl_json: proposal.filter,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`Segment 作成 失敗: ${body.error ?? res.status}`);
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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI で Segment を 生成
        </AlertDialogTitle>
        <AlertDialogDescription>
          絞り 込みたい 求職者 の 条件 を 自然文 で 書いて ください。 AI が SegmentCondition の
          ツリー を 提案 します。
        </AlertDialogDescription>

        {!proposal && (
          <div className="my-3 space-y-2">
            <Label htmlFor="ai-seg-prompt">絞り 込み の 意図</Label>
            <Textarea
              id="ai-seg-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={EXAMPLE_PROMPTS[0]}
              rows={4}
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
                    {e}
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
              <p className="mt-2 text-xs text-sky-900">{proposal.narrative}</p>
            </div>

            {proposal.uses_reserved_kinds && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                この Segment は Phase 2/3 予約 kind (score / entry_source / conversion_event) を
                含みます。 該当 部分 は 実際 の 絞り 込み で は 「常 に false」 と 評価 されます。
                定義 の 骨格 として 保存 は 可能 です。
              </div>
            )}

            <div className="border-border rounded border">
              <div className="border-border border-b p-2 text-xs font-medium">
                生成 された Filter (JSON)
              </div>
              <pre className="max-h-48 overflow-auto p-2 font-mono text-[10px]">
                {JSON.stringify(proposal.filter, null, 2)}
              </pre>
            </div>

            <p className="text-muted-foreground text-xs">
              保存 後、 Segment 編集 画面 で tag_id / flow_id を 実 データ に 置き換えて ください。
              空 文字列 の 部分 は 手動 選択 が 必要 です。
            </p>

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
