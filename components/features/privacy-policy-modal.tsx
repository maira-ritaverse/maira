"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  /** 既存同意の有無(false=完全新規、true=旧バージョンに同意済)で文面を切替 */
  hasPrior: boolean;
};

/**
 * プライバシーポリシー同意モーダル。
 *
 * UX:
 *   - 画面をブロックする overlay。同意するまで dismiss 不可
 *     (ESC / 背景クリックでは閉じない:法令対応上、本人の明示的な同意が必要)
 *   - チェックボックスを入れないと「同意する」ボタンは disabled
 *   - 同意成功 → router.refresh() でレイアウト側の判定を再評価 → モーダルが消える
 *
 * セキュリティ:
 *   - 同意 API は本人セッション必須(サーバ側で認証する)
 *   - 監査ログには audit_logs(action='privacy_policy_accepted')として記録
 */
export function PrivacyPolicyModal({ hasPrior }: Props) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/account/privacy-policy/accept", { method: "POST" });
      // Server Component 側の判定を再評価させる。
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-title"
    >
      <div className="bg-background w-full max-w-lg rounded-lg border p-6 shadow-xl">
        <h2 id="policy-title" className="text-xl font-bold">
          {hasPrior ? "プライバシーポリシーが更新されました" : "プライバシーポリシーへの同意"}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Myaira を引き続きご利用いただくために、最新のプライバシーポリシーを
          ご確認のうえ同意してください。
        </p>

        <div className="bg-muted/30 mt-4 max-h-64 overflow-y-auto rounded border p-3 text-xs leading-relaxed">
          <p className="font-semibold">主なポイント</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              履歴書 / 職務経歴書 / キャリア棚卸し / 応募などの機密情報は AES-256-GCM で
              サーバーサイド暗号化されます。
            </li>
            <li>
              運営者(Myaira)はサポートや本人同意済の AI 処理、法令対応に必要な範囲で
              暗号データの復号を行うことがあります。
            </li>
            <li>
              ご本人はいつでもデータのエクスポート(JSON ダウンロード)と アカウント削除を「設定 →
              アカウント」から実行できます。
            </li>
            <li>
              詳細は{" "}
              <Link
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                プライバシーポリシー全文
              </Link>{" "}
              をご確認ください。
            </li>
          </ul>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={submitting}
            className="mt-1"
          />
          <span>プライバシーポリシーの内容を確認し、同意します。</span>
        </label>

        {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => void handleAccept()} disabled={!checked || submitting}>
            {submitting ? "送信中…" : "同意する"}
          </Button>
        </div>
      </div>
    </div>
  );
}
