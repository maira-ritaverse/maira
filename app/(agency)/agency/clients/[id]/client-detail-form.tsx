"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateClientRequestSchema,
  type UpdateClientRequest,
  type ClientRecordWithDecrypted,
  clientStatusLabels,
  clientCloseReasonLabels,
  clientGenderLabels,
  clientMaritalStatusLabels,
  clientEmploymentTypeLabels,
  clientFinalEducationLabels,
  clientJobChangeTimingLabels,
} from "@/lib/clients/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAgeLabel } from "@/lib/date/age";

/**
 * クライアント詳細編集フォーム
 *
 * new/client-form.tsx とほぼ同じ作りだが、初期値を既存レコードから取り、
 * PATCH /api/agency/clients/[id] を呼ぶ。保存成功時は router.refresh() で再取得。
 *
 * 担当アドバイザー変更は将来のメンバー一覧 UI と一緒に出すため、ここでは出さない
 * (API スキーマには既に assigned_member_id が含まれている)。
 *
 * EMPRO 拡張(マイグレーション 20260615100001)で 27 項目が追加され、フォームは
 * 折り畳み <details> セクションに分割。タグ配列(経験業種・希望業種等)はカンマ区切り
 * テキストで入力 → setValueAs で string[] に変換して PATCH に送る。
 */

type Props = {
  client: ClientRecordWithDecrypted;
  /** 求職者の証明写真(本人が履歴書登録した最新分。SSR で発行された署名 URL) */
  seekerPhoto?: {
    signedUrl: string;
    resumeId: string;
    resumeTitle: string;
    resumeUpdatedAt: string;
  } | null;
};

/**
 * カンマ区切り文字列 → string[] のパース(タグフィールド用)。
 * 空・空白のみのトークンは除外、前後空白を trim。
 *
 * 例:"IT, SaaS , FinTech" → ["IT", "SaaS", "FinTech"]
 * 例:"" → []
 *
 * react-hook-form の setValueAs で使うため、入力は unknown 型。
 * 文字列以外(undefined/null/配列)が渡ってきたケースも安全にハンドリング。
 */
function parseCsvTags(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ClientDetailForm({ client, seekerPhoto }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<UpdateClientRequest>({
    // updateClientRequestSchema は EMPRO 拡張で 40+ フィールドに膨らんだ結果、
    // 多数の `.or(z.literal(""))` の union が react-hook-form の Resolver 型推論
    // と非互換になるため、runtime 挙動は同等のままキャストで吸収する。
    // zod が runtime で正しい検証を行い、API ルートは UpdateClientRequest として
    // 受け取るので型安全性は失われない。
    resolver: zodResolver(updateClientRequestSchema) as unknown as Resolver<UpdateClientRequest>,
    defaultValues: {
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      status: client.status,
      notes: client.notes ?? "",
      close_reason: client.closeReason,
      email_distribution_enabled: client.emailDistributionEnabled,
      entry_site: client.entrySite ?? "",
      recommendation_comment: client.recommendationComment ?? "",
      other_agency_status: client.otherAgencyStatus ?? "",
      contact_method_preference: client.contactMethodPreference ?? "",

      // EMPRO 拡張の初期値(クライアントレコードから流し込み)
      name_kana: client.nameKana ?? "",
      birth_date: client.birthDate ?? "",
      gender: client.gender ?? "",
      nationality: client.nationality ?? "",
      marital_status: client.maritalStatus ?? "",
      postal_code: client.postalCode ?? "",
      prefecture: client.prefecture ?? "",
      city: client.city ?? "",
      street: client.street ?? "",
      building: client.building ?? "",
      phone2: client.phone2 ?? "",
      email2: client.email2 ?? "",
      current_employment_type: client.currentEmploymentType ?? "",
      current_annual_income: client.currentAnnualIncome,
      final_education: client.finalEducation ?? "",
      experience_industries: client.experienceIndustries,
      experience_occupations: client.experienceOccupations,
      desired_industries: client.desiredIndustries,
      desired_occupations: client.desiredOccupations,
      desired_locations: client.desiredLocations,
      desired_annual_income: client.desiredAnnualIncome,
      job_change_timing: client.jobChangeTiming ?? "",
      intake_date: client.intakeDate ?? "",
      first_meeting_date: client.firstMeetingDate ?? "",
      // CRM 自由タグ(20260615140001)。default は空配列で「タグ無し」。
      crm_tags: client.crmTags,
      // 暗号化対象の自由記述
      education_detail: client.educationDetail ?? "",
      skills: client.skills ?? "",
      job_change_reason: client.jobChangeReason ?? "",
      desired_conditions: client.desiredConditions ?? "",
      meeting_notes: client.meetingNotes ?? "",
      status_memo: client.statusMemo ?? "",
    },
  });

  // 生年 月日 の 入力 値 を リアル タイム 監視 し、 「満 X 歳」 の ラベル を Label 横 に 出す。
  // watch() は memo 化 でき ない 警告 が 出る ので、 useWatch を 使う。
  const watchedBirthDate = useWatch({ control, name: "birth_date" });
  const birthDateAgeLabel = formatAgeLabel(
    typeof watchedBirthDate === "string" ? watchedBirthDate : undefined,
  );

  const onSubmit = (data: UpdateClientRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSuccessMessage(null);
      try {
        const response = await fetch(`/api/agency/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "保存に失敗しました");
        }
        setSuccessMessage("保存しました");
        router.refresh();
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {serverError}</AlertDescription>
          </Alert>
        )}
        {successMessage && (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {/*
          証明写真(本人が履歴書に登録した最新分)をフォーム左上に配置。
          写真ありなら 3:4 サムネ + 履歴書リンク、未登録なら控えめなプレースホルダ。
          詳細編集の冒頭で「相手の顔」が見える状態を作る。
        */}
        <div className="border-input bg-muted/30 flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
          <div className="border-input bg-background relative aspect-3/4 w-20 shrink-0 overflow-hidden rounded-md border">
            {seekerPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={seekerPhoto.signedUrl}
                alt={`${client.name} の証明写真`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-muted-foreground flex h-full w-full items-center justify-center text-[10px] leading-tight">
                写真
                <br />
                未登録
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs">
            {seekerPhoto ? (
              <>
                <p className="text-foreground truncate text-sm font-medium">
                  {seekerPhoto.resumeTitle}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  本人登録 ・ 更新:
                  {new Date(seekerPhoto.resumeUpdatedAt).toLocaleDateString("ja-JP")}
                </p>
                <Link
                  href={`/agency/clients/${client.id}/resumes/${seekerPhoto.resumeId}`}
                  className="text-foreground mt-1 inline-block text-[11px] underline-offset-4 hover:underline"
                >
                  履歴書を開く →
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">求職者は履歴書に証明写真を登録していません。</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">
            氏名 <span className="text-red-600">*</span>
          </Label>
          <Input id="name" {...register("name")} disabled={isPending} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">メールアドレス</Label>
          <Input id="email" type="email" {...register("email")} disabled={isPending} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          <p className="text-muted-foreground text-xs">
            任意入力。登録しておくと招待メール送信や、求職者が同じメールで Myaira に
            登録した際の自動連携に使えます。未入力にしたい場合は空欄で保存してください。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">電話番号</Label>
          <Input
            id="phone"
            {...register("phone")}
            disabled={isPending}
            placeholder="例:090-1234-5678"
          />
          {errors.phone && <p className="text-sm text-red-600">{errors.phone.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">ステータス</Label>
          <select
            id="status"
            {...register("status")}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {Object.entries(clientStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">メモ</Label>
          <textarea
            id="notes"
            {...register("notes")}
            disabled={isPending}
            rows={6}
            placeholder="面談メモ、希望条件など"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors.notes && <p className="text-sm text-red-600">{errors.notes.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="close_reason">クローズ理由</Label>
          <select
            id="close_reason"
            {...register("close_reason", {
              // <select> の "" を null に変換(z.nullable() スキーマと合わせるため)
              setValueAs: (v) => (v === "" ? null : v),
            })}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">(未設定)</option>
            {Object.entries(clientCloseReasonLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            失注分析・KPI 集計に使われます。成約や辞退の理由をカテゴリで残してください。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email_distribution_enabled" className="flex items-center gap-2">
            <input
              id="email_distribution_enabled"
              type="checkbox"
              {...register("email_distribution_enabled")}
              disabled={isPending}
              className="size-4"
            />
            <span>MA 自動配信を許可する</span>
          </Label>
          <p className="text-muted-foreground text-xs">
            チェックを外すと、この求職者はマーケティングオートメーション(MA)による
            自動配信の対象から除外されます(手動メールや「テスト送信」は影響を受けません)。
          </p>
        </div>

        {/* エージェント業務メタ情報。暗号化フィールドは「個人情報・社外秘」前提でラベルを付ける。
            空文字 → null で保存される(API ルート側で正規化)。 */}
        <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/50 p-4">
          <p className="text-sm font-semibold text-slate-700">
            エージェント業務メモ(社外秘・暗号化保存)
          </p>
          <p className="text-muted-foreground text-xs">
            推薦コメント・他社利用状況・連絡方法希望は AES-256-GCM で暗号化されて保存されます。
            <br />
            DB 直接閲覧では復号できず、Myaira の管理画面からのみ可読です。
          </p>

          <div className="space-y-2">
            <Label htmlFor="recommendation_comment">推薦コメント</Label>
            <textarea
              id="recommendation_comment"
              {...register("recommendation_comment")}
              disabled={isPending}
              rows={4}
              placeholder="企業向けの推薦文(求人提案時に同梱したい内容)"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {errors.recommendation_comment && (
              <p className="text-sm text-red-600">{errors.recommendation_comment.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="other_agency_status">他社エージェント利用状況</Label>
            <textarea
              id="other_agency_status"
              {...register("other_agency_status")}
              disabled={isPending}
              rows={3}
              placeholder="例:A社・B社で並行支援中、Cで応募1件選考中 など"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {errors.other_agency_status && (
              <p className="text-sm text-red-600">{errors.other_agency_status.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_method_preference">連絡方法希望</Label>
            <textarea
              id="contact_method_preference"
              {...register("contact_method_preference")}
              disabled={isPending}
              rows={2}
              placeholder="例:平日夜間のみ LINE、休日は不可 など"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {errors.contact_method_preference && (
              <p className="text-sm text-red-600">{errors.contact_method_preference.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="entry_site">エントリーサイト</Label>
          <Input
            id="entry_site"
            {...register("entry_site")}
            disabled={isPending}
            placeholder="例:リクナビ、ビズリーチ、自社サイト"
          />
          <p className="text-muted-foreground text-xs">
            集計・チャネル分析用。出典の媒体名をシンプルに記入してください。
          </p>
          {errors.entry_site && <p className="text-sm text-red-600">{errors.entry_site.message}</p>}
        </div>

        {/* ────────────────────────────────────────────
            EMPRO 準拠の名簿拡張(全 27 項目を 6 セクションに分けて折り畳み表示)。
            <details> は HTML 標準なので追加依存なし。検索性重視で deafult open。
            「未入力で保存」を許す下書きセマンティクスを維持し、空文字は API 側で
            null に正規化される。
            ──────────────────────────────────────────── */}

        <details className="space-y-3 rounded-md border p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            基本属性(氏名カナ / 生年月日 / 性別など)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name_kana">氏名カナ</Label>
              <Input
                id="name_kana"
                {...register("name_kana")}
                disabled={isPending}
                placeholder="例:タナカ タロウ"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_date">
                生年月日
                {birthDateAgeLabel && (
                  <span className="text-muted-foreground ml-2 text-xs">({birthDateAgeLabel})</span>
                )}
              </Label>
              <Input id="birth_date" type="date" {...register("birth_date")} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">性別</Label>
              <select
                id="gender"
                {...register("gender", { setValueAs: (v) => (v === "" ? null : v) })}
                disabled={isPending}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">(未設定)</option>
                {Object.entries(clientGenderLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nationality">国籍</Label>
              <Input
                id="nationality"
                {...register("nationality")}
                disabled={isPending}
                placeholder="例:日本"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="marital_status">配偶者</Label>
              <select
                id="marital_status"
                {...register("marital_status", { setValueAs: (v) => (v === "" ? null : v) })}
                disabled={isPending}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">(未設定)</option>
                {Object.entries(clientMaritalStatusLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </details>

        <details className="space-y-3 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">住所</summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[10rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="postal_code">郵便番号</Label>
                <Input
                  id="postal_code"
                  {...register("postal_code")}
                  disabled={isPending}
                  placeholder="100-0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prefecture">都道府県</Label>
                <Input
                  id="prefecture"
                  {...register("prefecture")}
                  disabled={isPending}
                  placeholder="例:東京都"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">市区町村</Label>
              <Input id="city" {...register("city")} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="street">番地</Label>
              <Input id="street" {...register("street")} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="building">建物名・部屋番号</Label>
              <Input id="building" {...register("building")} disabled={isPending} />
            </div>
          </div>
        </details>

        <details className="space-y-3 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            副連絡先
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone2">副電話</Label>
              <Input id="phone2" {...register("phone2")} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email2">副メール</Label>
              <Input id="email2" type="email" {...register("email2")} disabled={isPending} />
              {errors.email2 && <p className="text-sm text-red-600">{errors.email2.message}</p>}
            </div>
          </div>
        </details>

        <details className="space-y-3 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            現職・学歴・スキル
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="current_employment_type">現在の雇用形態</Label>
                <select
                  id="current_employment_type"
                  {...register("current_employment_type", {
                    setValueAs: (v) => (v === "" ? null : v),
                  })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">(未設定)</option>
                  {Object.entries(clientEmploymentTypeLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="current_annual_income">現在年収(万円)</Label>
                <Input
                  id="current_annual_income"
                  type="number"
                  min={0}
                  max={100000}
                  {...register("current_annual_income")}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="final_education">最終学歴</Label>
                <select
                  id="final_education"
                  {...register("final_education", { setValueAs: (v) => (v === "" ? null : v) })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">(未設定)</option>
                  {Object.entries(clientFinalEducationLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="experience_industries">経験業種(カンマ区切り)</Label>
              <Input
                id="experience_industries"
                {...register("experience_industries", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.experienceIndustries.join(", ")}
                placeholder="例:IT, 金融, 製造業"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="experience_occupations">経験職種(カンマ区切り)</Label>
              <Input
                id="experience_occupations"
                {...register("experience_occupations", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.experienceOccupations.join(", ")}
                placeholder="例:エンジニア, PM, 営業"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="education_detail">学歴(詳細)</Label>
              <textarea
                id="education_detail"
                {...register("education_detail")}
                disabled={isPending}
                rows={3}
                placeholder="例:○○大学経済学部卒業(2018 年)"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills">保有資格・スキル</Label>
              <textarea
                id="skills"
                {...register("skills")}
                disabled={isPending}
                rows={4}
                placeholder="例:TOEIC 800、簿記 2 級、AWS Solutions Architect"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。</p>
            </div>
          </div>
        </details>

        <details className="space-y-3 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            希望条件
          </summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="desired_industries">希望業種(カンマ区切り)</Label>
              <Input
                id="desired_industries"
                {...register("desired_industries", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.desiredIndustries.join(", ")}
                placeholder="例:IT, SaaS, FinTech"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desired_occupations">希望職種(カンマ区切り)</Label>
              <Input
                id="desired_occupations"
                {...register("desired_occupations", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.desiredOccupations.join(", ")}
                placeholder="例:バックエンドエンジニア, テックリード"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desired_locations">希望勤務地(カンマ区切り)</Label>
              <Input
                id="desired_locations"
                {...register("desired_locations", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.desiredLocations.join(", ")}
                placeholder="例:東京都, 大阪府, リモート"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="desired_annual_income">希望年収(万円)</Label>
                <Input
                  id="desired_annual_income"
                  type="number"
                  min={0}
                  max={100000}
                  {...register("desired_annual_income")}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job_change_timing">転職希望時期</Label>
                <select
                  id="job_change_timing"
                  {...register("job_change_timing", { setValueAs: (v) => (v === "" ? null : v) })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">(未設定)</option>
                  {Object.entries(clientJobChangeTimingLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job_change_reason">転職理由</Label>
              <textarea
                id="job_change_reason"
                {...register("job_change_reason")}
                disabled={isPending}
                rows={3}
                placeholder="例:キャリアアップ、職場環境の改善"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="desired_conditions">希望条件詳細</Label>
              <textarea
                id="desired_conditions"
                {...register("desired_conditions")}
                disabled={isPending}
                rows={4}
                placeholder="例:フルリモート可、副業 OK、年間休日 120 日以上"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。</p>
            </div>
          </div>
        </details>

        <details className="space-y-3 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            面談・運用情報
          </summary>
          <div className="mt-3 space-y-3">
            {/* CRM 自由タグ。VIP / 要フォロー 等を組織で自由運用。
                experience_industries と同じカンマ区切りパターン(parseCsvTags 経由)。 */}
            <div className="space-y-2">
              <Label htmlFor="crm_tags">CRM タグ(カンマ区切り)</Label>
              <Input
                id="crm_tags"
                {...register("crm_tags", { setValueAs: parseCsvTags })}
                disabled={isPending}
                defaultValue={client.crmTags.join(", ")}
                placeholder="例:VIP, 要フォロー, 上場志望"
              />
              <p className="text-muted-foreground text-xs">
                組織で自由に運用するフラグ。一覧の絞り込みにも使える。
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="intake_date">受付年月日</Label>
                <Input
                  id="intake_date"
                  type="date"
                  {...register("intake_date")}
                  disabled={isPending}
                />
                <p className="text-muted-foreground text-xs">一次接触日(集計の起点)。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="first_meeting_date">面談実施日</Label>
                <Input
                  id="first_meeting_date"
                  type="date"
                  {...register("first_meeting_date")}
                  disabled={isPending}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting_notes">面談所感</Label>
              <textarea
                id="meeting_notes"
                {...register("meeting_notes")}
                disabled={isPending}
                rows={4}
                placeholder="エージェント内部メモ。本人非開示の所感をここに残してください。"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。社外秘。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status_memo">ステータスメモ</Label>
              <textarea
                id="status_memo"
                {...register("status_memo")}
                disabled={isPending}
                rows={3}
                placeholder="現在のステータスに関する補足(次回連絡予定など)"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">暗号化保存。社外秘。</p>
            </div>
          </div>
        </details>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}
