"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Props = {
  resumeId: string;
  /** 既存の写真の署名 URL(プレビュー)。サーバ側で発行済を渡す。null なら未登録 */
  initialPreviewUrl: string | null;
  /** 既に photo_storage_path が DB に入っているかの判定用 */
  hasPhoto: boolean;
};

/**
 * 履歴書証明写真のアップロード / 削除 UI。
 *
 * 設計判断:
 *   ・編集ページ側に分離して埋め込む(エディタ本体は復号フィールドを多く持つ
 *     ため、写真処理を巻き込まないようにする)
 *   ・アップロード成功時に router.refresh() で SSR から再取得し、初期署名 URL
 *     を更新する(クライアント側で blob URL をいじらない)
 *   ・450×600 の縦長(3:4)で表示。sharp で同サイズに正規化済み
 */
export function AgencyResumePhoto({ resumeId, initialPreviewUrl, hasPhoto }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // AI 加工 Before/After モーダル用の一時 state
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [aiBlob, setAiBlob] = useState<Blob | null>(null);
  const [aiUrl, setAiUrl] = useState<string | null>(null);
  // AI 生成 スタイル。 "preserve" = 元 服装 を 保つ、 "business" = ビジネス
  // フォーマル (男性 = スーツ+ネクタイ、 女性 = スーツ+ブラウス を AI が 自動 選択) に 差し替え。
  const [aiStyle, setAiStyle] = useState<"preserve" | "business">("preserve");

  // Blob URL のリーク防止
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (aiUrl) URL.revokeObjectURL(aiUrl);
    };
  }, [originalUrl, aiUrl]);

  const uploadBlob = (blob: Blob, label: string) => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", new File([blob], `${label}.jpg`, { type: "image/jpeg" }));
      try {
        const res = await fetch(`/api/agency/client-resumes/${resumeId}/photo`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
        }
        // 比較モーダルを閉じる
        setOriginalFile(null);
        setOriginalUrl(null);
        setAiBlob(null);
        setAiUrl(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      }
    });
  };

  const onFile = (file: File) => {
    setError(null);
    setOriginalFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setAiBlob(null);
    setAiUrl(null);
  };

  // AI 加工 中 の 疑似 進捗 ( 0 → 95% を 経過 時間 で 漸近 線 上 で 上げる、
  // 完了 時 に 100% に ジャンプ )。 OpenAI 側 が 進捗 を 返さ ない ため、
  // ユーザー の 体感 を 良く する 目的 の 表示。
  const [progress, setProgress] = useState<number | null>(null);
  const progressRafRef = useRef<number | null>(null);

  const stopProgressTimer = () => {
    if (progressRafRef.current !== null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopProgressTimer();
  }, []);

  const handleAiEnhance = () => {
    if (!originalFile) return;
    setError(null);

    // 疑似 進捗 開始
    setProgress(0);
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startTime) / 1000; // 秒
      // 25 秒 で 約 60%、 50 秒 で 約 85%、 漸近 95% で 頭打ち
      const p = Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / 25))));
      setProgress(p);
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);

    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", originalFile);
      fd.append("style", aiStyle);
      try {
        const res = await fetch(`/api/agency/client-resumes/${resumeId}/photo/ai-enhance`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        setAiBlob(blob);
        if (aiUrl) URL.revokeObjectURL(aiUrl);
        setAiUrl(URL.createObjectURL(blob));
        // 進捗 を 100% に 持って いって すぐ クリア
        stopProgressTimer();
        setProgress(100);
        setTimeout(() => setProgress(null), 600);
      } catch (err) {
        stopProgressTimer();
        setProgress(null);
        setError(err instanceof Error ? err.message : "AI 加工に失敗しました");
      }
    });
  };

  const handleSaveOriginal = () => {
    if (!originalFile) return;
    uploadBlob(originalFile, "photo");
  };

  const handleSaveAi = () => {
    if (!aiBlob) return;
    uploadBlob(aiBlob, "photo-ai");
  };

  const handleCancel = () => {
    setOriginalFile(null);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(null);
    setAiBlob(null);
    if (aiUrl) URL.revokeObjectURL(aiUrl);
    setAiUrl(null);
  };

  const onDelete = () => {
    if (!confirm("証明写真を削除します。実行しますか?")) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agency/client-resumes/${resumeId}/photo`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  };

  return (
    <Card className="space-y-3 p-6">
      <h2 className="text-base font-semibold">証明写真</h2>
      <p className="text-muted-foreground text-xs">
        JPG / PNG / WebP、5MB 以下。アップロード時に 450×600(3:4)に正規化されます。
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="border-input bg-muted/30 relative aspect-3/4 w-32 shrink-0 overflow-hidden rounded-md border">
          {initialPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={initialPreviewUrl} alt="証明写真" className="h-full w-full object-cover" />
          ) : hasPhoto ? (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center text-[10px]">
              表示できません(再アップロード)
            </div>
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
              未登録
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
            disabled={pending}
          />
          <p className="text-muted-foreground text-xs">
            ファイルを選ぶと「そのまま保存」「AI 加工して保存」を選べます。
          </p>
          {hasPhoto && (
            <Button variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
              削除する
            </Button>
          )}
        </div>
      </div>

      {/* Before/After モーダル風 比較 UI */}
      {originalUrl && (
        <div className="bg-background/60 mt-3 space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">写真の確認</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PhotoCompare label="元の写真" url={originalUrl} />
            <PhotoCompare label="AI 加工版" url={aiUrl} placeholderText="まだ生成していません" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!aiUrl && (
              <div className="mr-auto flex items-center gap-1.5">
                <label htmlFor="agency-ai-style-select" className="text-muted-foreground text-xs">
                  服装
                </label>
                <select
                  id="agency-ai-style-select"
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value as "preserve" | "business")}
                  disabled={pending}
                  className="border-input bg-background rounded-md border px-2 py-1 text-xs"
                >
                  <option value="preserve">元のまま</option>
                  <option value="business">ビジネス服装に変換</option>
                </select>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={pending}>
              キャンセル
            </Button>
            {!aiUrl && (
              <Button size="sm" variant="outline" onClick={handleAiEnhance} disabled={pending}>
                {pending && progress !== null
                  ? `AI 加工中… ${progress}%`
                  : pending
                    ? "AI 加工中…"
                    : "AI で証明写真に加工"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleSaveOriginal} disabled={pending}>
              {pending ? "保存中…" : "元のまま保存"}
            </Button>
            {aiUrl && (
              <Button size="sm" onClick={handleSaveAi} disabled={pending}>
                {pending ? "保存中…" : "AI 加工で保存"}
              </Button>
            )}
          </div>
          {progress !== null && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">AI 加工中… {progress}%</p>
              <div className="h-1.5 w-full rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-orange-500 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            元画像は外部の AI 画像処理サービスに送信されます。プライバシーポリシーに沿った AI
            処理範囲で扱われます。
          </p>
        </div>
      )}
    </Card>
  );
}

function PhotoCompare({
  label,
  url,
  placeholderText,
}: {
  label: string;
  url: string | null;
  placeholderText?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="border-input bg-muted/30 relative aspect-3/4 w-full overflow-hidden rounded-md border">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
            {placeholderText ?? "なし"}
          </div>
        )}
      </div>
    </div>
  );
}
