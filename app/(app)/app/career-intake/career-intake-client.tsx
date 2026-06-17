"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { preflightAudioFile, type PreflightIssue } from "@/lib/career-intake/preflight";
import type { IntakeRecording, IntakeStatus } from "@/lib/career-intake/types";

const STATUS_LABEL: Record<IntakeStatus, { label: string; tone: string }> = {
  uploaded: { label: "アップロード済", tone: "bg-muted text-muted-foreground" },
  transcribing: { label: "文字起こし中…", tone: "bg-blue-100 text-blue-700" },
  transcribed: { label: "文字起こし完了", tone: "bg-blue-100 text-blue-700" },
  failed_transcribe: { label: "文字起こし失敗", tone: "bg-red-100 text-red-700" },
  extracting: { label: "抽出中…", tone: "bg-purple-100 text-purple-700" },
  extracted: { label: "完了", tone: "bg-emerald-100 text-emerald-700" },
  failed_extract: { label: "抽出失敗", tone: "bg-red-100 text-red-700" },
};

type Props = {
  initialRecordings: IntakeRecording[];
};

export function CareerIntakeClient({ initialRecordings }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recordings, setRecordings] = useState<IntakeRecording[]>(initialRecordings);
  const [uploading, setUploading] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [warnings, setWarnings] = useState<PreflightIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 反映処理中のレコード id と種別(resume / cv)
  const [applying, setApplying] = useState<{ id: string; kind: "resume" | "cv" } | null>(null);
  const [appliedResumeId, setAppliedResumeId] = useState<string | null>(null);
  const [appliedCvId, setAppliedCvId] = useState<string | null>(null);
  // 複数選択(削除)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 処理中(transcribing / extracting / uploaded)の録音があれば 5 秒ごとに refresh。
  // 同期処理の最中はクライアントが上書きしないので、別タブで開いたケースや
  // request timeout のリカバリーに役立つ。
  useEffect(() => {
    const inProgress = recordings.some((r) =>
      ["uploaded", "transcribing", "extracting"].includes(r.status),
    );
    if (!inProgress) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [recordings, router]);

  const upload = async (file: File) => {
    setError(null);
    setWarnings([]);
    setPreflighting(true);
    const pre = await preflightAudioFile(file);
    setPreflighting(false);
    if (!pre.ok) {
      // blocking なエラーのみ表示。複数あれば最初の 1 つ
      const blocking = pre.issues.find((i) => i.level === "blocking");
      setError(blocking?.message ?? "アップロード前チェックで問題が見つかりました");
      return;
    }
    // warning のみは続行可能(表示はする)
    const warns = pre.issues.filter((i) => i.level === "warning");
    if (warns.length > 0) setWarnings(warns);

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("filename", file.name);
      const res = await fetch("/api/career-intake/recordings", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
      }
      // 完了/失敗どちらでも一覧更新
      router.refresh();
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("この録音を削除しますか?履歴書には影響しません。")) return;
    setError(null);
    try {
      await apiFetch(`/api/career-intake/recordings/${id}`, { method: "DELETE" });
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size} 件の録音を削除しますか?履歴書には影響しません。`)) return;
    setBulkDeleting(true);
    setError(null);
    try {
      await apiFetch("/api/career-intake/recordings/bulk-delete", {
        method: "POST",
        json: { ids: Array.from(selectedIds) },
      });
      setRecordings((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBulkDeleting(false);
    }
  };

  const applyToResume = async (rec: IntakeRecording) => {
    setApplying({ id: rec.id, kind: "resume" });
    setError(null);
    try {
      const res = await apiFetch<{ resumeId: string }>(
        `/api/career-intake/recordings/${rec.id}/apply`,
        { method: "POST", json: { targetTitle: `AIヒアリング:${rec.originalFilename}` } },
      );
      if (res?.resumeId) setAppliedResumeId(res.resumeId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(null);
    }
  };

  const applyToCv = async (rec: IntakeRecording) => {
    setApplying({ id: rec.id, kind: "cv" });
    setError(null);
    try {
      const res = await apiFetch<{ cvId: string }>(
        `/api/career-intake/recordings/${rec.id}/apply-cv`,
        { method: "POST", json: { targetTitle: `AIヒアリング:${rec.originalFilename}` } },
      );
      if (res?.cvId) setAppliedCvId(res.cvId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* アップロード */}
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">音声/動画をアップロード</h2>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          className="block w-full text-sm"
        />
        <p className="text-muted-foreground text-xs">
          最大 25 MiB、mp3 / wav / m4a / webm / mp4 / mov 等。
          短すぎる音声は精度が落ちる場合があります(目安:60 秒以上)。
        </p>
        {preflighting && <p className="text-muted-foreground text-xs">ファイルチェック中…</p>}
        {uploading && (
          <p className="text-xs text-blue-600 dark:text-blue-300">
            アップロード + 文字起こし + 抽出 中…(目安 30〜90 秒)
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
            {warnings.map((w, i) => (
              <li key={i}>⚠ {w.message}</li>
            ))}
          </ul>
        )}
        {error && <p className="text-destructive text-xs">{error}</p>}
        {appliedResumeId && (
          <p className="text-xs text-emerald-600 dark:text-emerald-300">
            履歴書を新規作成しました。
            <Link
              href={`/app/resumes/${appliedResumeId}`}
              className="ml-1 underline-offset-4 hover:underline"
            >
              履歴書を開く
            </Link>
          </p>
        )}
        {appliedCvId && (
          <p className="text-xs text-emerald-600 dark:text-emerald-300">
            職務経歴書を新規作成しました。
            <Link
              href={`/app/cvs/${appliedCvId}`}
              className="ml-1 underline-offset-4 hover:underline"
            >
              職務経歴書を開く
            </Link>
          </p>
        )}
      </Card>

      {/* 履歴 */}
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">アップロード履歴</h2>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{recordings.length} 件</span>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void bulkDelete()}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? "削除中…" : `${selectedIds.size} 件を削除`}
              </Button>
            )}
          </div>
        </div>

        {recordings.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            まだアップロードがありません
          </p>
        ) : (
          <ul className="divide-foreground/10 divide-y">
            {recordings.map((r) => {
              const st = STATUS_LABEL[r.status];
              return (
                <li key={r.id} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`${r.originalFilename} を選択`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/career-intake/${r.id}`} className="hover:underline">
                        <p className="truncate font-medium">{r.originalFilename}</p>
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {new Date(r.createdAt).toLocaleString("ja-JP")} ・{" "}
                        {(r.sizeBytes / 1024 / 1024).toFixed(1)} MiB
                      </p>
                    </div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${st.tone}`}
                    >
                      {st.label}
                    </span>
                  </div>
                  {r.statusMessage && r.status.startsWith("failed_") && (
                    <p className="text-xs text-red-600 dark:text-red-300">
                      エラー:{r.statusMessage}
                    </p>
                  )}
                  {r.status === "extracted" && r.extraction && (
                    <details className="rounded-md border p-2 text-xs">
                      <summary className="cursor-pointer font-medium">抽出プレビュー</summary>
                      <div className="text-muted-foreground mt-2 space-y-1 whitespace-pre-wrap">
                        {r.extraction.careerSummary && (
                          <p>
                            <span className="font-medium">職務サマリ:</span>{" "}
                            {r.extraction.careerSummary}
                          </p>
                        )}
                        {r.extraction.skillsSummary && (
                          <p>
                            <span className="font-medium">スキル:</span>{" "}
                            {r.extraction.skillsSummary}
                          </p>
                        )}
                        {r.extraction.educationHistory.length > 0 && (
                          <p>
                            <span className="font-medium">学歴:</span>{" "}
                            {r.extraction.educationHistory.length} 件抽出
                          </p>
                        )}
                        {r.extraction.workHistory.length > 0 && (
                          <p>
                            <span className="font-medium">職歴:</span>{" "}
                            {r.extraction.workHistory.length} 件抽出
                          </p>
                        )}
                        {r.extraction.licenses.length > 0 && (
                          <p>
                            <span className="font-medium">資格:</span>{" "}
                            {r.extraction.licenses.length} 件抽出
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {r.status === "extracted" && r.extraction && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void applyToResume(r)}
                          disabled={applying?.id === r.id}
                        >
                          {applying?.id === r.id && applying.kind === "resume"
                            ? "作成中…"
                            : "履歴書に反映"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void applyToCv(r)}
                          disabled={applying?.id === r.id}
                        >
                          {applying?.id === r.id && applying.kind === "cv"
                            ? "作成中…"
                            : "職務経歴書に反映"}
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                      削除
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
