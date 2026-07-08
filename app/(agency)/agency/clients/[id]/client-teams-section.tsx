"use client";

import { Check, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OrganizationTeam } from "@/lib/teams/types";

/**
 * 顧客 詳細 の 「所属 team」 セクション。
 * 現在 の 所属 を チップ 表示 + 追加 / 削除 の チェックボックス。
 * 保存 は PATCH /api/agency/clients/[id]/teams で 差分 更新。
 */
type Props = {
  clientRecordId: string;
  /** 現在 の 割 当 team_ids (SSR で 渡す) */
  initialTeamIds: string[];
  /** 組織 内 の 全 team (選択 候補) */
  organizationTeams: OrganizationTeam[];
};

export function ClientTeamsSection({ clientRecordId, initialTeamIds, organizationTeams }: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialTeamIds));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const teamMap = useMemo(
    () => new Map(organizationTeams.map((t) => [t.id, t])),
    [organizationTeams],
  );

  const toggle = (teamId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const save = () => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/agency/clients/${clientRecordId}/teams`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamIds: [...selectedIds] }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(j.message ?? "保存 に 失敗 しました");
        }
        setIsEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const cancel = () => {
    setSelectedIds(new Set(initialTeamIds));
    setError(null);
    setIsEditing(false);
  };

  const currentTeams = [...selectedIds]
    .map((id) => teamMap.get(id))
    .filter((t): t is OrganizationTeam => Boolean(t));

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="text-muted-foreground h-4 w-4" />
          <h3 className="text-sm font-medium">所属 team</h3>
        </div>
        {!isEditing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setIsEditing(true)}
          >
            編集
          </Button>
        )}
      </div>

      {organizationTeams.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          組織 に team が 未 作成 です。 team を 作る と 顧客 リスト を 分離 でき ます。
        </p>
      ) : isEditing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {organizationTeams.map((team) => {
              const active = selectedIds.has(team.id);
              return (
                <label
                  key={team.id}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm ${
                    active
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                      : "hover:bg-slate-50 dark:hover:bg-slate-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(team.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className="h-3 w-3 rounded-full border"
                    style={{ backgroundColor: team.color ?? "#94a3b8" }}
                  />
                  <span className="truncate">{team.name}</span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={save}>
              <Check className="mr-1 h-3.5 w-3.5" />
              保存
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={cancel}>
              <X className="mr-1 h-3.5 w-3.5" />
              キャンセル
            </Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : currentTeams.length === 0 ? (
        <p className="text-muted-foreground text-xs">未 割 当 (全 org member に 可視 の 状態)。</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {currentTeams.map((team) => (
            <span
              key={team.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                borderColor: team.color ?? "#cbd5e1",
                backgroundColor: (team.color ?? "#f1f5f9") + "20",
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: team.color ?? "#94a3b8" }}
              />
              {team.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
