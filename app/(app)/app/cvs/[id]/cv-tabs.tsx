"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CvPreview } from "@/components/features/cv/cv-preview";
import type { Cv } from "@/lib/cvs/types";
import type { LicenseItem } from "@/lib/resumes/types";
import { CvForm } from "../cv-form";

/**
 * 職務経歴書詳細画面の「編集 / プレビュー」切り替え。
 *
 * 履歴書 resume-tabs.tsx と同型の UX:
 * - 両方を常にマウントしておき、CSS の display で表示/非表示を切り替える
 *   → 編集中の未保存値がタブ切替で失われない
 * - プレビューは保存済みの内容を表示する(編集中フォームの未保存値ではない)
 * - 右側に PDF ダウンロードボタン(履歴書と同じ位置)
 *
 * PDF ダウンロード方式(履歴書の <a download> から変更):
 * - fetch で取得 → Blob → URL.createObjectURL でダウンロードを起動
 * - 失敗時はサーバーが返すテキスト(text/plain)を Alert に表示
 *   → タイムアウト(504)や生成失敗(500)の文面をユーザーに見せられる
 * - <a download> だと失敗時にエラー文がそのまま遷移先になり UX が荒れるため、
 *   fetch 方式に切替えた
 *
 * AI下書きボタンは cv-form 内部に閉じて Phase 4 で追加。
 *
 * 履歴書からの氏名・資格(linkedResume*)は親で listResumes() の結果から
 * cv.licenseResumeId で解決して受け取る(再フェッチなし)。
 */

type ResumeOption = { id: string; title: string };

type Props = {
  cv: Cv;
  resumeOptions: ResumeOption[];
  // license_resume_id で参照している履歴書の氏名(無ければ null)
  linkedResumeName: string | null;
  // 同上、資格一覧(履歴書未選択 or 履歴書が空なら [])
  linkedResumeLicenses: LicenseItem[];
  // career_profile が存在するか。CvForm の AI ボタン有効化判定に使う(Phase 4-c〜)
  hasCareerProfile: boolean;
};

export function CvTabs({
  cv,
  resumeOptions,
  linkedResumeName,
  linkedResumeLicenses,
  hasCareerProfile,
}: Props) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = async () => {
    setPdfPending(true);
    setPdfError(null);
    try {
      const response = await fetch(`/api/cvs/${cv.id}/pdf`);
      if (!response.ok) {
        // API は失敗時に text/plain で日本語のエラー文面を返す(504/500 共に)。
        // fetch の本文をそのままアラート表示する。
        const message = await response.text();
        throw new Error(message || "PDF の生成に失敗しました。");
      }
      const blob = await response.blob();
      triggerBlobDownload(blob, buildPdfFilename(cv.title));
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "PDF の生成に失敗しました。");
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b">
        <div className="flex gap-2">
          <TabButton active={tab === "edit"} onClick={() => setTab("edit")}>
            編集
          </TabButton>
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
            プレビュー
          </TabButton>
        </div>
        {/* PDF ダウンロード:
            プレビュー中の見た目を Puppeteer でそのまま PDF 化する。
            fetch + Blob でダウンロードする(失敗時のエラー文面を見せられるように)。
            ※ プレビューは「保存済みの内容」を出すので、未保存の編集中値は PDF にも出ない。 */}
        <Button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfPending}
          className="mb-1 inline-flex h-9 items-center"
        >
          {pdfPending ? "生成中..." : "PDFをダウンロード"}
        </Button>
      </div>

      {pdfError && (
        <Alert variant="destructive">
          <AlertDescription>{pdfError}</AlertDescription>
        </Alert>
      )}

      <div className={tab === "edit" ? "" : "hidden"}>
        <CvForm
          mode="edit"
          existing={cv}
          resumeOptions={resumeOptions}
          hasCareerProfile={hasCareerProfile}
        />
      </div>
      <div className={tab === "preview" ? "" : "hidden"}>
        <CvPreview
          body={cv.body}
          name={linkedResumeName}
          licenses={linkedResumeLicenses}
          documentDate={cv.documentDate}
        />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // shadcn Button の variant ではタブのアクティブ判定の見た目が微妙なので、
  // 履歴書 resume-tabs と同じく、タブ専用の軽量ボタンを用意する。
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={`rounded-none border-b-2 ${
        active ? "border-foreground text-foreground" : "text-muted-foreground border-transparent"
      }`}
    >
      {children}
    </Button>
  );
}

// ====================================================================
// PDF ダウンロード helpers
//
// API ルートはサーバー側で title サニタイズ済みの Content-Disposition を返すが、
// クライアントの a.download は URL 由来のファイル名を見ないため(Blob URL)、
// クライアント側でも独自にサニタイズして download 属性に渡す必要がある。
// ====================================================================

function buildPdfFilename(title: string): string {
  // サーバー側 route.ts と同じサニタイズ規則(英数 + ハイフン + アンダースコア以外を _ に)。
  const safe = title.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 60);
  return `${safe || "職務経歴書"}.pdf`;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // createObjectURL のリーク防止。click 後すぐ revoke しても問題ない。
    URL.revokeObjectURL(url);
  }
}
