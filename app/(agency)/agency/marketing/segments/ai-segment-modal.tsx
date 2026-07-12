"use client";

/**
 * AI で Segment を生成するモーダル。
 *
 * 自然文の絞り込み意図を渡して、Claude が SegmentCondition ツリーを返す。
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
  "追加から30日以上経っているのに、最終活動も30日以上前の沈黙している求職者",
  "希望勤務地が東京で、職務要約が記入済みの友だち",
  "特定のタグ「面談予約済み」が付いているが、応募がまだの人",
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
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(body.message ?? body.error ?? "AI からの提案取得に失敗しました");
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
        setError(`セグメントの作成に失敗しました: ${body.error ?? res.status}`);
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
          AI にセグメントを提案してもらう
        </AlertDialogTitle>
        <AlertDialogDescription>
          絞り込みたい求職者の条件を自然な言葉で書いてください。AI が条件ツリーを提案します。
        </AlertDialogDescription>

        {!proposal && (
          <div className="my-3 space-y-2">
            <Label htmlFor="ai-seg-prompt">絞り込みの意図</Label>
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
              例(クリックで挿入):
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
            {error && <p className="text-destructive text-sm">{error}</p>}
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
                このセグメントには、まだサポートしていない条件(スコア・登録元・目標達成イベント)が含まれています。該当部分は絞り込みには反映されません。骨格として保存すること自体は可能です。
              </div>
            )}

            <div className="border-border rounded border">
              <div className="border-border border-b p-2 text-xs font-medium">生成された条件</div>
              <pre className="max-h-48 overflow-auto p-2 font-mono text-[10px]">
                {JSON.stringify(proposal.filter, null, 2)}
              </pre>
            </div>

            <p className="text-muted-foreground text-xs">
              保存後、セグメント編集画面で「タグ」や「Flow」の項目を実際のデータに差し替えてください。空欄になっているところは手動選択が必要です。
            </p>

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
