"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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

  const handleAiEnhance = () => {
    if (!originalFile) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", originalFile);
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
      } catch (err) {
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
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={pending}>
              キャンセル
            </Button>
            {!aiUrl && (
              <Button size="sm" variant="outline" onClick={handleAiEnhance} disabled={pending}>
                {pending ? "AI 加工中…" : "AI で証明写真に加工"}
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
          <p className="text-muted-foreground text-xs">
            AI 加工は OpenAI gpt-image-1
            を使用し、元画像が外部に送信されます。プライバシーポリシーに沿った AI 処理範囲です。
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
