"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type DocOption = { id: string; title: string };

type Props = {
  applicationId: string;
  resumes: DocOption[];
  cvs: DocOption[];
};

type SaveAsDocumentResponse = {
  ok: boolean;
  kind: "resume" | "cv";
  id: string;
};

/**
 * 応募ページから「この応募用にカスタマイズした履歴書 / 職務経歴書」を PDF でダウンロード。
 *
 * - ユーザがベース履歴書 / 職務経歴書を選ぶ
 * - リンクは /api/{resumes|cvs}/[id]/pdf?applicationId=... を指す
 *   → サーバ側で application_pr_customizations の差分を当てて PDF を生成
 * - 履歴書 / 職務経歴書が 1 件も無い場合は導線を出す
 */
export function ApplicationDocumentDownload({ applicationId, resumes, cvs }: Props) {
  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "");
  const [cvId, setCvId] = useState(cvs[0]?.id ?? "");
  const [savingKind, setSavingKind] = useState<"resume" | "cv" | null>(null);
  const [saveMessage, setSaveMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const resumeHref = resumeId
    ? `/api/resumes/${resumeId}/pdf?applicationId=${applicationId}`
    : null;
  const cvHref = cvId ? `/api/cvs/${cvId}/pdf?applicationId=${applicationId}` : null;

  // 履歴書 / 職務経歴書として保存(会社名タイトルで新規レコード作成)
  const handleSaveAs = async (kind: "resume" | "cv") => {
    const baseId = kind === "resume" ? resumeId : cvId;
    if (!baseId) return;
    setSavingKind(kind);
    setSaveMessage(null);
    try {
      const res = await apiFetch<SaveAsDocumentResponse>(
        `/api/applications/${applicationId}/save-as-document`,
        {
          method: "POST",
          json:
            kind === "resume"
              ? { kind: "resume", baseResumeId: baseId }
              : { kind: "cv", baseCvId: baseId },
        },
      );
      if (res?.ok) {
        const label = kind === "resume" ? "履歴書" : "職務経歴書";
        setSaveMessage({
          kind: "success",
          text: `${label}一覧に「会社名(今日の日付)」で保存しました。`,
        });
      }
    } catch (err) {
      setSaveMessage({ kind: "error", text: getErrorMessage(err) });
    } finally {
      setSavingKind(null);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">この応募用に履歴書 / 職務経歴書を生成</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          上で保存した「志望動機・自己PR」がベースの書類に反映された PDF を作成します。
          ベース文書は普段使っているものをそのまま選んでください。
        </p>
      </div>

      {/* === 履歴書 === */}
      <div className="space-y-1">
        <label htmlFor="resume-select" className="text-sm font-medium">
          履歴書(志望動機 + 自己PR が自由記述欄に反映)
        </label>
        {resumes.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            履歴書がまだありません。
            <Link href="/app/resumes" className="ml-1 underline">
              履歴書を作成する
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            <select
              id="resume-select"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!resumeHref}
                render={
                  resumeHref ? (
                    <a href={resumeHref} download>
                      PDF でダウンロード
                    </a>
                  ) : undefined
                }
              >
                PDF でダウンロード
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!resumeId || savingKind !== null}
                onClick={() => void handleSaveAs("resume")}
              >
                {savingKind === "resume" ? "保存中…" : "履歴書一覧に「会社名」で保存"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* === 職務経歴書 === */}
      <div className="space-y-1">
        <label htmlFor="cv-select" className="text-sm font-medium">
          職務経歴書(自己PR 欄をこの応募用に差し替え)
        </label>
        {cvs.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            職務経歴書がまだありません。
            <Link href="/app/cvs" className="ml-1 underline">
              職務経歴書を作成する
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            <select
              id="cv-select"
              value={cvId}
              onChange={(e) => setCvId(e.target.value)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {cvs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!cvHref}
                render={
                  cvHref ? (
                    <a href={cvHref} download>
                      PDF でダウンロード
                    </a>
                  ) : undefined
                }
              >
                PDF でダウンロード
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!cvId || savingKind !== null}
                onClick={() => void handleSaveAs("cv")}
              >
                {savingKind === "cv" ? "保存中…" : "職務経歴書一覧に「会社名」で保存"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {saveMessage && (
        <p
          className={
            saveMessage.kind === "success"
              ? "text-xs text-emerald-700 dark:text-emerald-300"
              : "text-destructive text-xs"
          }
        >
          {saveMessage.text}
        </p>
      )}

      <p className="text-muted-foreground text-[11px]">
        ※ ベース履歴書 / 職務経歴書はそのまま残ります。この応募用のカスタマイズだけ反映された PDF
        が生成されます。「保存」を押すと履歴書 / 職務経歴書 一覧に「会社名(今日の日付)」の
        タイトルで新しいレコードとして残ります。
      </p>
    </Card>
  );
}
