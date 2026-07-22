"use client";

/**
 * AI ヒアリングアップロード(クライアント側)
 *
 * - ファイル選択 / ドラッグ&ドロップでアップロード
 * - 進行中はプログレス表示(簡易、boolean)
 * - 結果テーブルで処理状態を表示
 * - 60 秒ごとに refresh して状態を更新
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { createClient } from "@/lib/supabase/client";

import type { AgencyIntakeRow } from "./intake-upload-section";

// バケット file_size_limit / Whisper 単一上限と一致(25 MiB)。事前にクライアントで弾く。
const MAX_BYTES = 25 * 1024 * 1024;
const INTAKE_BUCKET = "career-intake-audio";

type Props = {
  clientRecordId: string;
  rows: AgencyIntakeRow[];
};

const STATUS_LABEL: Record<string, string> = {
  external_pending: "外部取込待ち",
  uploaded: "処理待ち",
  transcribing: "文字起こし中…",
  transcribed: "文字起こし完了",
  extracting: "構造化抽出中…",
  extracted: "完了",
  failed_transcribe: "文字起こし失敗",
  failed_extract: "抽出失敗",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function IntakeUploadClient({ clientRecordId, rows }: Props) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 処理待ち or 処理中の行があれば 30 秒ごとに refresh
  const hasInProgress = rows.some((r) =>
    ["uploaded", "transcribing", "transcribed", "extracting", "external_pending"].includes(
      r.status,
    ),
  );
  useEffect(() => {
    if (!hasInProgress) return;
    const id = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [hasInProgress, router]);

  // アップロードは「(1)sign で事前チェック + 署名発行 → (2)ブラウザから Storage へ直送
  // → (3)finalize で行作成」の 3 段。ファイル本体をアプリのルートに通さないことで
  // Vercel の Serverless ボディ制限(約 4.5MB)を回避し、25MiB までの会議音声を扱える。
  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(`ファイルが大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)`);
      setUploading(false);
      return;
    }
    try {
      // (1) 事前チェック + 署名付きアップロード URL を取得
      setProgress(`アップロード準備中: ${file.name}`);
      const signRes = await fetch(`/api/agency/clients/${clientRecordId}/intake-recording/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type ?? "",
        }),
      });
      const signJson = (await signRes.json().catch(() => ({}))) as {
        recordingId?: string;
        storagePath?: string;
        token?: string;
        error?: string;
        message?: string;
      };
      if (!signRes.ok || !signJson.token || !signJson.storagePath || !signJson.recordingId) {
        throw new Error(signJson.message ?? signJson.error ?? `HTTP ${signRes.status}`);
      }

      // (2) ブラウザ → Supabase Storage へ直接アップロード(Vercel を経由しない)
      setProgress(`アップロード中: ${file.name}`);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(INTAKE_BUCKET)
        .uploadToSignedUrl(signJson.storagePath, signJson.token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) throw new Error(upErr.message);

      // (3) メタデータ登録(行作成 → cron が Whisper + Claude を回す)
      setProgress("登録中…");
      const finRes = await fetch(`/api/agency/clients/${clientRecordId}/intake-recording`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: signJson.recordingId,
          storagePath: signJson.storagePath,
          filename: file.name,
          sizeBytes: file.size,
        }),
      });
      const finJson = (await finRes.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!finRes.ok) {
        throw new Error(finJson.message ?? finJson.error ?? `HTTP ${finRes.status}`);
      }

      setProgress("受付完了 — 処理待ちに追加されました");
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setProgress(null);
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    void upload(file);
  };

  return (
    <div className="space-y-3">
      {/* ドロップゾーン */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-foreground/40 hover:bg-accent/40"
        }`}
      >
        <Upload className="text-muted-foreground size-5" aria-hidden />
        <span className="font-medium">
          {uploading ? "アップロード中…" : "音声/動画ファイルをここにドロップ"}
        </span>
        <span className="text-muted-foreground text-xs">
          またはクリックしてファイルを選択(最大 25MiB)
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {progress && <div className="bg-muted/40 rounded-md border p-2 text-xs">{progress}</div>}
      {error && (
        <div className="text-destructive border-destructive/40 bg-destructive/10 rounded border p-2 text-xs">
          {error}
        </div>
      )}

      {/* 履歴 */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-semibold">アップロード履歴</h3>
          <ul className="divide-border divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.originalFilename}</div>
                    <div className="text-muted-foreground mt-0.5">{fmt(r.createdAt)}</div>
                    {r.statusMessage && (
                      <div className="text-destructive mt-1 text-[11px]">{r.statusMessage}</div>
                    )}
                  </div>
                  <StatusBadge status={r.status} />
                  {hasInProgress && (
                    <Button size="sm" variant="ghost" onClick={() => router.refresh()} title="更新">
                      更新
                    </Button>
                  )}
                </div>
                {r.status === "extracted" && (
                  <ExtractedActions
                    recordingId={r.id}
                    clientRecordId={clientRecordId}
                    onDone={() => router.refresh()}
                  />
                )}
                {r.hasTranscript && (
                  <TranscriptDiagnostic recordingId={r.id} clientRecordId={clientRecordId} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * 抽出完了済の録音に対する「取り込み」アクション群。
 *
 * 履歴書 / 職務経歴書 / ヒアリングシート、それぞれに対して
 *   ・新規作成
 *   ・(将来)既存にマージ
 * を選べる導線。今は新規作成のみ。生成後は対応する編集ページへ遷移する。
 */
function ExtractedActions({
  recordingId,
  clientRecordId,
  onDone,
}: {
  recordingId: string;
  clientRecordId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (endpoint: string, redirectPath: (id: string) => string, successLabel: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: { id: string } }>(endpoint, {
          method: "POST",
          json: {
            recording_id: recordingId,
            client_record_id: clientRecordId,
          },
        });
        if (!res?.item) throw new Error(`${successLabel} の生成に失敗しました`);
        router.push(redirectPath(res.item.id));
        onDone();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          run(
            "/api/agency/client-resumes/from-recording",
            (id) => `/agency/clients/${clientRecordId}/agency-resumes/${id}`,
            "履歴書",
          )
        }
        disabled={pending}
      >
        {pending ? "生成中…" : "履歴書として取り込み"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          run(
            "/api/agency/client-cvs/from-recording",
            (id) => `/agency/clients/${clientRecordId}/agency-cvs/${id}`,
            "職務経歴書",
          )
        }
        disabled={pending}
      >
        {pending ? "生成中…" : "職務経歴書として取り込み"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          run(
            "/api/agency/hearing-sheets/from-recording",
            () => `/agency/clients/${clientRecordId}?tab=meetings`,
            "ヒアリングシート",
          )
        }
        disabled={pending}
      >
        {pending ? "反映中…" : "ヒアリングシートに反映"}
      </Button>
      {error && <span className="text-destructive text-[11px]">{error}</span>}
    </div>
  );
}

/**
 * 「録音したのに書類がスカスカ」の切り分けビュー。
 * Whisper の文字起こし本文と、AI 抽出で何がどれだけ取れたか(職歴/学歴/資格の件数、
 * 自己PRの有無 等)を表示する。文字起こしが空 → 音声/形式の問題、文字起こしはあるが
 * 抽出が 0 件だらけ → 抽出の問題、と一目で分かる。
 */
function TranscriptDiagnostic({
  recordingId,
  clientRecordId,
}: {
  recordingId: string;
  clientRecordId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    transcript: string;
    transcriptLength: number;
    extractionSummary: Record<string, number | boolean> | null;
  } | null>(null);

  const toggle = async () => {
    if (data) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/clients/${clientRecordId}/intake-recording/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        transcript?: string;
        transcriptLength?: number;
        extractionSummary?: Record<string, number | boolean> | null;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      setData({
        transcript: json.transcript ?? "",
        transcriptLength: json.transcriptLength ?? 0,
        extractionSummary: json.extractionSummary ?? null,
      });
      setOpen(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const s = data?.extractionSummary;
  return (
    <div className="pt-1">
      <Button size="sm" variant="ghost" onClick={toggle} disabled={loading}>
        {loading ? "読み込み中…" : open ? "文字起こしを隠す" : "文字起こし・抽出を確認"}
      </Button>
      {error && <p className="text-destructive text-[11px]">{error}</p>}
      {open && data && (
        <div className="mt-2 space-y-2">
          <div className="text-muted-foreground text-[11px]">
            文字起こし {data.transcriptLength} 文字
            {s && (
              <>
                {" ・ 抽出: 職歴 "}
                {s.workExperiences}件 / 学歴 {s.educationHistory}件 / 資格 {s.licenses}件 / 自己PR{" "}
                {s.hasSelfPr ? "有" : "無"} / 希望条件 {s.desiredConditions}件
              </>
            )}
          </div>
          <pre className="bg-muted/40 max-h-64 overflow-auto rounded border p-2 text-[11px] whitespace-pre-wrap">
            {data.transcript ||
              "(文字起こしが空です。音声が無音・非対応形式・極端に短い可能性があります)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isDone = status === "extracted";
  const isFailed = status.startsWith("failed_");
  const tone = isDone
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
    : isFailed
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
