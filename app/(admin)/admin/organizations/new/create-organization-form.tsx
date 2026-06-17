"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/admin/toast/store";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type CreateResponse = {
  ok: boolean;
  organizationId: string;
  invitedUserId: string;
  adminEmail: string;
};

/**
 * 新規組織 + 管理者発行フォーム。
 *
 * 成功時はオリジン側で:
 *  - organizations + auth.users + profile + organization_members が作成済
 *  - Supabase が招待メールを自動送信
 *
 * UI 側はメッセージを表示して一覧に戻すだけ。
 */
export function CreateOrganizationForm() {
  const router = useRouter();
  // 受信箱の「この企業を発行する」ボタンから来た場合、?company= / ?email= で
  // 初期値を埋める。手入力時は単に空のまま。
  // fromContact があれば発行成功時にその問い合わせを自動既読化する。
  const searchParams = useSearchParams();
  const initialCompany = searchParams.get("company") ?? "";
  const initialEmail = searchParams.get("email") ?? "";
  const fromContactId = searchParams.get("fromContact") ?? "";
  const [companyName, setCompanyName] = useState(initialCompany);
  const [adminEmail, setAdminEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const { showToast } = useToast();
  const prefilled = initialCompany.length > 0 || initialEmail.length > 0;

  // form submit:検証 → 確認モーダル表示。実発行は handleConfirm で行う。
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!companyName.trim() || !adminEmail.trim()) {
      setError("会社名とメールアドレスは必須です");
      return;
    }
    setError(null);
    setShowConfirm(true);
  };

  // 確認モーダルで「発行する」を押した時に実際に API を叩く
  const handleConfirm = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<CreateResponse>(`/api/admin/organizations`, {
        method: "POST",
        json: {
          companyName: companyName.trim(),
          adminEmail: adminEmail.trim(),
          fromContactId: fromContactId || undefined,
        },
      });
      if (res?.ok) {
        setSuccess(res);
        setCompanyName("");
        setAdminEmail("");
        showToast("success", `招待メールを ${res.adminEmail} に送信しました`);
        // 発行が成功した後に、起点となった問い合わせを自動的に既読化する
        // (二重対応 / 対応漏れの防止)。失敗してもメインフローは止めない。
        if (fromContactId) {
          try {
            await apiFetch(`/api/admin/contacts`, {
              method: "PATCH",
              json: { id: fromContactId, readAt: "now" },
            });
          } catch {
            // 既読化失敗はサイレント(運営者は手動で既読化可能)
          }
        }
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      setError(msg);
      showToast("error", `発行失敗:${mapErrorMessage(msg)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {prefilled && (
        <div className="rounded border border-blue-300 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/30">
          <p className="font-semibold text-blue-900 dark:text-blue-200">
            問い合わせ受信箱からの転記
          </p>
          <p className="text-blue-900/80 dark:text-blue-200/80">
            会社名 /
            メアドが受信箱の問い合わせから自動入力されました。内容を確認のうえ発行してください。
          </p>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="company_name">
          会社名 <span className="text-red-600">*</span>
        </Label>
        <Input
          id="company_name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="株式会社○○"
          maxLength={200}
          disabled={submitting}
          autoComplete="organization"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="admin_email">
          管理者メールアドレス <span className="text-red-600">*</span>
        </Label>
        <Input
          id="admin_email"
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          placeholder="管理者の業務メールアドレス"
          maxLength={254}
          disabled={submitting}
          autoComplete="email"
        />
        <p className="text-muted-foreground text-[11px]">
          このメアド宛に初回ログイン用のリンクが送られます。
        </p>
      </div>

      {error && <p className="text-destructive text-xs">{mapErrorMessage(error)}</p>}

      {success && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-semibold">招待メールを送信しました</p>
          <p>
            {success.adminEmail}{" "}
            宛に初回ログイン用のリンクを送信しました。受信者がパスワードを設定すると、
            エージェント管理画面 /agency にアクセスできるようになります。
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => router.push("/admin/organizations")}
            >
              企業一覧に戻る
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSuccess(null)}>
              続けてもう 1 社作成
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "送信中…" : "作成して招待メールを送る"}
        </Button>
      </div>

      {/* 発行確認モーダル(誤発行防止) */}
      {showConfirm && (
        <ConfirmModal
          companyName={companyName.trim()}
          adminEmail={adminEmail.trim()}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => void handleConfirm()}
        />
      )}
    </form>
  );
}

function ConfirmModal({
  companyName,
  adminEmail,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  adminEmail: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="bg-card w-full max-w-md rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">発行内容の確認</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          以下の内容でエージェント企業 + 管理者アカウントを発行します。
        </p>
        <dl className="bg-muted/30 mt-4 space-y-2 rounded border p-3 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">会社名</dt>
            <dd className="font-semibold">{companyName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">管理者メールアドレス</dt>
            <dd className="font-mono text-xs">{adminEmail}</dd>
          </div>
        </dl>
        <p className="text-muted-foreground mt-3 text-[11px]">
          この操作で auth.users / profiles / organization_members への INSERT と Supabase
          の招待メール送信が実行されます。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            発行する
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * サーバから返るエラーコードをユーザフレンドリーな日本語に置き換える。
 * クライアント fetch エラー(通信失敗)はそのまま表示。
 */
function mapErrorMessage(raw: string): string {
  if (raw.includes("email_already_exists")) {
    return "このメールアドレスは既に登録されています。別のアドレスを使ってください。";
  }
  if (raw.includes("validation_failed")) {
    return "入力内容に誤りがあります。会社名とメールアドレスを確認してください。";
  }
  if (raw.includes("forbidden")) {
    return "この操作には運営者権限が必要です。";
  }
  if (raw.includes("invite_failed")) {
    return "招待メールの送信に失敗しました。Supabase の Email Templates / SMTP 設定を確認してください。";
  }
  return raw;
}
