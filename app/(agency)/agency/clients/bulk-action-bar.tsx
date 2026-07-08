"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientStatusLabels, type ClientStatus } from "@/lib/clients/types";

type OrgMember = { memberId: string; displayName: string | null };
type TeamSummary = { id: string; name: string; color: string | null };

type BulkActionBarProps = {
  /** 選択中のクライアント ID 群 */
  selectedIds: string[];
  members: OrgMember[];
  /** 組織のリスト表(旧: team)。空配列なら リスト表 系ボタンを非表示 */
  teams?: TeamSummary[];
  /** 操作完了後に選択を解除する callback(親で setSelectedIds([])) */
  onClear: () => void;
};

type ActionMode =
  | "idle"
  | "status"
  | "assignee"
  | "add_tags"
  | "remove_tags"
  | "add_teams"
  | "remove_teams"
  | "email";

/**
 * 一括操作バー(画面下部に常駐 sticky)。
 *
 * 選択数 + 4 種のアクション(ステータス変更 / 担当変更 / タグ追加 / タグ削除)。
 * 削除アクションは含めない(誤操作で大量削除されるリスクが高い + RLS 上 admin
 * 専用なので、管理画面で 1 件ずつ行う運用)。
 *
 * 監査ログは API ルートで自動記録される(変更があった行のみ)。
 * 成功後 router.refresh() で一覧の値を更新する。
 */
export function BulkActionBar({ selectedIds, members, teams = [], onClear }: BulkActionBarProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ActionMode>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 各アクション用のフォーム値
  const [pendingStatus, setPendingStatus] = useState<ClientStatus>("initial_meeting");
  const [pendingAssignee, setPendingAssignee] = useState<string>("");
  const [pendingTags, setPendingTags] = useState<string>("");
  const [pendingTeamIds, setPendingTeamIds] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState<string>("");
  const [emailBody, setEmailBody] = useState<string>("");
  const [emailSummary, setEmailSummary] = useState<{
    sent: number;
    suppressed: number;
    failed: number;
  } | null>(null);

  if (selectedIds.length === 0) return null;

  const submit = async (body: unknown) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/clients/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      setMode("idle");
      onClear();
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setError(`一括操作に失敗: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitStatus = () =>
    submit({ action: "set_status", ids: selectedIds, status: pendingStatus });

  const submitAssignee = () =>
    submit({
      action: "set_assignee",
      ids: selectedIds,
      assignedMemberId: pendingAssignee === "" ? null : pendingAssignee,
    });

  const submitTags = (action: "add_tags" | "remove_tags") => {
    const tags = pendingTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (tags.length === 0) {
      setError("タグを1つ以上入力してください");
      return;
    }
    submit({ action, ids: selectedIds, tags });
  };

  const submitTeams = (action: "add_teams" | "remove_teams") => {
    const teamIds = [...pendingTeamIds];
    if (teamIds.length === 0) {
      setError("リスト表を1つ以上選択してください");
      return;
    }
    submit({ action, ids: selectedIds, teamIds });
  };

  const toggleTeamSelection = (teamId: string) => {
    setPendingTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const submitEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) {
      setError("件名と本文の両方を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setEmailSummary(null);
    try {
      const res = await fetch("/api/agency/clients/bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          subject: emailSubject,
          body: emailBody,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        suppressed?: number;
        failed?: number;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setEmailSummary({
        sent: json.sent ?? 0,
        suppressed: json.suppressed ?? 0,
        failed: json.failed ?? 0,
      });
      router.refresh();
      // 送信成功時は内容をクリアしないでおく(再送する場合があるため)
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setError(`一括送信失敗: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-background sticky bottom-4 z-30 mx-auto max-w-5xl">
      <div className="ring-foreground/15 bg-background space-y-2 rounded-xl p-3 shadow-lg ring-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            <span className="tabular-nums">{selectedIds.length}</span> 件選択中
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode(mode === "status" ? "idle" : "status")}
          >
            ステータス変更
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode(mode === "assignee" ? "idle" : "assignee")}
          >
            担当変更
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode(mode === "add_tags" ? "idle" : "add_tags")}
          >
            タグ追加
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode(mode === "remove_tags" ? "idle" : "remove_tags")}
          >
            タグ削除
          </Button>
          {teams.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode(mode === "add_teams" ? "idle" : "add_teams")}
              >
                リスト表に追加
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode(mode === "remove_teams" ? "idle" : "remove_teams")}
              >
                リスト表から外す
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMode(mode === "email" ? "idle" : "email");
              setEmailSummary(null);
            }}
          >
            メール送信
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClear}>
            選択解除
          </Button>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {mode === "status" && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pendingStatus}
              onChange={(e) => setPendingStatus(e.target.value as ClientStatus)}
              className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
            >
              {Object.entries(clientStatusLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={submitStatus} disabled={submitting}>
              {submitting ? "適用中…" : `${selectedIds.length} 件に適用`}
            </Button>
          </div>
        )}

        {mode === "assignee" && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pendingAssignee}
              onChange={(e) => setPendingAssignee(e.target.value)}
              className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
            >
              <option value="">担当解除(未割当に戻す)</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.displayName ?? "(表示名未設定)"}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={submitAssignee} disabled={submitting}>
              {submitting ? "適用中…" : `${selectedIds.length} 件に適用`}
            </Button>
          </div>
        )}

        {(mode === "add_tags" || mode === "remove_tags") && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="タグをカンマ区切り(例:VIP, 要フォロー)"
              value={pendingTags}
              onChange={(e) => setPendingTags(e.target.value)}
              className="max-w-sm"
            />
            <Button size="sm" onClick={() => submitTags(mode)} disabled={submitting}>
              {submitting
                ? "適用中…"
                : mode === "add_tags"
                  ? `${selectedIds.length} 件に追加`
                  : `${selectedIds.length} 件から削除`}
            </Button>
          </div>
        )}

        {(mode === "add_teams" || mode === "remove_teams") && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {teams.map((team) => {
                const active = pendingTeamIds.has(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => toggleTeamSelection(team.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      active
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                        : "hover:bg-accent border-input"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: team.color ?? "#94a3b8" }}
                    />
                    {team.name}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => submitTeams(mode)} disabled={submitting}>
                {submitting
                  ? "適用中…"
                  : mode === "add_teams"
                    ? `${selectedIds.length}件の顧客をリスト表に追加`
                    : `${selectedIds.length}件の顧客をリスト表から外す`}
              </Button>
              <p className="text-muted-foreground text-xs">
                権限のない行(自分が担当・リーダーではない顧客)はスキップされます。
              </p>
            </div>
          </div>
        )}

        {mode === "email" && (
          <div className="space-y-2">
            <Input
              placeholder="件名(例:キャリア相談のご案内)"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              maxLength={200}
            />
            <textarea
              placeholder="本文({client_name} で氏名を差し替え可能)"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              maxLength={5000}
              rows={4}
              className="border-input bg-background w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={submitEmail} disabled={submitting}>
                {submitting ? "送信中…" : `${selectedIds.length} 件に送信`}
              </Button>
              <p className="text-muted-foreground text-xs">
                配信停止の顧客は自動でスキップされます。送信成功時は対応履歴に記録されます。
              </p>
            </div>
            {emailSummary && (
              <div className="text-xs">
                送信成功: <span className="font-medium">{emailSummary.sent}</span> 件 /
                配信停止スキップ: <span className="font-medium">{emailSummary.suppressed}</span> 件
                / 失敗:{" "}
                <span className="font-medium text-red-600 dark:text-red-300">
                  {emailSummary.failed}
                </span>{" "}
                件
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
