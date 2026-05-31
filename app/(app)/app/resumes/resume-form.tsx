"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  genderLabels,
  saveResumeRequestSchema,
  type Gender,
  type Resume,
  type SaveResumeRequest,
} from "@/lib/resumes/types";

/**
 * 履歴書 新規作成・編集 フォーム(共通)
 *
 * - 必須は title だけ(他は下書き保存可能)
 * - 学歴・職歴 / 免許・資格は useFieldArray で動的な行追加
 * - mode="create" → POST /api/resumes、成功で /app/resumes/[id] へ
 * - mode="edit"   → PATCH /api/resumes/[id]、成功でフォームに留まる
 *
 * 入力プロパティ名はサーバー側スキーマと一致させるため snake_case。
 * (camelCase に変換するレイヤを増やさず、API への送信時にそのまま JSON にできる)
 */

type Props = { mode: "create"; existing?: undefined } | { mode: "edit"; existing: Resume };

// 学歴・職歴/免許資格の年・月セレクタ用
const YEAR_OPTIONS = (() => {
  const now = new Date().getFullYear();
  const years: number[] = [];
  // 1960 〜 現在+5年 まで。狭すぎても広すぎてもストレスなので。
  for (let y = now + 5; y >= 1960; y--) years.push(y);
  return years;
})();
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: genderLabels.male },
  { value: "female", label: genderLabels.female },
  { value: "unspecified", label: genderLabels.unspecified },
];

export function ResumeForm(props: Props) {
  const { mode, existing } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<SaveResumeRequest>({
    resolver: zodResolver(saveResumeRequestSchema),
    defaultValues: buildDefaultValues(existing),
  });

  const educationFieldArray = useFieldArray({
    control,
    name: "education_history",
  });

  const licenseFieldArray = useFieldArray({
    control,
    name: "licenses",
  });

  const onSubmit = (data: SaveResumeRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSaveMessage(null);
      try {
        const url = mode === "create" ? "/api/resumes" : `/api/resumes/${existing.id}`;
        const method = mode === "create" ? "POST" : "PATCH";

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = (await response.json()) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "Save failed");
        }

        if (mode === "create") {
          const result = (await response.json()) as { id: string };
          router.push(`/app/resumes/${result.id}`);
        } else {
          setSaveMessage("保存しました");
          router.refresh();
        }
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

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
      {/* セクション1:管理用 + 基本情報                */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">基本情報</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            必須はタイトルのみ。他は途中まで入力して保存できます(下書き)
          </p>
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">氏名</Label>
            <Input
              id="name"
              {...register("name")}
              disabled={isPending}
              placeholder="例:山田 太郎"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name_kana">フリガナ</Label>
            <Input
              id="name_kana"
              {...register("name_kana")}
              disabled={isPending}
              placeholder="例:ヤマダ タロウ"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="birth_date">生年月日</Label>
            <Input id="birth_date" type="date" {...register("birth_date")} disabled={isPending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gender">性別</Label>
            <select
              id="gender"
              {...register("gender")}
              disabled={isPending}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              defaultValue={existing?.gender ?? ""}
            >
              <option value="">未選択</option>
              {GENDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="postal_code">郵便番号</Label>
          <Input
            id="postal_code"
            {...register("postal_code")}
            disabled={isPending}
            placeholder="例:100-0001"
            className="sm:w-48"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">現住所</Label>
          <Input
            id="address"
            {...register("address")}
            disabled={isPending}
            placeholder="例:東京都千代田区..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address_kana">現住所(フリガナ)</Label>
          <Input
            id="address_kana"
            {...register("address_kana")}
            disabled={isPending}
            placeholder="例:トウキョウト チヨダク..."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="phone">電話番号</Label>
            <Input
              id="phone"
              type="tel"
              {...register("phone")}
              disabled={isPending}
              placeholder="例:090-1234-5678"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              {...register("email")}
              disabled={isPending}
              placeholder="例:taro@example.com"
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact_address">連絡先(現住所と異なる場合)</Label>
          <Input
            id="contact_address"
            {...register("contact_address")}
            disabled={isPending}
            placeholder="任意。現住所と同じ場合は空欄"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact_address_kana">連絡先(フリガナ)</Label>
          <Input
            id="contact_address_kana"
            {...register("contact_address_kana")}
            disabled={isPending}
            placeholder="任意"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact_phone">連絡先 電話番号</Label>
          <Input
            id="contact_phone"
            type="tel"
            {...register("contact_phone")}
            disabled={isPending}
            placeholder="任意"
            className="sm:w-64"
          />
        </div>
      </Card>

      {/* ============================================ */}
      {/* セクション2:学歴・職歴                       */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">学歴・職歴</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            時系列で入力してください。「学歴」「職歴」の見出し行も内容欄に書けます
          </p>
        </div>

        <div className="space-y-3">
          {educationFieldArray.fields.length === 0 && (
            <p className="text-muted-foreground text-sm">「+ 行を追加」から入力してください</p>
          )}

          {educationFieldArray.fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[5rem_4rem_1fr_auto] items-end gap-2">
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">年</Label>}
                <select
                  {...register(`education_history.${index}.year`, {
                    setValueAs: nullableNumber,
                  })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                  defaultValue={field.year ?? ""}
                >
                  <option value="">—</option>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">月</Label>}
                <select
                  {...register(`education_history.${index}.month`, {
                    setValueAs: nullableNumber,
                  })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                  defaultValue={field.month ?? ""}
                >
                  <option value="">—</option>
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">内容</Label>}
                <Input
                  {...register(`education_history.${index}.description`)}
                  disabled={isPending}
                  placeholder="例:○○大学 ○○学部 入学"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => educationFieldArray.remove(index)}
                disabled={isPending}
                aria-label={`${index + 1}行目を削除`}
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
          onClick={() =>
            educationFieldArray.append({
              year: null,
              month: null,
              description: "",
            })
          }
          disabled={isPending}
        >
          + 行を追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション3:免許・資格                       */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">免許・資格</h2>
        </div>

        <div className="space-y-3">
          {licenseFieldArray.fields.length === 0 && (
            <p className="text-muted-foreground text-sm">「+ 行を追加」から入力してください</p>
          )}

          {licenseFieldArray.fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[5rem_4rem_1fr_auto] items-end gap-2">
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">年</Label>}
                <select
                  {...register(`licenses.${index}.year`, {
                    setValueAs: nullableNumber,
                  })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                  defaultValue={field.year ?? ""}
                >
                  <option value="">—</option>
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">月</Label>}
                <select
                  {...register(`licenses.${index}.month`, {
                    setValueAs: nullableNumber,
                  })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                  defaultValue={field.month ?? ""}
                >
                  <option value="">—</option>
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">資格名</Label>}
                <Input
                  {...register(`licenses.${index}.name`)}
                  disabled={isPending}
                  placeholder="例:普通自動車第一種運転免許"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => licenseFieldArray.remove(index)}
                disabled={isPending}
                aria-label={`${index + 1}行目を削除`}
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
          onClick={() => licenseFieldArray.append({ year: null, month: null, name: "" })}
          disabled={isPending}
        >
          + 行を追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション4:志望の動機・特技・アピールポイント */}
      {/*                                                 */}
      {/* 厚労省様式の自由記述欄(本人希望記入欄とは別欄)。*/}
      {/* 順序は厚労省様式に合わせ「志望動機 → 本人希望」 */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">志望の動機・特技・アピールポイント</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            志望の動機、特技、好きな学科、自己PRなど自由に記入
          </p>
        </div>
        <Textarea
          {...register("motivation_note")}
          disabled={isPending}
          rows={6}
          placeholder="例:貴社の○○という事業に共感し..."
        />
      </Card>

      {/* ============================================ */}
      {/* セクション5:本人希望記入欄                   */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">本人希望記入欄</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            希望職種・勤務時間・勤務地など、特記したい事項があれば記入
          </p>
        </div>
        <Textarea
          {...register("personal_requests")}
          disabled={isPending}
          rows={5}
          placeholder="特になければ「貴社規定に従います」など"
        />
      </Card>

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          render={<Link href="/app/resumes" />}
          disabled={isPending}
        >
          戻る
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "保存中..." : "保存"}
        </Button>
      </div>
    </form>
  );
}

// ====================================================================
// ヘルパー
// ====================================================================

/**
 * 既存履歴書 → フォーム初期値(snake_case)。新規時は空のデフォルト。
 *
 * react-hook-form の defaultValues は再レンダーで差し替わらないので、
 * existing がある時はその時点のスナップショットを使う前提。
 */
function buildDefaultValues(existing: Resume | undefined): SaveResumeRequest {
  if (!existing) {
    return {
      title: "履歴書",
      name: "",
      name_kana: "",
      birth_date: "",
      gender: null,
      postal_code: "",
      address: "",
      address_kana: "",
      phone: "",
      email: "",
      contact_address: "",
      contact_address_kana: "",
      contact_phone: "",
      education_history: [],
      licenses: [],
      motivation_note: "",
      personal_requests: "",
    };
  }

  return {
    title: existing.title,
    name: existing.name ?? "",
    name_kana: existing.nameKana ?? "",
    birth_date: existing.birthDate ?? "",
    gender: existing.gender,
    postal_code: existing.postalCode ?? "",
    address: existing.address ?? "",
    address_kana: existing.addressKana ?? "",
    phone: existing.phone ?? "",
    email: existing.email ?? "",
    contact_address: existing.contactAddress ?? "",
    contact_address_kana: existing.contactAddressKana ?? "",
    contact_phone: existing.contactPhone ?? "",
    education_history: existing.educationHistory,
    licenses: existing.licenses,
    motivation_note: existing.motivationNote ?? "",
    personal_requests: existing.personalRequests ?? "",
  };
}

/**
 * <select> の value は string なので、空文字を null に、それ以外を number に変換する。
 * zod スキーマ側は number | null を期待しているため。
 */
function nullableNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
