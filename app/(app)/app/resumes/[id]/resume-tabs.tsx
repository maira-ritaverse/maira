"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResumePreview } from "@/components/features/resume/resume-preview";
import type { Resume } from "@/lib/resumes/types";
import { ResumeForm } from "../resume-form";

/**
 * 履歴書詳細画面の「編集 / プレビュー」切り替え。
 *
 * - 編集タブ:既存の ResumeForm をそのまま表示(下書き保存も従来通り)
 * - プレビュータブ:厚労省様式の HTML プレビュー
 *
 * 切り替えで内容が消えるとストレスなので、両方を常にマウントしておき、
 * CSS の display で表示/非表示を切り替える。これにより編集中の未保存値も
 * 失われずに済む。
 *
 * プレビューは「保存済みの内容」を表示する(編集中フォームの未保存値ではなく)。
 * 編集中の見た目を見たい場合は一度保存してからプレビューに切り替える運用。
 * — フォームの値を Resume に逐次変換するのは複雑かつ Phase 2-A の目的外。
 */
export function ResumeTabs({
  resume,
  photoSignedUrl,
  hasCareerProfile,
}: {
  resume: Resume;
  // 写真の署名付き URL(private バケットのため img の src に直接 photoUrl は使えない)。
  // page.tsx(Server Component)で本人のセッション経由で発行された URL を受け取る。
  photoSignedUrl: string | null;
  hasCareerProfile: boolean;
}) {
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
            ※ プレビューは「保存済みの内容」を出すので、未保存の編集中値は出ない点に注意。 */}
        <a
          href={`/api/resumes/${resume.id}/pdf`}
          className="bg-foreground text-background mb-1 inline-flex h-9 items-center rounded-md px-3 text-sm font-medium hover:opacity-90"
        >
          PDFをダウンロード
        </a>
      </div>

      <div className={tab === "edit" ? "" : "hidden"}>
        <ResumeForm
          mode="edit"
          existing={resume}
          photoSignedUrl={photoSignedUrl}
          hasCareerProfile={hasCareerProfile}
        />
      </div>
      <div className={tab === "preview" ? "" : "hidden"}>
        <ResumePreview resume={resume} photoSignedUrl={photoSignedUrl} />
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
  // shadcn Button の variant を使うとアクティブ判定の見た目が微妙なので、
  // タブ専用の軽量ボタンを用意する。
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
