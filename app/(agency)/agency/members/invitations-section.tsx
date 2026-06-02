"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNow } from "@/lib/agency-tasks/use-now";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrganizationInvitation, OrganizationRole } from "@/lib/organizations/types";

const roleLabel: Record<OrganizationRole, string> = {
  admin: "管理者",
  advisor: "アドバイザー",
};

type InvitationWithUrl = {
  invitation: OrganizationInvitation;
  inviteUrl: string | null;
};

type Props = {
  invitations: InvitationWithUrl[];
};

/**
 * 招待中セクション(発行フォーム + 一覧 + 取消)
 *
 * - メール + role を入力 → POST → router.refresh()
 * - 発行直後にバナーで「メール送信できたか / リンクを手動で渡してください」を表示
 * - 「招待リンクをコピー」で URL をクリップボードへ
 * - 「取消」で PATCH(action: 'revoke')
 *
 * Resend 未設定環境では emailStatus.sent === false で返ってくるため、
 * その時はリンクコピーを促す UI に倒す。
 */
export function InvitationsSection({ invitations }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("advisor");
  const [submitting, setSubmitting] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const now = useNow();

  const [notice, setNotice] = useState<
    | { kind: "success"; message: string; inviteUrl?: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setNotice(null);

    try {
      const res = await fetch("/api/agency/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        inviteUrl?: string;
        emailStatus?: { sent: boolean; reason?: string };
      };

      if (!res.ok) {
        const msg = data.message ?? data.error ?? `発行に失敗しました(HTTP ${res.status})`;
        setNotice({ kind: "error", message: msg });
        return;
      }

      // メール送信できたかどうかで案内文を変える
      const sent = data.emailStatus?.sent ?? false;
      const msg = sent
        ? "招待を発行し、メールを送信しました。"
        : "招待を発行しました。メール送信は未設定のため行われませんでした。下のリンクを直接渡してください。";
      setNotice({ kind: "success", message: msg, inviteUrl: data.inviteUrl });
      setEmail("");
      router.refresh();
    } catch (err) {
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "通信エラーが発生しました",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (inv: OrganizationInvitation) => {
    if (!window.confirm(`${inv.email} 宛の招待を取り消しますか?`)) return;

    setPendingRevokeId(inv.id);
    setNotice(null);

    try {
      const res = await fetch(`/api/agency/invitations/${inv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setNotice({
          kind: "error",
          message: data.message ?? data.error ?? `取消に失敗しました(HTTP ${res.status})`,
        });
        return;
      }

      router.refresh();
    } catch (err) {
      setNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "通信エラーが発生しました",
      });
    } finally {
      setPendingRevokeId(null);
    }
  };

  const handleCopy = async (token: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      // 2 秒後にラベルを戻す
      window.setTimeout(() => setCopiedToken((prev) => (prev === token ? null : prev)), 2000);
    } catch {
      // クリップボード API が拒否されたケース。URL を表示するのみで止める。
      setNotice({ kind: "error", message: "クリップボードに書き込めませんでした。" });
    }
  };

  return (
    <div className="space-y-4">
      {/* 発行フォーム */}
      <form
        onSubmit={handleIssue}
        className="ring-foreground/10 flex flex-wrap items-end gap-3 rounded-xl p-4 ring-1"
      >
        <div className="min-w-55 flex-1 space-y-1">
          <label className="text-muted-foreground text-xs" htmlFor="invite-email">
            招待先メールアドレス
          </label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@company.com"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs" htmlFor="invite-role">
            ロール
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as OrganizationRole)}
            className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
          >
            <option value="advisor">アドバイザー</option>
            <option value="admin">管理者</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting || email.trim().length === 0}>
          {submitting ? "発行中…" : "招待を発行"}
        </Button>
      </form>

      {/* 発行後の案内バナー */}
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.kind === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <p>{notice.message}</p>
          {notice.kind === "success" && notice.inviteUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="bg-muted block flex-1 truncate rounded px-2 py-1 text-xs">
                {notice.inviteUrl}
              </code>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => handleCopy("__notice__", notice.inviteUrl!)}
              >
                <CopyIcon />
                {copiedToken === "__notice__" ? "コピーしました" : "コピー"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 招待中一覧 */}
      <div className="ring-foreground/10 rounded-xl ring-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>メール</TableHead>
              <TableHead>ロール</TableHead>
              <TableHead>発行日</TableHead>
              <TableHead>有効期限</TableHead>
              <TableHead className="w-56">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  招待中の人はいません
                </TableCell>
              </TableRow>
            ) : (
              invitations.map(({ invitation: inv, inviteUrl }) => {
                // SSR と差分が出ないよう、useNow が null(マウント前)は期限切れ判定を保留
                const expired = now ? new Date(inv.expiresAt).getTime() < now.getTime() : false;
                const isPendingRevoke = pendingRevokeId === inv.id;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <span className="bg-muted inline-block rounded-full px-2 py-0.5 text-xs">
                        {roleLabel[inv.role]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(inv.createdAt).toLocaleDateString("ja-JP")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className={expired ? "text-destructive" : "text-muted-foreground"}>
                        {new Date(inv.expiresAt).toLocaleString("ja-JP", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {expired ? "(期限切れ)" : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {inviteUrl && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => handleCopy(inv.token, inviteUrl)}
                          >
                            <CopyIcon />
                            {copiedToken === inv.token ? "コピーしました" : "リンク"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          disabled={isPendingRevoke}
                          onClick={() => handleRevoke(inv)}
                        >
                          {isPendingRevoke ? "取消中…" : "取消"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
