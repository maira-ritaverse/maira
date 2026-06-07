"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { careerProfileSchema, type CareerProfile } from "@/lib/career/profile-schema";

/**
 * キャリア棚卸し結果(career_profile)の編集フォーム
 *
 * - diagnosis(キャリア診断結果)は編集対象外。フォームに出さず、保存時にも送らない。
 *   サーバ側(/api/career/profile)で saveCareerProfile に渡すと、既存 diagnosis は
 *   関数内のマージで自動的に保持される(lib/career/conversations.ts:218-224)。
 * - strengths(object 配列)は useFieldArray で素直に扱う。
 * - values / wants.industries / wants.role_types / wants.company_sizes / concerns は
 *   string 配列。rhf の useFieldArray は要素オブジェクトを要求するため、
 *   Controller でラップした StringListField(下に定義)で吸収する。
 * - フォームの zod スキーマは profile-schema の careerProfileSchema を再利用し、
 *   編集 UI に出さない diagnosis を omit する(新スキーマは作らない)。
 */

// 編集フォームで扱う型(diagnosis を除いた career_profile)
const editFormSchema = careerProfileSchema.omit({ diagnosis: true });
type EditFormValues = z.infer<typeof editFormSchema>;

// strengths の category は enum。option を定数化して UI を保守する。
const STRENGTH_CATEGORIES = [
  { value: "hard_skill", label: "技術スキル" },
  { value: "soft_skill", label: "ソフトスキル" },
  { value: "experience", label: "経験" },
] as const;

type Props = {
  initial: CareerProfile;
};

export function CareerProfileEditForm({ initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: buildDefaultValues(initial),
  });

  const strengthsArray = useFieldArray({ control, name: "strengths" });

  const onSubmit = (data: EditFormValues) => {
    startTransition(async () => {
      setServerError(null);
      try {
        const response = await fetch("/api/career/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(json.message ?? json.error ?? "保存に失敗しました");
        }

        // 一覧に戻すと「最終更新」と version が反映されて分かりやすい(結果ページよりも変化が見える)
        router.push("/app/career");
        router.refresh();
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "通信エラーが発生しました");
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

      <p className="text-muted-foreground text-xs">
        診断結果(キャリア軸・適性スコア)はこのフォームでは編集できません。再診断でのみ更新されます。
      </p>

      {/* ============================================ */}
      {/* サマリー                                       */}
      {/* ============================================ */}
      <Card className="space-y-3 p-6">
        <div>
          <h2 className="text-lg font-semibold">サマリー</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            この人物の総評(2-3 文)。他モジュール(AI 下書き等)が文脈として参照します
          </p>
        </div>
        <Textarea {...register("summary")} disabled={isPending} rows={4} />
        {errors.summary && <p className="text-sm text-red-600">{errors.summary.message}</p>}
      </Card>

      {/* ============================================ */}
      {/* 基本情報(user_facts)                          */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">基本情報</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="current_role">現在の職種</Label>
            <Input
              id="current_role"
              {...register("user_facts.current_role", { setValueAs: emptyToNullString })}
              disabled={isPending}
              placeholder="例:プロダクトマネージャー"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="years_of_experience">経験年数</Label>
            <Input
              id="years_of_experience"
              type="number"
              min={0}
              step={1}
              {...register("user_facts.years_of_experience", {
                setValueAs: emptyToNullNumber,
              })}
              disabled={isPending}
              placeholder="例:5"
            />
            {errors.user_facts?.years_of_experience && (
              <p className="text-sm text-red-600">
                {errors.user_facts.years_of_experience.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="industry">業界</Label>
            <Input
              id="industry"
              {...register("user_facts.industry", { setValueAs: emptyToNullString })}
              disabled={isPending}
              placeholder="例:SaaS"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="company_size">会社規模</Label>
            <Input
              id="company_size"
              {...register("user_facts.company_size", { setValueAs: emptyToNullString })}
              disabled={isPending}
              placeholder="例:100-500名"
            />
          </div>
        </div>
      </Card>

      {/* ============================================ */}
      {/* 強み(strengths、object 配列)                  */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">強み</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            ラベル(短い表現)・エビデンス(裏付ける具体例)・カテゴリの 3 つを入力します
          </p>
        </div>

        {strengthsArray.fields.length === 0 && (
          <p className="text-muted-foreground text-sm">
            「+ 強みを追加」から 1 件ずつ追加してください
          </p>
        )}

        <div className="space-y-4">
          {strengthsArray.fields.map((field, index) => (
            <div key={field.id} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">強み {index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => strengthsArray.remove(index)}
                  disabled={isPending}
                  aria-label={`強み ${index + 1} を削除`}
                >
                  削除
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-1">
                  <Label htmlFor={`strength-${index}-label`}>ラベル</Label>
                  <Input
                    id={`strength-${index}-label`}
                    {...register(`strengths.${index}.label`)}
                    disabled={isPending}
                    placeholder="例:ユーザー視点の機能設計"
                  />
                  {errors.strengths?.[index]?.label && (
                    <p className="text-sm text-red-600">
                      {errors.strengths[index]?.label?.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`strength-${index}-category`}>カテゴリ</Label>
                  <select
                    id={`strength-${index}-category`}
                    {...register(`strengths.${index}.category`)}
                    disabled={isPending}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {STRENGTH_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`strength-${index}-evidence`}>エビデンス</Label>
                <Textarea
                  id={`strength-${index}-evidence`}
                  {...register(`strengths.${index}.evidence`)}
                  disabled={isPending}
                  rows={2}
                  placeholder="この強みを裏付ける具体例"
                />
                {errors.strengths?.[index]?.evidence && (
                  <p className="text-sm text-red-600">
                    {errors.strengths[index]?.evidence?.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => strengthsArray.append({ label: "", evidence: "", category: "hard_skill" })}
          disabled={isPending}
        >
          + 強みを追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* 価値観(values、string 配列)                    */}
      {/* ============================================ */}
      <Card className="space-y-3 p-6">
        <div>
          <h2 className="text-lg font-semibold">大切にしている価値観</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            仕事で大切にしていることを 1 行 1 つで
          </p>
        </div>
        <Controller
          control={control}
          name="values"
          render={({ field }) => (
            <StringListField
              value={field.value ?? []}
              onChange={field.onChange}
              disabled={isPending}
              placeholder="例:正直であること"
              addLabel="+ 価値観を追加"
            />
          )}
        />
      </Card>

      {/* ============================================ */}
      {/* 希望(wants、string 配列 ×3)                    */}
      {/* ============================================ */}
      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-lg font-semibold">次のキャリアで求めること</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            業界・職種・会社規模をそれぞれ複数登録できます
          </p>
        </div>

        <div className="space-y-2">
          <Label>希望する業界</Label>
          <Controller
            control={control}
            name="wants.industries"
            render={({ field }) => (
              <StringListField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={isPending}
                placeholder="例:SaaS"
                addLabel="+ 業界を追加"
              />
            )}
          />
        </div>

        <div className="space-y-2">
          <Label>希望する職種・役割</Label>
          <Controller
            control={control}
            name="wants.role_types"
            render={({ field }) => (
              <StringListField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={isPending}
                placeholder="例:プロダクトマネージャー"
                addLabel="+ 職種を追加"
              />
            )}
          />
        </div>

        <div className="space-y-2">
          <Label>希望する会社規模</Label>
          <Controller
            control={control}
            name="wants.company_sizes"
            render={({ field }) => (
              <StringListField
                value={field.value ?? []}
                onChange={field.onChange}
                disabled={isPending}
                placeholder="例:100-500名"
                addLabel="+ 会社規模を追加"
              />
            )}
          />
        </div>
      </Card>

      {/* ============================================ */}
      {/* 懸念(concerns、string 配列)                    */}
      {/* ============================================ */}
      <Card className="space-y-3 p-6">
        <div>
          <h2 className="text-lg font-semibold">気にしている点</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            懸念や自信のないこと(空でも構いません)
          </p>
        </div>
        <Controller
          control={control}
          name="concerns"
          render={({ field }) => (
            <StringListField
              value={field.value ?? []}
              onChange={field.onChange}
              disabled={isPending}
              placeholder="例:マネジメント経験が浅い"
              addLabel="+ 懸念を追加"
            />
          )}
        />
      </Card>

      {/* ============================================ */}
      {/* フッター:戻る / 保存                          */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          render={<Link href="/app/career" />}
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
// 既存 CareerProfile から編集フォームの初期値を構築する。
// diagnosis は除外する(編集フォームでは扱わない)。
// ====================================================================
function buildDefaultValues(initial: CareerProfile): EditFormValues {
  return {
    user_facts: { ...initial.user_facts },
    strengths: initial.strengths.map((s) => ({ ...s })),
    values: [...initial.values],
    wants: {
      industries: [...initial.wants.industries],
      role_types: [...initial.wants.role_types],
      company_sizes: [...initial.wants.company_sizes],
    },
    concerns: [...initial.concerns],
    summary: initial.summary,
  };
}

// number input は空文字を返してくる。null 許容スキーマに合わせて変換する。
function emptyToNullNumber(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 任意 string 入力で空文字 → null に正規化(user_facts.* の nullable 化のため)
function emptyToNullString(v: unknown): string | null {
  if (typeof v !== "string") return v as string | null;
  return v.trim() === "" ? null : v;
}

// ====================================================================
// StringListField:string 配列を「1 行 1 要素」で編集する小さなコンポーネント
//
// 設計:
// - rhf の useFieldArray は要素を object として扱うため、string 配列に直接は使えない。
// - その代わりに Controller でラップしてもらい、内部は完全制御で string[] を扱う。
// - cv-form の PeriodInput と同じく、親には常に正しい型(string[])を返す。
// - 行追加は「+ 追加」ボタンで空文字 1 つ追加。削除は各行の「削除」ボタン。
// - 保存時の空白だけの行は zod 側で受け入れる(string 任意)。除去は今は行わない
//   (UI で見えている文字数と保存される文字列を一致させたいため)。
// ====================================================================
function StringListField({
  value,
  onChange,
  disabled,
  placeholder,
  addLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  addLabel: string;
}) {
  const updateAt = (index: number, next: string) => {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  };

  const removeAt = (index: number) => {
    const copy = [...value];
    copy.splice(index, 1);
    onChange(copy);
  };

  const append = () => {
    onChange([...value, ""]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-muted-foreground text-sm">未登録</p>
      ) : (
        <ul className="space-y-2">
          {value.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                value={item}
                onChange={(e) => updateAt(index, e.target.value)}
                disabled={disabled}
                placeholder={placeholder}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={`${index + 1} 行目を削除`}
              >
                削除
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={append} disabled={disabled}>
        {addLabel}
      </Button>
    </div>
  );
}
