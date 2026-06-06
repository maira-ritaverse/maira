"use client";

import { useState } from "react";
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
 * PDF は <a download> + サーバー側 Content-Disposition で確実にダウンロード扱い。
 * クライアント側で fetch する必要はない(履歴書と同方式)。
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
};

export function CvTabs({ cv, resumeOptions, linkedResumeName, linkedResumeLicenses }: Props) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");

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
            <a download> + サーバー側 Content-Disposition で確実にダウンロード扱いにする。
            ※ プレビューは「保存済みの内容」を出すので、未保存の編集中値は PDF にも出ない。 */}
        <a
          href={`/api/cvs/${cv.id}/pdf`}
          className="bg-foreground text-background mb-1 inline-flex h-9 items-center rounded-md px-3 text-sm font-medium hover:opacity-90"
        >
          PDFをダウンロード
        </a>
      </div>

      <div className={tab === "edit" ? "" : "hidden"}>
        <CvForm mode="edit" existing={cv} resumeOptions={resumeOptions} />
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
