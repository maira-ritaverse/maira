"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  employmentTypeLabels,
  employmentTypes,
  saveCvRequestSchema,
  skillCategories,
  skillCategoryLabels,
  skillLevelLabels,
  skillLevels,
  type Cv,
  type PeriodPoint,
  type SaveCvRequest,
} from "@/lib/cvs/types";

/**
 * 職務経歴書 新規 / 編集 フォーム(共通)
 *
 * - 必須は title だけ(他は下書き保存可)。事実(会社名)は WorkExperience 単位で必須
 * - 職務経歴・スキルは useFieldArray で動的に行追加
 * - 期間({year, month})は PeriodInput で「両方入って初めて確定」
 * - mode="create" → POST /api/cvs、成功で /app/cvs/[id] へ
 * - mode="edit"   → PATCH /api/cvs/[id]、成功はフォームに留まる
 * - mode="edit" のみ「削除」ボタンを表示(window.confirm の二段ガード)
 *
 * Phase 1 では AI下書き / プレビュー / PDF は無し。Phase 2 以降で追加。
 */

type ResumeOption = { id: string; title: string };

type Props =
  | {
      mode: "create";
      existing?: undefined;
      resumeOptions: ResumeOption[];
    }
  | {
      mode: "edit";
      existing: Cv;
      resumeOptions: ResumeOption[];
    };

// 年・月選択(履歴書と同じ範囲)
const YEAR_OPTIONS = (() => {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now + 5; y >= 1960; y--) years.push(y);
  return years;
})();
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export function CvForm(props: Props) {
  const { mode, resumeOptions } = props;
  const existing = mode === "edit" ? props.existing : undefined;

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SaveCvRequest>({
    resolver: zodResolver(saveCvRequestSchema),
    defaultValues: buildDefaultValues(existing),
  });

  const workExperiencesArray = useFieldArray({
    control,
    name: "body.work_experiences",
  });

  const skillsArray = useFieldArray({
    control,
    name: "body.skills",
  });

  const onSubmit = (data: SaveCvRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSaveMessage(null);
      try {
        const url = mode === "create" ? "/api/cvs" : `/api/cvs/${existing!.id}`;
        const method = mode === "create" ? "POST" : "PATCH";

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "Save failed");
        }

        if (mode === "create") {
          const result = (await response.json()) as { id: string };
          router.push(`/app/cvs/${result.id}`);
        } else {
          setSaveMessage("保存しました");
          router.refresh();
        }
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const handleDelete = async () => {
    if (mode !== "edit") return;
    const ok = window.confirm(
      `「${existing!.title}」を削除しますか?\n\nこの操作は取り消せません。`,
    );
    if (!ok) return;

    setIsDeleting(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/cvs/${existing!.id}`, { method: "DELETE" });
      if (!response.ok) {
        const errData = (await response.json()) as { error?: string; message?: string };
        throw new Error(errData.message ?? errData.error ?? "Delete failed");
      }
      router.push("/app/cvs");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Unknown error");
      setIsDeleting(false);
    }
  };

  const noResumes = resumeOptions.length === 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {serverError}</AlertDescription>
        </Alert>
      )}
      {saveMessage && (
        <Alert>
          <AlertDescription>{saveMessage}</AlertDescription>
        </Alert>
      )}

      {/* ============================================ */}
      {/* セクション1:基本情報                         */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">基本情報</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            必須はタイトルのみ。他は途中まで入力して保存できます(下書き)
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-2">
            <Label htmlFor="title">
              タイトル(管理用) <span className="text-red-600">*</span>
            </Label>
            <Input
              id="title"
              {...register("title")}
              disabled={isPending}
              placeholder="例:汎用、○○社向け など"
            />
            {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="document_date">作成日</Label>
            <Input
              id="document_date"
              type="date"
              {...register("document_date")}
              disabled={isPending}
            />
            <p className="text-muted-foreground text-xs">
              未入力の場合は表示時点の本日の日付になります
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="license_resume_id">資格を引いてくる履歴書</Label>
          <select
            id="license_resume_id"
            {...register("license_resume_id", { setValueAs: emptyToNullString })}
            disabled={isPending || noResumes}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">— 選択しない —</option>
            {resumeOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          {noResumes ? (
            <p className="text-muted-foreground text-xs">
              履歴書が未登録です。後から{" "}
              <Link href="/app/resumes" className="underline hover:no-underline">
                履歴書
              </Link>{" "}
              を作成すれば参照できます。
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              選んだ履歴書の免許・資格欄を職務経歴書に引き継ぎます(プレビュー/PDF 表示時に反映)
            </p>
          )}
        </div>
      </Card>

      {/* ============================================ */}
      {/* セクション2:職務要約                         */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">職務要約</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            これまでのキャリアを 150〜250 字程度で簡潔に(Phase 4 で AI 下書きに対応予定)
          </p>
        </div>
        <Textarea
          {...register("body.summary")}
          disabled={isPending}
          rows={5}
          placeholder="例:SaaS 企業で 5 年間、ユーザー視点の機能設計を担当..."
        />
        {errors.body?.summary && (
          <p className="text-sm text-red-600">{errors.body.summary.message}</p>
        )}
      </Card>

      {/* ============================================ */}
      {/* セクション3:職務経歴(逆編年式)              */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">職務経歴(新しい順)</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            会社名・期間・役職は事実なのでご自身で入力してください。業務内容・実績は Phase 4 で AI
            下書きに対応予定です(AI に事実は作らせません)
          </p>
        </div>

        {workExperiencesArray.fields.length === 0 && (
          <p className="text-muted-foreground text-sm">
            「+ 職歴を追加」から経歴を 1 件ずつ追加してください
          </p>
        )}

        <div className="space-y-4">
          {workExperiencesArray.fields.map((field, index) => (
            <div key={field.id} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">職歴 {index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => workExperiencesArray.remove(index)}
                  disabled={isPending}
                  aria-label={`職歴 ${index + 1} を削除`}
                >
                  削除
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-company`}>
                    会社名 <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id={`we-${index}-company`}
                    {...register(`body.work_experiences.${index}.company_name`)}
                    disabled={isPending}
                    placeholder="例:株式会社○○"
                  />
                  {errors.body?.work_experiences?.[index]?.company_name && (
                    <p className="text-sm text-red-600">
                      {errors.body.work_experiences[index]?.company_name?.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-industry`}>業界</Label>
                  <Input
                    id={`we-${index}-industry`}
                    {...register(`body.work_experiences.${index}.industry`, {
                      setValueAs: emptyToNullString,
                    })}
                    disabled={isPending}
                    placeholder="例:SaaS、人材"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>入社年月</Label>
                  <Controller
                    control={control}
                    name={`body.work_experiences.${index}.period_start`}
                    render={({ field: f }) => (
                      <PeriodInput
                        value={f.value ?? null}
                        onChange={f.onChange}
                        disabled={isPending}
                      />
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <Label>退社年月(在籍中は空欄)</Label>
                  <Controller
                    control={control}
                    name={`body.work_experiences.${index}.period_end`}
                    render={({ field: f }) => (
                      <PeriodInput
                        value={f.value ?? null}
                        onChange={f.onChange}
                        disabled={isPending}
                      />
                    )}
                  />
                  {/* refine による前後チェックは period_end にエラーを置く設計
                      (lib/cvs/types.ts の workExperienceSchema.refine)。 */}
                  {errors.body?.work_experiences?.[index]?.period_end && (
                    <p className="text-sm text-red-600">
                      {errors.body.work_experiences[index]?.period_end?.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-position`}>役職</Label>
                  <Input
                    id={`we-${index}-position`}
                    {...register(`body.work_experiences.${index}.position`, {
                      setValueAs: emptyToNullString,
                    })}
                    disabled={isPending}
                    placeholder="例:プロダクトマネージャー"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-employment`}>雇用形態</Label>
                  <select
                    id={`we-${index}-employment`}
                    {...register(`body.work_experiences.${index}.employment_type`, {
                      setValueAs: emptyToNullString,
                    })}
                    disabled={isPending}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="">— 選択しない —</option>
                    {employmentTypes.map((t) => (
                      <option key={t} value={t}>
                        {employmentTypeLabels[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`we-${index}-description`}>業務内容</Label>
                <Textarea
                  id={`we-${index}-description`}
                  {...register(`body.work_experiences.${index}.job_description`)}
                  disabled={isPending}
                  rows={4}
                  placeholder="担当した業務を箇条書きまたは文章で(Phase 4 で AI 下書きに対応予定)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`we-${index}-achievements`}>実績・成果</Label>
                <Textarea
                  id={`we-${index}-achievements`}
                  {...register(`body.work_experiences.${index}.achievements`)}
                  disabled={isPending}
                  rows={3}
                  placeholder="数値があれば数値で(○○% 改善 等)、なければ定性的に(Phase 4 で AI 下書きに対応予定)"
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => workExperiencesArray.append(buildEmptyWorkExperience())}
          disabled={isPending}
        >
          + 職歴を追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション4:スキル                           */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">スキル</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            言語・フレームワーク・ツール・ソフトスキル・ドメイン知識など
          </p>
        </div>

        {skillsArray.fields.length === 0 && (
          <p className="text-muted-foreground text-sm">
            「+ スキルを追加」から 1 件ずつ追加してください
          </p>
        )}

        <div className="space-y-3">
          {skillsArray.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]"
            >
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">カテゴリ</Label>}
                <select
                  {...register(`body.skills.${index}.category`)}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                >
                  {skillCategories.map((c) => (
                    <option key={c} value={c}>
                      {skillCategoryLabels[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && (
                  <Label className="text-xs">
                    スキル名 <span className="text-red-600">*</span>
                  </Label>
                )}
                <Input
                  {...register(`body.skills.${index}.name`)}
                  disabled={isPending}
                  placeholder="例:TypeScript、Figma、ファシリテーション"
                />
                {errors.body?.skills?.[index]?.name && (
                  <p className="text-xs text-red-600">{errors.body.skills[index]?.name?.message}</p>
                )}
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">レベル</Label>}
                <select
                  {...register(`body.skills.${index}.level`, { setValueAs: emptyToNullString })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                >
                  <option value="">—</option>
                  {skillLevels.map((l) => (
                    <option key={l} value={l}>
                      {skillLevelLabels[l]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => skillsArray.remove(index)}
                disabled={isPending}
                aria-label={`スキル ${index + 1} を削除`}
              >
                削除
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => skillsArray.append(buildEmptySkill())}
          disabled={isPending}
        >
          + スキルを追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション5:自己PR                           */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">自己PR</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            強み・働き方の方針・今後のキャリア展望など(Phase 4 で AI 下書きに対応予定)
          </p>
        </div>
        <Textarea
          {...register("body.self_pr")}
          disabled={isPending}
          rows={6}
          placeholder="例:ユーザー視点での課題抽出を強みとしてきました..."
        />
      </Card>

      {/* ============================================ */}
      {/* フッター:戻る / 削除 / 保存                  */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          render={<Link href="/app/cvs" />}
          disabled={isPending || isDeleting}
        >
          戻る
        </Button>
        <div className="flex gap-2">
          {mode === "edit" && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={isPending || isDeleting}
              aria-label="この職務経歴書を削除"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {isDeleting ? "削除中..." : "削除"}
            </Button>
          )}
          <Button type="submit" disabled={isPending || isDeleting}>
            {isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ====================================================================
// PeriodInput:{ year, month } 用の年・月セレクタ
//
// 設計:
//   - 親(Controller の value)に対しては「両方揃った時だけ PeriodPoint、
//     それ以外は null」を返す(zod 型を保つため)
//   - 「年だけ選んだ」「月だけ選んだ」のような部分入力は内部 state で保持し、
//     UI 上で消えないようにする(下書き編集中の手触りを改善)
//
// 表示優先順:
//   - 親から確定値(value: PeriodPoint)が来ていればそれを表示
//   - 来ていなければ(value=null)、内部 state の部分入力を表示
//
// 外部リセット(form reset / field array remove+add)で value=null になっても、
// 同じインスタンスが残れば内部 state は前回の入力を保持する。これはユーザーが
// セルを編集し直しているケースでは自然な挙動になる(部分入力を再開できる)。
// ====================================================================
function PeriodInput({
  value,
  onChange,
  disabled,
}: {
  value: PeriodPoint | null;
  onChange: (v: PeriodPoint | null) => void;
  disabled?: boolean;
}) {
  // 部分入力の保持。親が PeriodPoint を返している間は使われず、value=null の時だけ
  // フォールバックとして UI に表示される。
  const [pendingYear, setPendingYear] = useState<string>(
    value?.year != null ? String(value.year) : "",
  );
  const [pendingMonth, setPendingMonth] = useState<string>(
    value?.month != null ? String(value.month) : "",
  );

  const yearStr = value?.year != null ? String(value.year) : pendingYear;
  const monthStr = value?.month != null ? String(value.month) : pendingMonth;

  const emit = (y: string, m: string) => {
    setPendingYear(y);
    setPendingMonth(m);
    if (y === "" || m === "") {
      onChange(null);
      return;
    }
    onChange({ year: Number(y), month: Number(m) });
  };

  return (
    <div className="grid grid-cols-[1fr_5rem] gap-1">
      <select
        value={yearStr}
        onChange={(e) => emit(e.target.value, monthStr)}
        disabled={disabled}
        className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
        aria-label="年"
      >
        <option value="">年 —</option>
        {YEAR_OPTIONS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        value={monthStr}
        onChange={(e) => emit(yearStr, e.target.value)}
        disabled={disabled}
        className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
        aria-label="月"
      >
        <option value="">月</option>
        {MONTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

// ====================================================================
// ヘルパー
// ====================================================================

/**
 * 既存 Cv → フォーム初期値(snake_case + body)。新規時は空デフォルト。
 *
 * react-hook-form の defaultValues は再レンダーで差し替わらないので、
 * existing がある時はその時点のスナップショットを使う前提(履歴書と同じ)。
 */
function buildDefaultValues(existing: Cv | undefined): SaveCvRequest {
  if (!existing) {
    return {
      title: "",
      document_date: "",
      license_resume_id: null,
      body: {
        summary: "",
        work_experiences: [],
        skills: [],
        self_pr: "",
      },
    };
  }
  return {
    title: existing.title,
    document_date: existing.documentDate ?? "",
    license_resume_id: existing.licenseResumeId,
    body: existing.body,
  };
}

function buildEmptyWorkExperience() {
  return {
    company_name: "",
    industry: null,
    period_start: null,
    period_end: null,
    position: null,
    employment_type: null,
    job_description: "",
    achievements: "",
  } as const;
}

function buildEmptySkill() {
  return {
    category: "language",
    name: "",
    level: null,
    description: null,
  } as const;
}

/**
 * <select> や <input> の空文字を null に正規化する。
 * zod の nullable() に乗せるための setValueAs。
 */
function emptyToNullString(v: unknown): string | null {
  if (typeof v !== "string") return v as string | null;
  return v === "" ? null : v;
}
