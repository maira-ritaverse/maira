"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { createClient } from "@/lib/supabase/client";

const REQUIRED_CONFIRM_TEXT = "アカウントを削除します";

/**
 * アカウント削除セクション。
 *
 * 削除は不可逆のため:
 *   1. 「削除する」ボタンを 1 段階目でアコーディオン展開
 *   2. ユーザに REQUIRED_CONFIRM_TEXT を手入力させる
 *   3. 完全一致のみ API 呼出を許可
 *   4. 成功後はクライアントセッションをログアウト → トップへリダイレクト
 *
 * 警告色は red 系で囲み、誤押下を視覚的にも防ぐ。
 */
export function AccountDeleteSection() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = confirmText.trim() === REQUIRED_CONFIRM_TEXT && !deleting;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch("/api/account/delete", {
        method: "POST",
        json: { confirmText },
      });
      // クライアント側セッションも消してから / に戻す。
      // ※ サーバ側で既に auth.users は消えているので、signOut 呼出は cookie 掃除目的。
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch {
        // signOut の失敗はクリティカルではない(cookie は次のリロードで失効する)
      }
      router.replace("/?account=deleted");
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <Card className="space-y-3 border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/30">
      <div>
        <h2 className="text-base font-semibold text-red-900 dark:text-red-200">アカウントを削除</h2>
        <p className="text-xs text-red-800 dark:text-red-300">
          履歴書 / 職務経歴書 / キャリア棚卸し / 応募・タスク / 通知履歴を含む、すべてのデータが
          即座に削除されます。この操作は元に戻せません。
        </p>
      </div>

      {!expanded ? (
        <Button variant="destructive" size="sm" onClick={() => setExpanded(true)}>
          アカウントを削除する
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="confirm-text" className="text-red-900 dark:text-red-200">
              削除を続けるには、下の枠に「<strong>{REQUIRED_CONFIRM_TEXT}</strong>
              」と入力してください
            </Label>
            <Input
              id="confirm-text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={REQUIRED_CONFIRM_TEXT}
              disabled={deleting}
              autoComplete="off"
            />
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExpanded(false);
                setConfirmText("");
                setError(null);
              }}
              disabled={deleting}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={!canSubmit}
            >
              {deleting ? "削除中…" : "完全に削除する"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
