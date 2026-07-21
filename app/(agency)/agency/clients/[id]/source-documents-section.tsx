"use client";

/**
 * 元書類 (求職者 の 既存 履歴書 / 職務経歴書 の PDF / 画像) 管理 セクション。
 *
 * Phase 1 は 保存 + 一覧 + ダウンロード + 削除 のみ。 Phase 2 で アップロード
 * 済 ファイル を Claude Vision に 通して CRM プロフィール に 反映 する UI を
 * 足す 予定。
 *
 * 実装 メモ:
 *   ・アップロード は multipart で POST /api/agency/clients/[id]/source-documents
 *   ・ダウンロード は GET で 短命 署名 URL を もらって、 その URL に window.open
 *     (直接 リンク を <a href> に 貼ると 期限切れ 時 に UX が 破綻 する ため、
 *      押した 瞬間 に URL 発行 → 遷移 の 順序 にする)
 *   ・削除 は ConfirmDialog を 挟む
 *   ・エラー は toast で 日本語 メッセージ に して 出す
 */
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/lib/admin/toast/store";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  SOURCE_DOCUMENT_TYPE_LABELS,
  type SourceDocument,
  type SourceDocumentType,
} from "@/lib/agency-client-source-documents/types";

import { DocumentExtractPreviewModal } from "./document-extract-preview-modal";

type Props = {
  clientRecordId: string;
};

// エラー を 日本語 で 出す ため の 変換 テーブル。 一般的 な HTTP status /
// error code を メッセージ に マップ。
function errorToJapanese(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "不明 な エラー が 発生 しました";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iconForMime(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  return <FileText className="size-4" aria-hidden />;
}

export function SourceDocumentsSection({ clientRecordId }: Props) {
  const { showToast } = useToast();
  const router = useRouter();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [documentType, setDocumentType] = useState<SourceDocumentType>("resume");
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<SourceDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  // AI 抽出 プレビュー モーダル の 対象 ドキュメント (null = 閉じ 状態)
  const [extractingDoc, setExtractingDoc] = useState<SourceDocument | null>(null);
  // 「書類から作成」実行中のドキュメント + 種別 (null = なし)
  const [creating, setCreating] = useState<{ id: string; kind: "resume" | "cv" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agency/clients/${clientRecordId}/source-documents`);
        if (!res.ok) throw new Error(`一覧取得に失敗しました (HTTP ${res.status})`);
        const body = (await res.json()) as { documents: SourceDocument[] };
        if (!cancelled) setDocs(body.documents);
      } catch (err) {
        if (!cancelled) showToast("error", errorToJapanese(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientRecordId, showToast]);

  async function handleUpload(file: File) {
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      showToast("error", "対応形式は PDF / JPG / PNG のみです");
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      showToast(
        "error",
        `ファイルサイズは ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB 以下にしてください`,
      );
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", documentType);
      const res = await fetch(`/api/agency/clients/${clientRecordId}/source-documents`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        document?: SourceDocument;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          body.message ?? body.error ?? `アップロードに失敗しました (HTTP ${res.status})`,
        );
      }
      if (body.document) {
        setDocs((prev) => [body.document as SourceDocument, ...prev]);
        showToast("success", `${body.document.fileName} を保存しました`);
      }
      // 同じファイルを続けて再アップロードできるよう input を reset。
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      showToast("error", errorToJapanese(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: SourceDocument) {
    try {
      const res = await fetch(`/api/agency/clients/${clientRecordId}/source-documents/${doc.id}`);
      const body = (await res.json().catch(() => ({}))) as {
        downloadUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.downloadUrl) {
        throw new Error(
          body.message ?? body.error ?? `ダウンロード URL 取得失敗 (HTTP ${res.status})`,
        );
      }
      // 新規タブで開く。 Storage 側で Content-Disposition attachment 付きの
      // 署名 URL を発行しているので、ブラウザが直接ダウンロードを開始する。
      window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      showToast("error", errorToJapanese(err));
    }
  }

  // 元書類を AI 抽出して、その内容を反映した新しい履歴書 / 職務経歴書を作成し、
  // 作成済みのエディタへ遷移する(そこで編集して変種に仕上げる)。
  async function handleCreateFrom(doc: SourceDocument, kind: "resume" | "cv") {
    setCreating({ id: doc.id, kind });
    try {
      const endpoint = kind === "resume" ? "client-resumes" : "client-cvs";
      const res = await fetch(`/api/agency/${endpoint}/from-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_record_id: clientRecordId, source_document_id: doc.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        item?: { id: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.item) {
        throw new Error(body.message ?? body.error ?? `作成に失敗しました (HTTP ${res.status})`);
      }
      showToast(
        "success",
        kind === "resume" ? "書類から履歴書を作成しました" : "書類から職務経歴書を作成しました",
      );
      const path = kind === "resume" ? "agency-resumes" : "agency-cvs";
      router.push(`/agency/clients/${clientRecordId}/${path}/${body.item.id}`);
    } catch (err) {
      showToast("error", errorToJapanese(err));
    } finally {
      setCreating(null);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteDoc) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/agency/clients/${clientRecordId}/source-documents/${confirmDeleteDoc.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `削除に失敗しました (HTTP ${res.status})`);
      }
      setDocs((prev) => prev.filter((d) => d.id !== confirmDeleteDoc.id));
      showToast("success", `${confirmDeleteDoc.fileName} を削除しました`);
      setConfirmDeleteDoc(null);
    } catch (err) {
      showToast("error", errorToJapanese(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">元書類(アップロード)</h2>
        <p className="text-muted-foreground text-xs">
          求職者から受け取った既存の履歴書 / 職務経歴書(PDF / JPG / PNG、20MB
          まで)を保存できます。後でそのままダウンロードして求人企業への提出等に使えるほか、
          「履歴書を作成 / 職務経歴書を作成」から中の情報を AI で抽出して、Maira の履歴書 /
          職務経歴書を新規作成(変種づくりの下敷き)できます。
        </p>
      </div>

      {/* アップロード UI */}
      <div className="bg-muted/30 flex flex-wrap items-center gap-2 rounded-md border p-3">
        <label htmlFor="src-doc-type" className="text-sm">
          種類
        </label>
        <select
          id="src-doc-type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as SourceDocumentType)}
          disabled={uploading}
          className="border-input bg-background rounded-md border px-2 py-1 text-sm"
        >
          <option value="resume">履歴書</option>
          <option value="cv">職務経歴書</option>
          <option value="other">その他</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
          }}
          className="text-sm"
        />
        {uploading && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            アップロード中...
          </span>
        )}
        {!uploading && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Upload className="size-3" aria-hidden />
            ファイル選択後に自動保存
          </span>
        )}
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          読み込み中...
        </div>
      ) : docs.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">
          まだアップロードされた元書類はありません
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-3">
              <span className="text-muted-foreground">{iconForMime(d.mimeType)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.fileName}</div>
                <div className="text-muted-foreground text-xs">
                  {SOURCE_DOCUMENT_TYPE_LABELS[d.documentType]} ・ {formatBytes(d.fileSize)} ・{" "}
                  {new Date(d.createdAt).toLocaleString("ja-JP", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDownload(d)}
                aria-label={`${d.fileName} をダウンロード`}
              >
                <Download className="size-4" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExtractingDoc(d)}
                aria-label={`${d.fileName} を AI でプロフィールに反映`}
                title="AI でプロフィールに反映"
              >
                <Sparkles className="size-4" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={creating !== null}
                onClick={() => handleCreateFrom(d, "resume")}
                title="この書類から履歴書を作成"
              >
                {creating?.id === d.id && creating.kind === "resume" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  "履歴書を作成"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={creating !== null}
                onClick={() => handleCreateFrom(d, "cv")}
                title="この書類から職務経歴書を作成"
              >
                {creating?.id === d.id && creating.kind === "cv" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  "職務経歴書を作成"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDeleteDoc(d)}
                aria-label={`${d.fileName} を削除`}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDeleteDoc !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmDeleteDoc(null);
        }}
        title="元書類を削除しますか?"
        description={
          confirmDeleteDoc
            ? `「${confirmDeleteDoc.fileName}」を削除します。この操作は取り消せません。`
            : ""
        }
        confirmLabel="削除"
        destructive
        pending={deleting}
        onConfirm={handleDelete}
      />

      {/* AI 抽出 → プレビュー → 保存 モーダル。 保存 後 は toast + ページ 再読込 で
          client_records 側 の 表示 に 最新値 を 反映 する (このセクションは 書類 一覧
          しか 持たない ため、 プロフィール表示 の 更新 は router.refresh 経由 で 呼ぶ)。 */}
      {extractingDoc && (
        <DocumentExtractPreviewModal
          clientRecordId={clientRecordId}
          docId={extractingDoc.id}
          fileName={extractingDoc.fileName}
          onClose={() => setExtractingDoc(null)}
          onSaved={(count) => {
            setExtractingDoc(null);
            showToast(
              "success",
              count > 0
                ? `${count} 件のプロフィール項目を反映しました`
                : "反映する項目が選択されていませんでした",
            );
            // 親ページ (Server Component) を revalidate して プロフィール表示 に
            // 最新値 を 反映 させる。 このセクション自体 は 書類 一覧 しか 持たない。
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}
