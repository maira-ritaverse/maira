"use client";

import { Check, Copy, Lightbulb, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { InterviewPrepContent } from "@/lib/interview-preps/types";

type Props = {
  referralId: string;
  clientName: string;
  /** コピー(LINE 共有等)のタイトル用。 */
  companyName: string;
  position: string;
  /** 求職者本人のキャリア棚卸しが実施済みか。未実施なら棚卸し依頼を促す案内を出す。 */
  careerProfileDone: boolean;
  /** 求職者アカウントが連携済みか。未連携なら共有しても本人は閲覧・通知を受け取れない。 */
  seekerLinked: boolean;
  initialContent: InterviewPrepContent | null;
  initialGeneratedAt: string | null;
  /** 求職者へ共有済みの日時。null なら未共有(再生成でも null に戻る)。 */
  initialSharedAt: string | null;
};

/** 生成日時を Asia/Tokyo で "YYYY/MM/DD HH:mm" 表示。 */
function formatJst(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * セクション配列をコピー用のプレーンテキストに整形する。
 * LINE 等でそのまま送れるよう、タイトル + 番号付きセクション + 箇条書きの読みやすい形にする。
 */
function toPlainText(content: InterviewPrepContent, clientName: string, jobLabel: string): string {
  const header = `【面接対策】${clientName}さん × ${jobLabel}`;
  const body = content.sections
    .map((s, i) => `${i + 1}. ${s.heading}\n${s.items.map((it) => `・${it}`).join("\n")}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}

export function InterviewPrepPanel({
  referralId,
  clientName,
  companyName,
  position,
  careerProfileDone,
  seekerLinked,
  initialContent,
  initialGeneratedAt,
  initialSharedAt,
}: Props) {
  const [content, setContent] = useState<InterviewPrepContent | null>(initialContent);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [sharedAt, setSharedAt] = useState<string | null>(initialSharedAt);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/referrals/${referralId}/interview-prep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        prep?: { content: InterviewPrepContent; generatedAt: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.prep) {
        throw new Error(data.message ?? data.error ?? "生成に失敗しました");
      }
      setContent(data.prep.content);
      setGeneratedAt(data.prep.generatedAt);
      // 再生成するとサーバー側で shared_at が null に戻る(古い内容を誤って見せないため)。
      // 画面上も未共有に戻し、再共有が必要なことを示す。
      setSharedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/referrals/${referralId}/interview-prep`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        prep?: { sharedAt: string | null };
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.prep) {
        throw new Error(data.message ?? data.error ?? "共有に失敗しました");
      }
      setSharedAt(data.prep.sharedAt ?? new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "共有に失敗しました");
    } finally {
      setSharing(false);
    }
  };

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(
        toPlainText(content, clientName, `${companyName}(${position})`),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("クリップボードにコピーできませんでした");
    }
  };

  const hasContent = content !== null && content.sections.length > 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">AI 面接対策</h2>
          {generatedAt && (
            <p className="text-muted-foreground text-xs">生成日時:{formatJst(generatedAt)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasContent && (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "コピーしました" : "コピー"}
            </Button>
          )}
          {hasContent && (
            <Button
              type="button"
              variant={sharedAt ? "outline" : "default"}
              size="sm"
              onClick={() => void handleShare()}
              disabled={sharing || !seekerLinked}
              title={
                seekerLinked ? undefined : "求職者アカウントが連携されていないため共有できません"
              }
            >
              {sharing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {sharing ? "共有中…" : sharedAt ? "再共有" : "求職者に共有"}
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => void handleGenerate()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : hasContent ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {loading ? "生成中…" : hasContent ? "再生成" : "面接対策を生成"}
          </Button>
        </div>
      </div>

      {/* 共有ステータス:共有済みなら日時を、未連携なら共有できない理由を出す */}
      {hasContent && sharedAt && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" />
          求職者に共有済み({formatJst(sharedAt)})— 求職者は Myaira の「面談対策」で閲覧できます
        </p>
      )}
      {hasContent && !sharedAt && seekerLinked && (
        <p className="text-muted-foreground text-xs">
          「求職者に共有」を押すと、求職者本人が Myaira
          で内容を閲覧できるようになります(内容を確認してから共有してください)。
        </p>
      )}
      {hasContent && !seekerLinked && (
        <p className="text-muted-foreground text-xs">
          この求職者はまだ Myaira
          アカウントを連携していないため、共有できません(連携後に共有可能になります)。
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {clientName}さんのプロフィールとこの求人内容をもとに、面接対策を生成します。内容は AI
        による提案です。事前に事実確認のうえご活用ください。
      </p>

      {!careerProfileDone && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <Lightbulb className="mt-0.5 size-4 shrink-0" />
          <p>
            この候補者はまだキャリア棚卸しをしていません。今回はエージェントが入力したプロフィールをもとに作成しています。棚卸しを依頼すると、本人の強み・価値観・志向がより正確に反映され、面接対策の精度が上がります。
          </p>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {loading && !hasContent && (
        <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" />
          面接対策を生成しています(30〜90 秒ほどかかります)…
        </div>
      )}

      {!loading && !hasContent && !error && (
        <div className="text-muted-foreground rounded border border-dashed p-6 text-center text-sm">
          まだ面接対策が生成されていません。
          <br />
          「面接対策を生成」を押してください。
        </div>
      )}

      {hasContent && (
        <div className="space-y-3">
          {content.sections.map((section, idx) => (
            <section key={idx} className="border-border/70 bg-muted/20 rounded-lg border p-4">
              <h3 className="mb-2.5 flex items-center gap-2 text-[0.95rem] leading-snug font-semibold">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white">
                  {idx + 1}
                </span>
                {section.heading}
              </h3>
              <ul className="space-y-2.5 text-sm leading-relaxed">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-orange-500"
                      aria-hidden
                    />
                    <span className="whitespace-pre-wrap">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
