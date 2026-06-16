"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client-fetch";

import {
  QuotaExceededModal,
  extractQuotaInfo,
  type QuotaInfo,
} from "../../_components/quota-exceeded-modal";

type Props = {
  resumeId: string;
  /** AI に投げる元の自撮り(File) */
  originalFile: File;
  onClose: () => void;
  onSaved: (photoPath: string) => void;
};

/**
 * AI 仕上げ写真の Before/After 比較モーダル。
 *
 * 流れ:
 *   1) /ai-enhance に元画像を投げ、JPEG バイナリで AI 結果を受け取る
 *   2) Before(元) / After(AI)を並べてプレビュー表示
 *   3) 「この写真で保存」→ AI Blob を /photo POST にそのまま流して保存
 *      「やり直す」→ モーダルを閉じて呼び出し側に通知
 *
 * 設計理由:
 *   ・AI が顔を別人にしてしまう / 期待と違うケースは現実的に起きる
 *   ・「保存前に止められる」UX を保証するため、サーバ側は ai-enhance では保存しない
 *   ・保存パスは通常 POST /photo の 1 本に揃え、整合性のリスクを減らす
 */
export function PhotoAiCompareModal({ resumeId, originalFile, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<"processing" | "ready" | "saving" | "error">("processing");
  const [error, setError] = useState<string | null>(null);
  const [aiBlob, setAiBlob] = useState<Blob | null>(null);
  const [aiUrl, setAiUrl] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);

  // 元画像プレビュー URL は useMemo で props と同期(set-state-in-effect 警告回避)
  const originalUrl = useMemo(() => URL.createObjectURL(originalFile), [originalFile]);
  useEffect(() => {
    return () => URL.revokeObjectURL(originalUrl);
  }, [originalUrl]);

  // マウント時に AI 仕上げを 1 回だけ走らせる
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const form = new FormData();
        form.append("file", originalFile);
        const res = await fetch(`/api/resumes/${resumeId}/photo/ai-enhance`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          // 402 はクォータ超過なので別 UX(モーダル)に倒す
          if (res.status === 402) {
            const data = (await res.json().catch(() => null)) as unknown;
            if (cancelled) return;
            const info = extractQuotaInfo(data);
            setQuotaInfo(info);
            setStage("error");
            return;
          }
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new ApiClientError(data.message ?? data.error ?? "AI 仕上げに失敗しました", {
            status: res.status,
          });
        }
        const blob = await res.blob();
        if (cancelled) return;
        setAiBlob(blob);
        setAiUrl(URL.createObjectURL(blob));
        setStage("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setStage("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [originalFile, resumeId]);

  // AI Blob のローカル URL は明示 revoke しないとリークするので、置換 / unmount 時に開放
  useEffect(() => {
    return () => {
      if (aiUrl) URL.revokeObjectURL(aiUrl);
    };
  }, [aiUrl]);

  const handleSave = async () => {
    if (!aiBlob) return;
    setStage("saving");
    setError(null);
    try {
      const form = new FormData();
      // 既存 /photo エンドポイントは "file" フィールドを期待
      form.append("file", aiBlob, "ai-photo.jpg");
      const res = await fetch(`/api/resumes/${resumeId}/photo`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.message ?? data.error ?? "保存に失敗しました");
      }
      const data = (await res.json()) as { photo_url: string };
      onSaved(data.photo_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStage("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI 証明写真の確認"
    >
      <div className="bg-background w-full max-w-2xl space-y-4 rounded-lg border p-5 shadow-lg">
        <div>
          <h2 className="text-lg font-semibold">AI 証明写真の確認</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            元画像と AI
            仕上げ後を比較してから保存します。お顔の印象が違うと感じたら「やり直す」をお選びください。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">元画像</p>
            <div className="bg-muted/30 aspect-3/4 overflow-hidden rounded-md border">
              {originalUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={originalUrl} alt="元画像" className="h-full w-full object-cover" />
              )}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">AI 仕上げ後</p>
            <div className="bg-muted/30 relative aspect-3/4 overflow-hidden rounded-md border">
              {stage === "processing" ? (
                <div className="text-muted-foreground absolute inset-0 flex items-center justify-center px-2 text-center text-xs">
                  AI で仕上げ中…
                  <br />
                  (30 秒程度)
                </div>
              ) : aiUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={aiUrl} alt="AI 仕上げ後" className="h-full w-full object-cover" />
              ) : (
                <div className="text-muted-foreground absolute inset-0 flex items-center justify-center px-2 text-center text-xs">
                  失敗しました
                </div>
              )}
              {stage === "saving" && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs">
                  保存中…
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={stage === "saving"}>
            キャンセル
          </Button>
          <Button variant="outline" onClick={onClose} disabled={stage === "saving"}>
            やり直す
          </Button>
          <Button onClick={() => void handleSave()} disabled={stage !== "ready"}>
            {stage === "saving" ? "保存中…" : "この写真で保存"}
          </Button>
        </div>
      </div>

      <QuotaExceededModal
        open={quotaInfo !== null}
        featureLabel="AI 証明写真"
        usage={quotaInfo}
        onClose={() => {
          setQuotaInfo(null);
          onClose();
        }}
      />
    </div>
  );
}
