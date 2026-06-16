import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";
import { decryptField } from "@/lib/crypto/field-encryption";
import { extractionResultSchema, type ExtractionResult } from "@/lib/career-intake/types";

/**
 * 公開ページ /share/intake/[token]
 *
 * 認証不要。URL のトークンが capability(= 認証情報)として機能する。
 * 抽出結果(キャリアサマリ / 希望条件 / 構造化職歴 / スキル)を表示する。
 *
 * 注意:
 *   - 個人特定情報は API 側で伏せる(nameKana / birthDate → null)
 *   - URL を持っている人なら誰でも見られるので、機密度が高い場合は本人がリンクを
 *     失効すれば良い(/api/career-intake/shares/[shareId] DELETE)
 */
type RouteParams = { params: Promise<{ token: string }> };

type LoadResult =
  | {
      ok: true;
      data: {
        label: string | null;
        expiresAt: string;
        createdAt: string;
        recordingFilename: string;
        extraction: ExtractionResult;
      };
    }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "error" };

async function load(token: string): Promise<LoadResult> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, reason: "not_found" };

  const service = createServiceClient();
  const { data: shareRow } = await service
    .from("career_intake_shares")
    .select("id, recording_id, expires_at, revoked_at, label, created_at")
    .eq("token", token)
    .maybeSingle();
  if (!shareRow) return { ok: false, reason: "not_found" };
  const share = shareRow as {
    id: string;
    recording_id: string;
    expires_at: string;
    revoked_at: string | null;
    label: string | null;
    created_at: string;
  };
  if (share.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(share.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const { data: recRow } = await service
    .from("career_intake_recordings")
    .select("status, encrypted_extraction, original_filename")
    .eq("id", share.recording_id)
    .maybeSingle();
  if (!recRow) return { ok: false, reason: "not_found" };
  const rec = recRow as {
    status: string;
    encrypted_extraction: string | null;
    original_filename: string;
  };
  if (rec.status !== "extracted" || !rec.encrypted_extraction) {
    return { ok: false, reason: "error" };
  }

  const decrypted = await decryptField(rec.encrypted_extraction);
  if (!decrypted) return { ok: false, reason: "error" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decrypted);
  } catch {
    return { ok: false, reason: "error" };
  }
  const validated = extractionResultSchema.safeParse(parsedJson);
  if (!validated.success) return { ok: false, reason: "error" };

  return {
    ok: true,
    data: {
      label: share.label,
      expiresAt: share.expires_at,
      createdAt: share.created_at,
      recordingFilename: rec.original_filename,
      extraction: {
        ...validated.data,
        nameKana: null,
        birthDate: null,
      },
    },
  };
}

export default async function SharedIntakePage({ params }: RouteParams) {
  const { token } = await params;
  const result = await load(token);

  if (!result.ok) {
    if (result.reason === "expired") {
      return (
        <main className="mx-auto max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">リンクの有効期限が切れています</h1>
          <p className="text-muted-foreground mt-2 text-sm">本人にお問い合わせください。</p>
        </main>
      );
    }
    if (result.reason === "revoked") {
      return (
        <main className="mx-auto max-w-md p-8 text-center">
          <h1 className="text-xl font-bold">このリンクは無効になりました</h1>
          <p className="text-muted-foreground mt-2 text-sm">本人によって失効されています。</p>
        </main>
      );
    }
    notFound();
  }

  const { data } = result;
  const ext = data.extraction;

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      <header className="space-y-1 border-b pb-3">
        <p className="text-muted-foreground text-xs">
          {data.label ? `${data.label} ・ ` : ""}
          {new Date(data.createdAt).toLocaleString("ja-JP")} 共有 ・ 有効期限{" "}
          {new Date(data.expiresAt).toLocaleString("ja-JP")}
        </p>
        <h1 className="text-2xl font-bold">キャリアサマリ</h1>
        <p className="text-muted-foreground text-xs">{data.recordingFilename}</p>
      </header>

      <section className="mt-4 space-y-4 text-sm">
        {ext.careerSummary && <Block title="職務サマリ" body={ext.careerSummary} />}
        {ext.selfPr && <Block title="自己 PR" body={ext.selfPr} />}
        {ext.motivationNote && <Block title="志望動機メモ" body={ext.motivationNote} />}
        {ext.skillsSummary && <Block title="スキル(文章)" body={ext.skillsSummary} />}

        {ext.workExperiences.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">職務経歴</h2>
            <ul className="space-y-2">
              {ext.workExperiences.map((w, i) => (
                <li key={i} className="rounded-md border p-3 text-xs">
                  <div className="font-medium">{w.companyName}</div>
                  {(w.industry || w.position) && (
                    <div className="text-muted-foreground">
                      {[w.industry, w.position].filter(Boolean).join(" / ")}
                    </div>
                  )}
                  <div className="text-muted-foreground mt-1">
                    {fmtPeriod(w.startYear ?? null, w.startMonth ?? null)} 〜{" "}
                    {fmtPeriod(w.endYear ?? null, w.endMonth ?? null) || "現在"}
                  </div>
                  {w.jobDescription && (
                    <p className="mt-1 whitespace-pre-wrap">{w.jobDescription}</p>
                  )}
                  {w.achievements && (
                    <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                      実績:{w.achievements}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {ext.skills.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-base font-semibold">スキル</h2>
            <div className="flex flex-wrap gap-1.5">
              {ext.skills.map((s, i) => (
                <span key={i} className="bg-muted rounded-full px-2 py-0.5 text-xs">
                  {s.name}
                  {s.level ? ` (${s.level})` : ""}
                </span>
              ))}
            </div>
          </section>
        )}

        {(ext.desiredIndustries.length > 0 ||
          ext.desiredOccupations.length > 0 ||
          ext.desiredLocations.length > 0 ||
          ext.desiredAnnualIncome != null) && (
          <section className="space-y-1">
            <h2 className="text-base font-semibold">希望条件</h2>
            <ul className="text-muted-foreground ml-4 list-disc text-xs">
              {ext.desiredIndustries.length > 0 && <li>業界:{ext.desiredIndustries.join(", ")}</li>}
              {ext.desiredOccupations.length > 0 && (
                <li>職種:{ext.desiredOccupations.join(", ")}</li>
              )}
              {ext.desiredLocations.length > 0 && <li>勤務地:{ext.desiredLocations.join(", ")}</li>}
              {ext.desiredAnnualIncome != null && <li>希望年収:{ext.desiredAnnualIncome} 万円</li>}
            </ul>
          </section>
        )}
      </section>

      <footer className="text-muted-foreground mt-8 border-t pt-3 text-[10px]">
        この情報は本人の AI ヒアリング結果を共有目的で公開したものです。
      </footer>
    </main>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <section className="space-y-1">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground whitespace-pre-wrap">{body}</p>
    </section>
  );
}

function fmtPeriod(year: number | null, month: number | null): string {
  if (year == null && month == null) return "";
  if (year != null && month != null) return `${year}年${month}月`;
  if (year != null) return `${year}年`;
  return "";
}
