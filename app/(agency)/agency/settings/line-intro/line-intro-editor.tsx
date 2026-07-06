"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * LINE 自己 紹介 の 編集 フォーム (Client Component)。
 *
 * ・顔 写真 は 独立 して アップロード / 削除 (POST/DELETE /photo)
 * ・ヘッド ライン と 本文 は PATCH で 一括 更新
 * ・状態 表示: 保存 中、 保存 完了 の トースト 相当 (簡易 テキスト)
 */
type Props = {
  initialHeadline: string;
  initialBody: string;
  initialPhotoUrl: string | null;
  updatedAt: string | null;
};

const HEADLINE_MAX = 120;
const BODY_MAX = 2000;

export function LineIntroEditor({
  initialHeadline,
  initialBody,
  initialPhotoUrl,
  updatedAt,
}: Props) {
  const [headline, setHeadline] = useState(initialHeadline);
  const [body, setBody] = useState(initialBody);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // 「保存 完了 ✓」 を ボタン に 一時 表示 する ため の flag
  const [justSaved, setJustSaved] = useState(false);

  // 成功 メッセージ は 4 秒 で 自動 消滅
  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(t);
  }, [successMessage]);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/settings/line-intro", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: headline.trim() ? headline.trim() : null,
          body: body.trim() ? body.trim() : null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
      }
      setSavedAt(new Date());
      setSuccessMessage("プロフィールを保存しました");
      setJustSaved(true);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/agency/settings/line-intro/photo", {
        method: "POST",
        body: fd,
      });
      const b = (await res.json().catch(() => null)) as {
        ok?: boolean;
        publicUrl?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !b?.ok) {
        throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
      }
      setPhotoUrl(b.publicUrl ?? null);
      setSuccessMessage("顔写真をアップロードしました");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    if (!confirm("顔写真を削除しますか?")) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/settings/line-intro/photo", {
        method: "DELETE",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
      }
      setPhotoUrl(null);
      setSuccessMessage("顔写真を削除しました");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <Card className="space-y-6 p-6">
      {/* 保存 成功 の 通知 (4 秒 で 自動 消滅) */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {successMessage}
        </div>
      )}

      {/* 顔写真 */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold">顔写真</label>
        <div className="flex items-start gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-24 w-24 shrink-0 rounded-md bg-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
              <ImagePlus className="h-8 w-8" aria-hidden />
            </div>
          )}
          <div className="flex-1 space-y-2">
            <label className="border-input hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              {photoUrl ? "写真を差し替え" : "写真をアップロード"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={photoBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
            {photoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={removePhoto}
                disabled={photoBusy}
                className="ml-2"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                削除
              </Button>
            )}
            <p className="text-muted-foreground text-[10px]">JPEG / PNG / WebP、5 MiB 以下</p>
          </div>
        </div>
      </div>

      {/* ヘッドライン */}
      <div className="space-y-1">
        <label htmlFor="headline" className="block text-sm font-semibold">
          ヘッドライン
        </label>
        <input
          id="headline"
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={HEADLINE_MAX}
          placeholder="例: 田中 太郎 / キャリアアドバイザー"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <p className="text-muted-foreground text-[10px]">
          {headline.length} / {HEADLINE_MAX} 字
        </p>
      </div>

      {/* 本文 */}
      <div className="space-y-1">
        <label htmlFor="body" className="block text-sm font-semibold">
          エージェントとしての思い / 経歴
        </label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX}
          rows={10}
          placeholder="例: 5 年間、IT業界を中心に 200 名以上の転職支援を担当してきました。あなたの本当にやりたいことを一緒に見つけていきたいと思っています。"
          className="border-input bg-background w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed"
        />
        <p className="text-muted-foreground text-[10px]">
          {body.length} / {BODY_MAX} 字 · 本文はサーバー側で暗号化して保存されます
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-xs">
          {savedAt
            ? `保存しました (${savedAt.toLocaleTimeString("ja-JP")})`
            : updatedAt
              ? `最終更新: ${new Date(updatedAt).toLocaleString("ja-JP")}`
              : "未保存"}
        </div>
        <Button
          onClick={save}
          disabled={busy}
          className={justSaved ? "bg-emerald-600 text-white hover:bg-emerald-600" : undefined}
        >
          {busy ? (
            "保存中…"
          ) : justSaved ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              保存 完了
            </span>
          ) : (
            "保存"
          )}
        </Button>
      </div>
    </Card>
  );
}
