"use client";

import { ImagePlus, Trash2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * アバター 画像 アップローダー
 *
 * - 現在 の アバター を プレビュー (なければ User アイコン)
 * - 「画像 を 変更」 で ファイル ピッカー → POST /api/me/avatar (multipart)
 * - 「削除」 で DELETE /api/me/avatar
 *
 * 保存 後 は router.refresh() で profile 取得 元 を 再 評価。
 * 失敗 時 は インライン で エラー 表示。
 */
type Props = {
  /** Storage の path を public URL に 解決 した もの (null = 未設定) */
  initialPublicUrl: string | null;
  /** 副題 用 (例: 表示名 or メアド の 頭文字) */
  fallbackInitial: string;
};

export function AvatarUploader({ initialPublicUrl, fallbackInitial }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPublicUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => {
    setError(null);
    inputRef.current?.click();
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じ ファイル を 再選択 でき る ように
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/me/avatar", {
        method: "POST",
        body: form,
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        publicUrl?: string;
      } | null;
      if (!res.ok) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      setPreviewUrl(body?.publicUrl ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロード に 失敗 しました");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!previewUrl) return;
    if (!confirm("アバター 画像 を 削除 します。 よろしい です か?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setPreviewUrl(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除 に 失敗 しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="アバター"
            className="h-16 w-16 shrink-0 rounded-full bg-slate-100 object-cover"
          />
        ) : (
          <div className="bg-muted text-muted-foreground flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-semibold">
            {fallbackInitial ? (
              fallbackInitial.charAt(0).toUpperCase()
            ) : (
              <User className="size-6" aria-hidden />
            )}
          </div>
        )}
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">アイコン 画像</p>
          <p className="text-muted-foreground text-xs">
            JPEG / PNG / WebP、 2 MiB 以下。 組織 内 メンバー 一覧 / タスク 担当 表示 等 で この
            画像 が 出ます。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onChange}
          disabled={busy}
        />
        <Button size="sm" type="button" onClick={openPicker} disabled={busy}>
          <ImagePlus className="mr-1 size-4" aria-hidden />
          {previewUrl ? "画像 を 変更" : "画像 を 追加"}
        </Button>
        {previewUrl && (
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void onDelete()}
            disabled={busy}
          >
            <Trash2 className="mr-1 size-4" aria-hidden />
            削除
          </Button>
        )}
        {busy && <span className="text-muted-foreground text-xs">処理中…</span>}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
