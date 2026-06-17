"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNow } from "@/lib/agency-tasks/use-now";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { IntakeRecording } from "@/lib/career-intake/types";

type ShareRow = {
  id: string;
  token: string;
  label: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

type Props = {
  recording: IntakeRecording;
};

/**
 * 録音詳細ページのアクション群(リトライ / 反映 / 削除)。
 *
 * 「履歴書 / 職務経歴書に反映」は extracted のときだけ表示。
 * 「リトライ」は failed_* のときだけ表示。
 */
export function RecordingDetailActions({ recording }: Props) {
  const router = useRouter();
  const [applying, setApplying] = useState<"resume" | "cv" | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedLink, setAppliedLink] = useState<{ kind: "resume" | "cv"; id: string } | null>(
    null,
  );
  // 共有リンク
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  const [shareExpiresDays, setShareExpiresDays] = useState(7);
  // useNow を使うことで react-hooks/purity を回避(SSR 0 → マウント後 Date)
  const now = useNow();
  const nowMs = now ? now.getTime() : 0;

  // マウント時に既存共有リンクをロード
  useEffect(() => {
    if (recording.status !== "extracted") return;
    let cancelled = false;
    const load = async () => {
      try {
        const json = await apiFetch<{ shares: ShareRow[] }>(
          `/api/career-intake/recordings/${recording.id}/share`,
        );
        if (cancelled) return;
        setShares(json?.shares ?? []);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [recording.id, recording.status]);

  const createShare = async () => {
    setShareSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{
        id: string;
        token: string;
        expiresAt: string;
        label: string | null;
        url: string;
      }>(`/api/career-intake/recordings/${recording.id}/share`, {
        method: "POST",
        json: {
          label: shareLabel || undefined,
          expiresInDays: shareExpiresDays,
        },
      });
      if (res) {
        setShares((prev) => [
          {
            id: res.id,
            token: res.token,
            label: res.label,
            expires_at: res.expiresAt,
            revoked_at: null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        setShareLabel("");
        // クリップボードに URL をコピー
        try {
          await navigator.clipboard.writeText(res.url);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setShareSubmitting(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    if (!confirm("この共有リンクを失効しますか?この操作は取り消せません。")) return;
    setError(null);
    try {
      await apiFetch(`/api/career-intake/shares/${shareId}`, { method: "DELETE" });
      setShares((prev) =>
        prev.map((s) => (s.id === shareId ? { ...s, revoked_at: new Date().toISOString() } : s)),
      );
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const applyToResume = async () => {
    setApplying("resume");
    setError(null);
    try {
      const res = await apiFetch<{ resumeId: string }>(
        `/api/career-intake/recordings/${recording.id}/apply`,
        { method: "POST", json: { targetTitle: `AIヒアリング:${recording.originalFilename}` } },
      );
      if (res?.resumeId) setAppliedLink({ kind: "resume", id: res.resumeId });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(null);
    }
  };

  const applyToCv = async () => {
    setApplying("cv");
    setError(null);
    try {
      const res = await apiFetch<{ cvId: string }>(
        `/api/career-intake/recordings/${recording.id}/apply-cv`,
        { method: "POST", json: { targetTitle: `AIヒアリング:${recording.originalFilename}` } },
      );
      if (res?.cvId) setAppliedLink({ kind: "cv", id: res.cvId });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(null);
    }
  };

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await apiFetch(`/api/career-intake/recordings/${recording.id}/retry`, {
        method: "POST",
      });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  const remove = async () => {
    if (!confirm("この録音を削除しますか?履歴書 / 職務経歴書には影響しません。")) return;
    setRemoving(true);
    setError(null);
    try {
      await apiFetch(`/api/career-intake/recordings/${recording.id}`, { method: "DELETE" });
      router.push("/app/career-intake");
    } catch (err) {
      setError(getErrorMessage(err));
      setRemoving(false);
    }
  };

  return (
    <Card className="space-y-2 p-3">
      <div className="flex flex-wrap gap-2">
        {recording.status === "extracted" && recording.extraction && (
          <>
            <Button onClick={() => void applyToResume()} disabled={applying !== null}>
              {applying === "resume" ? "作成中…" : "履歴書に反映"}
            </Button>
            <Button onClick={() => void applyToCv()} variant="outline" disabled={applying !== null}>
              {applying === "cv" ? "作成中…" : "職務経歴書に反映"}
            </Button>
          </>
        )}
        {(recording.status === "failed_transcribe" || recording.status === "failed_extract") && (
          <Button onClick={() => void retry()} disabled={retrying} variant="outline">
            {retrying ? "再処理中…" : "再処理"}
          </Button>
        )}
        <Button onClick={() => void remove()} variant="ghost" disabled={removing}>
          削除
        </Button>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
      {appliedLink && (
        <p className="text-xs text-emerald-600 dark:text-emerald-300">
          {appliedLink.kind === "resume" ? "履歴書" : "職務経歴書"}を新規作成しました。
          <Link
            href={`/app/${appliedLink.kind === "resume" ? "resumes" : "cvs"}/${appliedLink.id}`}
            className="ml-1 underline-offset-4 hover:underline"
          >
            開く
          </Link>
        </p>
      )}

      {/* 共有リンク管理(extracted のときのみ) */}
      {recording.status === "extracted" && (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">エージェント共有リンク</h3>
          <p className="text-muted-foreground text-xs">
            URL を持っている人なら誰でも抽出結果を閲覧できます。氏名カナ / 生年月日は伏せられます。
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="text"
              placeholder="ラベル(例:○○社向け)"
              value={shareLabel}
              onChange={(e) => setShareLabel(e.target.value)}
              className="border-input bg-background w-48 rounded-md border px-2 py-1"
              maxLength={100}
            />
            <select
              value={shareExpiresDays}
              onChange={(e) => setShareExpiresDays(Number(e.target.value))}
              className="border-input bg-background rounded-md border px-2 py-1"
            >
              <option value={1}>1 日</option>
              <option value={7}>7 日</option>
              <option value={14}>14 日</option>
              <option value={30}>30 日</option>
            </select>
            <Button size="sm" onClick={() => void createShare()} disabled={shareSubmitting}>
              {shareSubmitting ? "発行中…" : "リンクを発行(コピー)"}
            </Button>
          </div>

          {shares.length > 0 && (
            <ul className="space-y-1 text-xs">
              {shares.map((s) => {
                const revoked = !!s.revoked_at;
                const expired = !revoked && nowMs > 0 && new Date(s.expires_at).getTime() < nowMs;
                const url = `/share/intake/${s.token}`;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      {s.label && <div className="font-medium">{s.label}</div>}
                      <code className="text-muted-foreground truncate text-[10px]">{url}</code>
                      <div className="text-muted-foreground text-[10px]">
                        有効期限:{new Date(s.expires_at).toLocaleString("ja-JP")}
                        {revoked && "(失効済)"}
                        {!revoked && expired && "(期限切れ)"}
                      </div>
                    </div>
                    {!revoked && !expired && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void navigator.clipboard.writeText(`${window.location.origin}${url}`);
                          }}
                        >
                          URL コピー
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void revokeShare(s.id)}>
                          失効
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}
