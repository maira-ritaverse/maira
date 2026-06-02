"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrganizationMemberListItem } from "@/lib/organizations/members";
import type { OrganizationRole } from "@/lib/organizations/types";
import {
  PERMISSION_KEYS,
  permissionConfig,
  type MemberPermissionFlags,
  type PermissionKey,
} from "@/lib/permissions/types";

type MembersTableProps = {
  members: OrganizationMemberListItem[];
  currentMemberId: string;
};

const roleLabel: Record<OrganizationRole, string> = {
  admin: "管理者",
  advisor: "アドバイザー",
};

/**
 * 参加メンバー一覧テーブル
 *
 * - role 変更は DropdownMenu → window.confirm → PATCH。
 *   既存の destructive 操作と同じ confirm スタイルに揃える(別途 Dialog 追加しない)。
 * - 最後の admin 降格はサーバー側で必ず弾かれるので、UI は楽観的に呼び出して
 *   エラー時のメッセージで分かりやすく伝える。
 * - 権限(export 等)はバッジで表示(編集は S3 以降)。
 */
export function MembersTable({ members, currentMemberId }: MembersTableProps) {
  const router = useRouter();
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [pendingPermissionKey, setPendingPermissionKey] = useState<PermissionKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 並び順:admin → advisor、同 role 内では参加日(古い順)
  const sorted = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [members]);

  const handleChangeRole = async (
    member: OrganizationMemberListItem,
    newRole: OrganizationRole,
  ) => {
    if (member.role === newRole) return;

    const displayName = member.displayName ?? member.email ?? "このメンバー";
    const isSelf = member.memberId === currentMemberId;

    // 確認ダイアログ。自分自身の降格は特に強い警告を出す。
    const confirmMessage =
      isSelf && newRole === "advisor"
        ? `自分自身を「${roleLabel[newRole]}」に降格します。以降この画面にアクセスできなくなります。本当に変更しますか?`
        : `${displayName}さんを「${roleLabel[newRole]}」に変更しますか?`;

    if (!window.confirm(confirmMessage)) return;

    setPendingMemberId(member.memberId);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/agency/members/${member.memberId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const msg = data.message ?? data.error ?? `変更に失敗しました(HTTP ${res.status})`;
        setErrorMessage(msg);
        return;
      }

      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setPendingMemberId(null);
    }
  };

  /**
   * advisor の権限フラグをトグル。
   * admin の権限はサーバー側で拒否されるので、UI でも開かないこと。
   */
  const handleTogglePermission = async (
    member: OrganizationMemberListItem,
    permissionKey: PermissionKey,
  ) => {
    const newValue = !member.permissions[permissionKey];
    const displayName = member.displayName ?? member.email ?? "このメンバー";
    const config = permissionConfig[permissionKey];

    const confirmMessage = newValue
      ? `${displayName}さんに「${config.label}」権限を付与しますか?`
      : `${displayName}さんから「${config.label}」権限を取り消しますか?`;

    if (!window.confirm(confirmMessage)) return;

    setPendingMemberId(member.memberId);
    setPendingPermissionKey(permissionKey);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/agency/members/${member.memberId}/permissions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissionKey, granted: newValue }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const msg = data.message ?? data.error ?? `権限変更に失敗しました(HTTP ${res.status})`;
        setErrorMessage(msg);
        return;
      }

      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setPendingMemberId(null);
      setPendingPermissionKey(null);
    }
  };

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {errorMessage}
        </div>
      )}

      <div className="ring-foreground/10 rounded-xl ring-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名前</TableHead>
              <TableHead>メール</TableHead>
              <TableHead>権限</TableHead>
              <TableHead className="w-40">ロール</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                  メンバーがいません
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((m) => {
                const isSelf = m.memberId === currentMemberId;
                const isPending = pendingMemberId === m.memberId;
                return (
                  <TableRow key={m.memberId}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{m.displayName ?? "(名前未設定)"}</span>
                        {isSelf && (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                            あなた
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                    <TableCell>
                      <PermissionCell
                        role={m.role}
                        permissions={m.permissions}
                        pendingKey={isPending ? pendingPermissionKey : null}
                        onToggle={(key) => handleTogglePermission(m, key)}
                      />
                    </TableCell>
                    <TableCell>
                      <RoleDropdown
                        member={m}
                        isPending={isPending}
                        onChange={(newRole) => handleChangeRole(m, newRole)}
                      />
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

/**
 * 権限セル。
 * - admin → 「常に可」表示(トグルなし)。サーバー側でも admin への toggle は弾かれる。
 * - advisor → 権限キーごとに on/off ボタンを並べる(現状は export のみ)。
 *   confirm ダイアログ → PATCH → router.refresh()。
 */
function PermissionCell({
  role,
  permissions,
  pendingKey,
  onToggle,
}: {
  role: OrganizationRole;
  permissions: MemberPermissionFlags;
  pendingKey: PermissionKey | null;
  onToggle: (key: PermissionKey) => void;
}) {
  if (role === "admin") {
    return (
      <span className="bg-primary/10 text-primary inline-block rounded-full px-2 py-0.5 text-xs">
        常に可(管理者)
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.values(PERMISSION_KEYS).map((k) => {
        const granted = permissions[k];
        const isPending = pendingKey === k;
        return (
          <Button
            key={k}
            variant={granted ? "default" : "outline"}
            size="xs"
            disabled={isPending}
            onClick={() => onToggle(k)}
            title={permissionConfig[k].description}
          >
            {permissionConfig[k].label}:{granted ? "ON" : "OFF"}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * ロール変更ドロップダウン。
 * base-ui:Button は render、DropdownMenuItem は onClick で扱う(プロジェクト規約)。
 */
function RoleDropdown({
  member,
  isPending,
  onChange,
}: {
  member: OrganizationMemberListItem;
  isPending: boolean;
  onChange: (newRole: OrganizationRole) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={isPending}>
            {roleLabel[member.role]}
            <ChevronDownIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChange("admin")} disabled={member.role === "admin"}>
          管理者
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange("advisor")} disabled={member.role === "advisor"}>
          アドバイザー
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
