"use client";

import { Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { OrganizationTeamMember, OrganizationTeamWithCounts } from "@/lib/teams/types";

/**
 * team 管理 の クライアント コンポーネント。
 *   - team 作成 / 削除 / 名前 変更
 *   - team に member を 追加 / 削除
 * すべて API 経由 (RPC バリデーション 付き)。 更新 は router.refresh() で SSR 再取得。
 */
type MemberSummary = {
  id: string;
  displayName: string;
  role: "admin" | "advisor";
};

type Props = {
  initialTeams: OrganizationTeamWithCounts[];
  allMembers: MemberSummary[];
  teamMemberships: Array<{ teamId: string; members: OrganizationTeamMember[] }>;
};

export function TeamsAdminClient({ initialTeams, allMembers, teamMemberships }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("");

  const memberMap = useMemo(() => new Map(allMembers.map((m) => [m.id, m])), [allMembers]);
  const teamMembersMap = useMemo(
    () => new Map(teamMemberships.map((r) => [r.teamId, r.members])),
    [teamMemberships],
  );

  const submitAction = async (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const createTeam = () =>
    submitAction(async () => {
      if (!newName.trim()) throw new Error("リスト表名を入力してください");
      const res = await fetch("/api/agency/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          color: newColor || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? "作成に失敗しました");
      }
      setNewName("");
      setNewColor("");
    });

  const deleteTeam = (teamId: string, teamName: string) =>
    submitAction(async () => {
      if (
        !window.confirm(
          `「${teamName}」を削除します。割当済の顧客は未割当に戻り、組織メンバー全員から閲覧できるようになります。実行しますか?`,
        )
      ) {
        return;
      }
      const res = await fetch(`/api/agency/teams/${teamId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? "削除に失敗しました");
      }
    });

  const addMember = (teamId: string, memberId: string, role: "member" | "lead") =>
    submitAction(async () => {
      const res = await fetch(`/api/agency/teams/${teamId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, role }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? "追加に失敗しました");
      }
    });

  const removeMember = (teamId: string, memberId: string) =>
    submitAction(async () => {
      const res = await fetch(
        `/api/agency/teams/${teamId}/members?memberId=${encodeURIComponent(memberId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? "削除に失敗しました");
      }
    });

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 新規リスト表作成 */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">新規リスト表作成</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="new-team-name">名前</Label>
            <input
              id="new-team-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例:東京チーム / IT担当"
              maxLength={100}
              disabled={isPending}
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="new-team-color">色</Label>
            <input
              id="new-team-color"
              type="color"
              value={newColor || "#94a3b8"}
              onChange={(e) => setNewColor(e.target.value)}
              disabled={isPending}
              className="mt-1 h-9 w-14 rounded-md border"
            />
          </div>
          <Button type="button" onClick={createTeam} disabled={isPending || !newName.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            作成
          </Button>
        </div>
      </Card>

      {/* 既存リスト表一覧 */}
      {initialTeams.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-muted-foreground text-sm">
            まだリスト表がありません。上のフォームから最初のリスト表を作成してください。
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {initialTeams.map((team) => {
            const members = teamMembersMap.get(team.id) ?? [];
            const memberIdsInTeam = new Set(members.map((m) => m.memberId));
            const candidates = allMembers.filter((m) => !memberIdsInTeam.has(m.id));

            return (
              <Card key={team.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: team.color ?? "#94a3b8" }}
                    />
                    <span className="font-medium">{team.name}</span>
                    <span className="text-muted-foreground text-xs">
                      メンバー {team.memberCount}名 / 顧客 {team.clientCount}件
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    disabled={isPending}
                    onClick={() => deleteTeam(team.id, team.name)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    削除
                  </Button>
                </div>

                {team.description && (
                  <p className="text-muted-foreground text-xs">{team.description}</p>
                )}

                {/* リスト表内のメンバー一覧 */}
                <div className="space-y-1">
                  {members.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      まだメンバーがいません。下の追加リストから選んでください。
                    </p>
                  ) : (
                    members.map((m) => {
                      const info = memberMap.get(m.memberId);
                      return (
                        <div
                          key={m.memberId}
                          className="flex items-center justify-between rounded border px-2 py-1 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span>{info?.displayName ?? "(削除済メンバー)"}</span>
                            <span className="text-muted-foreground text-xs">
                              [{m.role === "lead" ? "リーダー" : "メンバー"}]
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs text-red-600"
                            disabled={isPending}
                            onClick={() => removeMember(team.id, m.memberId)}
                          >
                            <UserMinus className="mr-1 h-3.5 w-3.5" />
                            外す
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* メンバー追加 */}
                {candidates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className="text-muted-foreground text-xs">追加:</span>
                    <select
                      aria-label="追加するメンバー"
                      disabled={isPending}
                      defaultValue=""
                      onChange={(e) => {
                        const memberId = e.target.value;
                        if (!memberId) return;
                        void addMember(team.id, memberId, "member");
                        e.currentTarget.value = "";
                      }}
                      className="border-input bg-background rounded-md border px-2 py-1 text-xs"
                    >
                      <option value="">メンバーを選ぶ…</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName}
                          {c.role === "admin" ? "(組織管理者)" : ""}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground text-xs">
                      <UserPlus className="inline h-3 w-3" /> 役割変更は追加後に一覧から
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
