"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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

  const onFile = (file: File) => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(`/api/agency/client-resumes/${resumeId}/photo`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      }
    });
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
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              // 同一ファイルの再アップロードもできるよう、選択値をクリア
              e.target.value = "";
            }}
            disabled={pending}
          />
          {hasPhoto && (
            <Button variant="ghost" size="sm" onClick={onDelete} disabled={pending}>
              削除する
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
