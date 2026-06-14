"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * MA 機能の利用同意モーダル
 *
 * EMPRO の「ご利用にあたって」モーダルを参考に、法令遵守の特約に同意することを
 * UI で明示してから機能を有効化する。
 *
 * 設計:
 *   - 親(MarketingScreen)から open を制御する
 *   - 「同意して進む」で POST /api/agency/ma/consent → 親へ通知 → router.refresh()
 *   - 「キャンセル」で閉じる(機能は使えないまま)
 *   - non-admin の場合はそもそも表示しない(画面側で readonly UI を出す)
 */
export type ConsentModalProps = {
  open: boolean;
  feature: "email_ma";
  consentVersion: string;
  onClose: () => void;
};

export function ConsentModal({ open, feature, consentVersion, onClose }: ConsentModalProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/ma/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, consentVersion }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "同意の記録に失敗しました");
      }
      onClose();
      // サーバーコンポーネント(page.tsx)を再フェッチして同意状態を更新
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogTitle>マーケティング機能のご利用にあたって</AlertDialogTitle>
        <AlertDialogDescription className="sr-only">配信特約への同意確認</AlertDialogDescription>

        <div className="space-y-4 text-sm">
          <section className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <h3 className="mb-2 font-semibold text-emerald-900">許容される利用範囲</h3>
            <ul className="list-disc space-y-1 pl-5 text-emerald-900">
              <li>登録済みの求職者への業務連絡(面談案内、求人紹介、フォローアップ等)</li>
              <li>シナリオに沿った定型メッセージの自動送信</li>
              <li>ワンクリック解除手段を必ず提供すること</li>
              <li>受信拒否済みのユーザーへの再送信は行わないこと</li>
            </ul>
          </section>

          <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <h3 className="mb-2 font-semibold text-amber-900">お客様にお願いしたいこと</h3>
            <ul className="list-disc space-y-1 pl-5 text-amber-900">
              <li>特定電子メール法・個人情報保護法などの関連法令を遵守すること</li>
              <li>過度な配信頻度を避け、求職者の利益に資する内容のみ送ること</li>
              <li>送信元メールアドレス・組織名を明確に表示すること</li>
              <li>ユーザーからの停止依頼に速やかに対応すること</li>
            </ul>
          </section>

          <p className="text-muted-foreground text-xs">
            特約バージョン: <span className="font-mono">{consentVersion}</span>
            <br />
            同意後も、設定画面からいつでも撤回できます。撤回すると以後の自動配信は停止します。
          </p>
        </div>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={handleAccept} disabled={submitting}>
            {submitting ? "送信中..." : "上記に同意して進む"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
