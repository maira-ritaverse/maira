"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type {
  AgencyClientResume,
  EducationItem,
  LicenseItem,
  ResumePii,
} from "@/lib/agency-client-documents/types";

/**
 * エージェント所有の履歴書エディタ。
 *
 * 設計判断:
 *   ・1 ページに「タイトル / 日付 / PII / 学歴 / 資格 / 状態 / 削除」を集約
 *   ・自動保存は付けず、明示の「保存」ボタンで一括 PATCH(誤上書きを避ける)
 *   ・status=final も同一画面で切り替え可。誤確定したら draft に戻して再編集
 *   ・admin のみ「削除」ボタン
 *
 * 写真アップロードは Phase 4 で同セクションに追加。
 */
type Props = {
  clientRecordId: string;
  resume: AgencyClientResume;
  isAdmin: boolean;
};

// 年月は "YYYY/MM"(月なしは "YYYY")の文字列1本で保持する(agency-resume-mapper の
// parseYearMonth と対応)。入力欄は年・月に分け、表示/保存でこの2関数で相互変換する。
function splitYearMonth(raw: string): { year: string; month: string } {
  if (!raw) return { year: "", month: "" };
  const [year, month] = raw.split("/");
  return { year: year ?? "", month: month ?? "" };
}
function joinYearMonth(year: string, month: string): string {
  const y = year.trim();
  const m = month.trim();
  if (!y && !m) return "";
  return m ? `${y}/${m}` : y;
}

export function AgencyResumeEditor({ clientRecordId, resume, isAdmin }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [title, setTitle] = useState(resume.title);
  const [documentDate, setDocumentDate] = useState(resume.documentDate ?? "");
  const [pii, setPii] = useState<ResumePii>(resume.pii);
  const [education, setEducation] = useState<EducationItem[]>(resume.educationHistory);
  const [licenses, setLicenses] = useState<LicenseItem[]>(resume.licenses);

  const updatePii = (patch: Partial<ResumePii>) => setPii((prev) => ({ ...prev, ...patch }));

  const handleSave = (nextStatus?: "draft" | "final") => {
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-resumes/${resume.id}`, {
          method: "PATCH",
          json: {
            title,
            document_date: documentDate || null,
            pii,
            education_history: education,
            licenses,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
        });
        setSavedAt(new Date());
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`「${resume.title}」を削除します。元に戻せません。実行しますか?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-resumes/${resume.id}`, { method: "DELETE" });
        router.push(`/agency/clients/${clientRecordId}?tab=documents`);
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handlePushToSeeker = () => {
    if (
      !confirm(
        "この履歴書を求職者本人に送付します。受領後は本人の履歴書に取り込まれます。実行しますか?",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/client-resumes/${resume.id}/push-to-seeker`, {
          method: "POST",
          json: {},
        });
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const addEducation = () => setEducation((prev) => [...prev, { year: "", description: "" }]);
  const updateEducation = (idx: number, patch: Partial<EducationItem>) =>
    setEducation((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeEducation = (idx: number) => setEducation((prev) => prev.filter((_, i) => i !== idx));

  const addLicense = () => setLicenses((prev) => [...prev, { year: "", description: "" }]);
  const updateLicense = (idx: number, patch: Partial<LicenseItem>) =>
    setLicenses((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeLicense = (idx: number) => setLicenses((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* タイトル + 日付 + 状態 */}
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">基本情報</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              resume.status === "final"
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {resume.status === "final" ? "確定済" : "編集中"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="title">タイトル</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="documentDate">日付</Label>
            <Input
              id="documentDate"
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
      </Card>

      {/* 本人情報(PII) */}
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">本人情報</h2>
        <p className="text-muted-foreground text-xs">
          AES-256-GCM で暗号化して保存します。本ページ離脱後は復号した状態を保持しません。
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="氏名" value={pii.full_name} onChange={(v) => updatePii({ full_name: v })} />
          <Field
            label="氏名カナ"
            value={pii.full_name_kana}
            onChange={(v) => updatePii({ full_name_kana: v })}
          />
          <Field
            label="生年月日(YYYY-MM-DD)"
            value={pii.birth_date}
            onChange={(v) => updatePii({ birth_date: v })}
          />
          <div className="space-y-1">
            <Label htmlFor="gender">性別</Label>
            <select
              id="gender"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={pii.gender}
              onChange={(e) => updatePii({ gender: e.target.value as ResumePii["gender"] })}
              disabled={pending}
            >
              <option value="">未選択</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
          </div>
          <Field
            label="郵便番号"
            value={pii.postal_code}
            onChange={(v) => updatePii({ postal_code: v })}
          />
          <Field label="電話番号" value={pii.phone} onChange={(v) => updatePii({ phone: v })} />
        </div>
        <Field label="住所" value={pii.address} onChange={(v) => updatePii({ address: v })} />
        {/* 現住所フリガナ。書類取り込み(Vision 抽出)/ プロフィール作成(AI 生成)で
            自動補完されるほか、「住所から生成」でいつでも現在の住所から生成できる。
            手入力・住所編集・古い履歴書でも埋められるようにするためのオンデマンド生成。 */}
        <AddressKanaField
          resumeId={resume.id}
          address={pii.address}
          value={pii.address_kana ?? ""}
          onChange={(v) => updatePii({ address_kana: v })}
          pending={pending}
        />
        <Field label="メールアドレス" value={pii.email} onChange={(v) => updatePii({ email: v })} />
        <TextareaWithAi
          label="志望動機"
          value={pii.motivation}
          onChange={(v) => updatePii({ motivation: v })}
          rows={4}
          maxLength={2000}
          resumeId={resume.id}
          kind="motivation"
          pending={pending}
        />
        <TextareaWithAi
          label="自己 PR"
          value={pii.self_pr}
          onChange={(v) => updatePii({ self_pr: v })}
          rows={4}
          maxLength={2000}
          resumeId={resume.id}
          kind="self_pr"
          pending={pending}
        />
        <TextareaField
          label="本人希望記入欄"
          value={pii.preferences}
          onChange={(v) => updatePii({ preferences: v })}
          rows={3}
          maxLength={1000}
        />
      </Card>

      {/* 学歴・職歴 */}
      <Card className="space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">学歴・職歴</h2>
          <Button size="sm" variant="outline" onClick={addEducation} disabled={pending}>
            + 行を追加
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          退職理由・自己PR などの自由記述も内容欄に書けます(年月は空欄でも可)。
          「学歴」「職歴」だけの行は見出しとして中央寄せ・「学　　歴」表示になります
        </p>
        {education.length === 0 ? (
          <p className="text-muted-foreground text-xs">未入力</p>
        ) : (
          <ul className="space-y-2">
            {education.map((it, idx) => (
              <li key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr_auto]">
                <div className="grid grid-cols-2 gap-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="年"
                    value={splitYearMonth(it.year).year}
                    onChange={(e) =>
                      updateEducation(idx, {
                        year: joinYearMonth(e.target.value, splitYearMonth(it.year).month),
                      })
                    }
                    disabled={pending}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="月"
                    value={splitYearMonth(it.year).month}
                    onChange={(e) =>
                      updateEducation(idx, {
                        year: joinYearMonth(splitYearMonth(it.year).year, e.target.value),
                      })
                    }
                    disabled={pending}
                  />
                </div>
                <Textarea
                  placeholder="例:○○大学 経済学部 卒業 / 一身上の都合により退職 など"
                  value={it.description}
                  onChange={(e) => updateEducation(idx, { description: e.target.value })}
                  maxLength={500}
                  rows={2}
                  disabled={pending}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeEducation(idx)}
                  disabled={pending}
                >
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 資格 */}
      <Card className="space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">免許・資格</h2>
          <Button size="sm" variant="outline" onClick={addLicense} disabled={pending}>
            + 行を追加
          </Button>
        </div>
        {licenses.length === 0 ? (
          <p className="text-muted-foreground text-xs">未入力</p>
        ) : (
          <ul className="space-y-2">
            {licenses.map((it, idx) => (
              <li key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_1fr_auto]">
                <div className="grid grid-cols-2 gap-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="年"
                    value={splitYearMonth(it.year).year}
                    onChange={(e) =>
                      updateLicense(idx, {
                        year: joinYearMonth(e.target.value, splitYearMonth(it.year).month),
                      })
                    }
                    disabled={pending}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="月"
                    value={splitYearMonth(it.year).month}
                    onChange={(e) =>
                      updateLicense(idx, {
                        year: joinYearMonth(splitYearMonth(it.year).year, e.target.value),
                      })
                    }
                    disabled={pending}
                  />
                </div>
                <Input
                  placeholder="例:普通自動車第一種運転免許"
                  value={it.description}
                  onChange={(e) => updateLicense(idx, { description: e.target.value })}
                  maxLength={200}
                  disabled={pending}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeLicense(idx)}
                  disabled={pending}
                >
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 保存 / 確定 / 削除 アクション */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-muted-foreground text-xs">
          {savedAt ? `${savedAt.toLocaleTimeString("ja-JP")} に保存しました` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              削除
            </Button>
          )}
          {resume.status === "draft" ? (
            <>
              <Button variant="outline" onClick={() => handleSave()} disabled={pending}>
                {pending ? "保存中…" : "下書き保存"}
              </Button>
              <Button onClick={() => handleSave("final")} disabled={pending}>
                {pending ? "確定中…" : "確定する"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleSave("draft")} disabled={pending}>
                編集を再開(下書きに戻す)
              </Button>
              <Button variant="outline" onClick={() => handleSave()} disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
              {resume.pushedToDraftId ? (
                <Button disabled>送付済み</Button>
              ) : (
                <Button onClick={handlePushToSeeker} disabled={pending}>
                  {pending ? "送付中…" : "求職者本人に送付"}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * 現住所フリガナ欄 + 「住所から生成」ボタン。
 * 氏名カナと違い住所の読みは自明でないため、現在の住所からいつでも AI 生成できるようにする。
 * from-profile 作成時の自動生成は一度きりなので、手入力・編集・古い履歴書はここで補える。
 */
function AddressKanaField({
  resumeId,
  address,
  value,
  onChange,
  pending,
}: {
  resumeId: string;
  address: string;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
}) {
  const [genPending, startGen] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = () => {
    setGenError(null);
    if (!address.trim()) {
      setGenError("先に住所を入力してください。");
      return;
    }
    startGen(async () => {
      try {
        const res = await apiFetch<{ kana: string }>(
          `/api/agency/client-resumes/${resumeId}/address-kana`,
          { method: "POST", json: { address } },
        );
        if (!res?.kana) throw new Error("response_missing_kana");
        onChange(res.kana);
      } catch (err) {
        setGenError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>現住所(フリガナ)</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={pending || genPending}
        >
          {genPending ? "生成中…" : "住所から生成"}
        </Button>
      </div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      {genError && <p className="text-destructive text-xs">{genError}</p>}
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  maxLength: number;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
      />
    </div>
  );
}

/**
 * 志望動機 / 自己 PR 用の Textarea + AI 生成 ボタン。
 * AI 生成結果は確認ダイアログで Before/After を見せて、上書きするか判断できる。
 */
function TextareaWithAi({
  label,
  value,
  onChange,
  rows,
  maxLength,
  resumeId,
  kind,
  pending: parentPending,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  maxLength: number;
  resumeId: string;
  kind: "motivation" | "self_pr";
  pending: boolean;
}) {
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCandidate, setAiCandidate] = useState<string | null>(null);

  const isBusy = parentPending || aiPending;

  const handleAi = () => {
    setAiError(null);
    setAiCandidate(null);
    startAi(async () => {
      try {
        const res = await apiFetch<{ text: string }>(
          `/api/agency/client-resumes/${resumeId}/ai-write`,
          { method: "POST", json: { kind } },
        );
        if (!res?.text) throw new Error("response_missing_text");
        setAiCandidate(res.text);
      } catch (err) {
        setAiError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button type="button" size="sm" variant="outline" onClick={handleAi} disabled={isBusy}>
          {aiPending ? "AI 生成中…" : "AI で生成"}
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
      />
      {aiError && <p className="text-destructive text-xs">{aiError}</p>}
      {aiCandidate && (
        <div className="bg-muted/40 mt-2 space-y-2 rounded-md border p-3">
          <p className="text-muted-foreground text-xs">AI が生成した文案(プレビュー):</p>
          <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
            {aiCandidate}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAiCandidate(null)}
              disabled={isBusy}
            >
              破棄
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(aiCandidate);
                setAiCandidate(null);
              }}
              disabled={isBusy}
            >
              この文案で上書き
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
