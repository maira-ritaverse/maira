"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";
import type { JobImageKind } from "@/lib/jobs/types";

/**
 * 求人 画像 (hero / line_share) の アップロード + プレビュー + 削除 UI
 *
 * 単一 画像 ごと の コントロール。 jobId と kind を 渡せば 該当 列 を 操作 する。
 * 親 (Server Component) で 既存 画像 の public URL を 計算 して 渡す と
 * 初期 表示 が 速く なる。
 */
type Props = {
  jobId: string;
  kind: JobImageKind;
  label: string;
  description?: string;
  initialImageUrl: string | null;
};

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

export function JobImageUploader({ jobId, kind, label, description, initialImageUrl }: Props) {
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("5 MiB 以内 の 画像 に して ください");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("JPEG / PNG / WebP の いずれか で アップロード して ください");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/agency/jobs/${jobId}/images?kind=${kind}`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; publicUrl: string }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in data && data.ok)) {
        const msg =
          "message" in data && data.message
            ? data.message
            : "error" in data
              ? data.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      // cache busting に query を 付与
      setImageUrl(`${data.publicUrl}?t=${Date.now()}`);
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm("画像 を 削除 します。 よろしい です か?")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/jobs/${jobId}/images?kind=${kind}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setImageUrl(null);
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const inputId = `job-img-${jobId}-${kind}`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{label}</Label>
        {description && <p className="text-muted-foreground text-[10px]">{description}</p>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        {/* プレビュー */}
        <div className="flex h-32 w-56 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-50">
          {imageUrl ? (
            // 単純 <img> で 十分 (next/image は public バケット への 設定 が 必要)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={label}
              className="h-full w-full object-cover"
              onError={() => setImageUrl(null)}
            />
          ) : (
            <span className="text-muted-foreground text-xs">未設定</span>
          )}
        </div>

        {/* 操作 */}
        <div className="flex flex-col gap-1.5">
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={uploading || deleting}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ""; // 同 ファイル を 再 選択 でき る ように
              if (f) void onFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || deleting}
            onClick={() => document.getElementById(inputId)?.click()}
          >
            {uploading ? "アップロード中..." : imageUrl ? "差し替え" : "画像 を 選択"}
          </Button>
          {imageUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading || deleting}
              onClick={() => void onDelete()}
              className="text-red-600 hover:text-red-700"
            >
              {deleting ? "削除中..." : "削除"}
            </Button>
          )}
          <p className="text-muted-foreground text-[10px]">
            JPEG / PNG / WebP、 5 MiB 以内。 推奨 1024×640 (比率 ≈ 1.91:1)
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
