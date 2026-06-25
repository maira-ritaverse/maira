"use client";

/**
 * クライアント 詳細 ページ で 「副 担当 (共同 担当)」 を 操作 する セクション。
 *
 * - 主 担当 は client_records.assigned_member_id (= 既存 UI で 表示) なので 触らない
 * - ここ で 扱う の は client_record_collaborators テーブル の 行 のみ
 * - 同 組織 advisor の 中 から ドロップダウン で 追加、 アバター 横 の × で 削除
 *
 * 権限:
 *   - admin / 主 担当 / 副 担当 本人 が 操作 可能 ( サーバー 側 でも 検証 )
 *   - 上記 に 該当 し ない メンバー には ボタン を 出さ ない
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Member = { memberId: string; displayName: string | null };

type CollaboratorRow = {
  memberId: string;
  displayName: string | null;
};

type Props = {
  clientRecordId: string;
  primaryAssigneeMemberId: string | null;
  collaborators: CollaboratorRow[];
  members: Member[];
  /** 現在 ログイン 中 の メンバー の ID */
  viewerMemberId: string;
  /** 現在 ログイン 中 の メンバー の ロール */
  viewerRole: "admin" | "advisor";
};

export function CollaboratorsSection({
  clientRecordId,
  primaryAssigneeMemberId,
  collaborators,
  members,
  viewerMemberId,
  viewerRole,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const canManageAll = viewerRole === "admin" || viewerMemberId === primaryAssigneeMemberId;

  // 追加 候補 = 主 担当 でも 副 担当 でも ない 同 組織 advisor
  const collaboratorIds = new Set(collaborators.map((c) => c.memberId));
  const candidates = members.filter(
    (m) => m.memberId !== primaryAssigneeMemberId && !collaboratorIds.has(m.memberId),
  );

  const addCollaborator = async () => {
    if (!selectedMemberId) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agency/clients/${clientRecordId}/collaborators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId: selectedMemberId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(messageForError(body?.error));
          return;
        }
        setSelectedMemberId("");
        router.refresh();
      } catch {
        setError("追加に失敗しました");
      }
    });
  };

  const removeCollaborator = async (memberId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agency/clients/${clientRecordId}/collaborators/${memberId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(messageForError(body?.error));
          return;
        }
        router.refresh();
      } catch {
        setError("削除に失敗しました");
      }
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">副担当(共同担当)</h3>
        <span className="text-muted-foreground text-xs">{collaborators.length} 名</span>
      </div>

      {collaborators.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          副担当は登録されていません。主担当以外のアドバイザーも閲覧・編集はできますが、ここに登録すると「明示的に関わっている」として通知や視認の対象になります。
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {collaborators.map((c) => {
            const canRemove = canManageAll || c.memberId === viewerMemberId;
            return (
              <li
                key={c.memberId}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs"
              >
                <span className="font-medium">{c.displayName ?? "(名前未設定)"}</span>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => removeCollaborator(c.memberId)}
                    disabled={isPending}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-50"
                    aria-label={`${c.displayName ?? "メンバー"}を副担当から外す`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(canManageAll || candidates.some((m) => m.memberId === viewerMemberId)) &&
        candidates.length > 0 && (
          <div className="flex items-center gap-2 pt-2">
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              disabled={isPending}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">追加するアドバイザーを選択</option>
              {(canManageAll
                ? candidates
                : candidates.filter((m) => m.memberId === viewerMemberId)
              ).map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.displayName ?? "(名前未設定)"}
                  {m.memberId === viewerMemberId ? " (自分)" : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={!selectedMemberId || isPending}
              onClick={addCollaborator}
            >
              <UserPlus className="size-3.5" />
              追加
            </Button>
          </div>
        )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function messageForError(code: string | undefined): string {
  switch (code) {
    case "already_collaborator":
      return "既に副担当として登録されています";
    case "already_primary_assignee":
      return "主担当のメンバーは副担当にできません";
    case "member_not_in_org":
      return "対象メンバーは同じ組織に属していません";
    case "forbidden":
      return "この操作の権限がありません";
    case "not_found":
      return "対象の求職者が見つかりません";
    default:
      return "操作に失敗しました";
  }
}
