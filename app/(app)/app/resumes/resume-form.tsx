"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
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

/** AI下書き生成の対象フィールド(API側と一致させる) */
type DraftField = "motivation_note" | "personal_requests";
const DRAFT_FIELD_TO_API: Record<DraftField, "motivation" | "personal_requests"> = {
  motivation_note: "motivation",
  personal_requests: "personal_requests",
};
const DRAFT_FIELD_LABEL: Record<DraftField, string> = {
  motivation_note: "志望の動機・アピールポイント",
  personal_requests: "本人希望記入欄",
};

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

type Props = ({ mode: "create"; existing?: undefined } | { mode: "edit"; existing: Resume }) & {
  /**
   * このユーザーの career_profile が存在するか。
   * AI下書き生成ボタンを有効化するかの判定に使う(なければボタンは無効化)。
   */
  hasCareerProfile: boolean;
};

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
  const { mode, existing, hasCareerProfile } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // AI下書き生成中のフィールド(同時押し防止と、押した側だけスピナーを出すため)
  const [draftingField, setDraftingField] = useState<DraftField | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<SaveResumeRequest>({
    resolver: zodResolver(saveResumeRequestSchema),
    defaultValues: buildDefaultValues(existing),
  });

  /**
   * AI下書き生成を呼び、結果を該当フィールドに setValue する。
   *
   * 既存の入力がある場合は confirm で上書きの意思を確認する
   * (生成内容で勝手に書き換えると、書きかけの文章が失われる懸念がある)。
   */
  const handleGenerateDraft = async (field: DraftField) => {
    setDraftError(null);

    const currentValue = (getValues(field) ?? "").trim();
    if (currentValue.length > 0) {
      const ok = window.confirm(
        `「${DRAFT_FIELD_LABEL[field]}」には既に入力があります。AIの下書きで上書きしてもよろしいですか?\n\n(現在の入力は失われます)`,
      );
      if (!ok) return;
    }

    setDraftingField(field);
    try {
      const response = await fetch("/api/resumes/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: DRAFT_FIELD_TO_API[field] }),
      });

      const json = (await response.json()) as {
        content?: string;
        message?: string;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        if (json.code === "no_career_profile") {
          setDraftError(
            "先にキャリア棚卸しを完了してください。棚卸し結果を元にAIが下書きを作成します。",
          );
        } else {
          setDraftError(json.message ?? json.error ?? "下書き生成に失敗しました");
        }
        return;
      }

      if (json.content) {
        // shouldDirty: true で未保存マークが付き、ユーザーに「保存が必要」と気付きやすくなる
        setValue(field, json.content, { shouldDirty: true });
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDraftingField(null);
    }
  };

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
            <Label htmlFor="document_date">履歴書作成日</Label>
            <Input
              id="document_date"
              type="date"
              {...register("document_date")}
              disabled={isPending}
            />
            {/* 提出日を意図して設定したい人向け。未入力でも壊れないよう、表示時は今日にフォールバック。 */}
            <p className="text-muted-foreground text-xs">
              未入力の場合は表示時点の本日の日付になります
            </p>
          </div>
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
          {/* 厚労省様式では番地・建物名にはフリガナを振らない慣習なので明示。 */}
          <p className="text-muted-foreground text-xs">
            町名までのふりがなで構いません(番地・建物名は不要)
          </p>
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
          <p className="text-muted-foreground text-xs">
            町名までのふりがなで構いません(番地・建物名は不要)
          </p>
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

      {/* AI下書き生成のエラー表示(両セクション共通) */}
      {draftError && (
        <Alert variant="destructive">
          <AlertDescription>AI下書き生成エラー: {draftError}</AlertDescription>
        </Alert>
      )}

      {/* ============================================ */}
      {/* セクション4:志望の動機・特技・アピールポイント */}
      {/*                                                 */}
      {/* 厚労省様式の自由記述欄(本人希望記入欄とは別欄)。*/}
      {/* 順序は厚労省様式に合わせ「志望動機 → 本人希望」 */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">志望の動機・特技・アピールポイント</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              志望の動機、特技、好きな学科、自己PRなど自由に記入
            </p>
          </div>
          <AIDraftButton
            field="motivation_note"
            isDrafting={draftingField === "motivation_note"}
            disabled={isPending || draftingField !== null}
            hasCareerProfile={hasCareerProfile}
            onClick={() => handleGenerateDraft("motivation_note")}
          />
        </div>
        <Textarea
          {...register("motivation_note")}
          disabled={isPending || draftingField === "motivation_note"}
          rows={6}
          placeholder="例:貴社の○○という事業に共感し..."
        />
        <p className="text-muted-foreground text-xs">
          AIで下書きを生成した場合も、内容は必ずご自身で確認・編集してください。
        </p>
      </Card>

      {/* ============================================ */}
      {/* セクション5:本人希望記入欄                   */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">本人希望記入欄</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              希望職種・勤務時間・勤務地など、特記したい事項があれば記入
            </p>
          </div>
          <AIDraftButton
            field="personal_requests"
            isDrafting={draftingField === "personal_requests"}
            disabled={isPending || draftingField !== null}
            hasCareerProfile={hasCareerProfile}
            onClick={() => handleGenerateDraft("personal_requests")}
          />
        </div>
        <Textarea
          {...register("personal_requests")}
          disabled={isPending || draftingField === "personal_requests"}
          rows={5}
          placeholder="特になければ「貴社規定に従います」など"
        />
        <p className="text-muted-foreground text-xs">
          AIで下書きを生成した場合も、内容は必ずご自身で確認・編集してください。
        </p>
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
// AI下書き生成ボタン
// ====================================================================

/**
 * 「✨AIで下書き生成」ボタン。
 *
 * career_profile が無い場合は disabled にし、tooltip 代わりの title 属性に
 * 「先に棚卸しを」の案内を出す(ホバーで分かる)。Linkで棚卸しへ誘導する
 * 文言は、ボタン下部のテキストではなく、無効状態のヒントに留めることで
 * フォームのレイアウトを乱さないようにする。
 */
function AIDraftButton({
  field,
  isDrafting,
  disabled,
  hasCareerProfile,
  onClick,
}: {
  field: DraftField;
  isDrafting: boolean;
  disabled: boolean;
  hasCareerProfile: boolean;
  onClick: () => void;
}) {
  const profileMissing = !hasCareerProfile;

  if (profileMissing) {
    // 棚卸し未実施:ボタンを無効にしつつ、棚卸しへの導線を1行で示す
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" size="sm" disabled aria-disabled="true">
          <Sparkles className="mr-1 h-4 w-4" />
          AIで下書き
        </Button>
        <p className="text-muted-foreground text-xs">
          <Link href="/app/career" className="underline hover:no-underline">
            キャリア棚卸し
          </Link>
          を完了すると利用できます
        </p>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${DRAFT_FIELD_LABEL[field]}のAI下書きを生成`}
    >
      <Sparkles className="mr-1 h-4 w-4" />
      {isDrafting ? "生成中..." : "AIで下書き"}
    </Button>
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
      document_date: "",
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
    document_date: existing.documentDate ?? "",
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
