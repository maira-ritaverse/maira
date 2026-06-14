"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  updateClientRequestSchema,
  type UpdateClientRequest,
  type ClientRecordWithDecrypted,
  clientStatusLabels,
  clientCloseReasonLabels,
} from "@/lib/clients/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細編集フォーム
 *
 * new/client-form.tsx とほぼ同じ作りだが、初期値を既存レコードから取り、
 * PATCH /api/agency/clients/[id] を呼ぶ。保存成功時は router.refresh() で再取得。
 *
 * 担当アドバイザー変更は将来のメンバー一覧 UI と一緒に出すため、ここでは出さない
 * (API スキーマには既に assigned_member_id が含まれている)。
 */

type Props = { client: ClientRecordWithDecrypted };

export function ClientDetailForm({ client }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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
      email: client.email,
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
      // 暗号化対象の自由記述
      education_detail: client.educationDetail ?? "",
      skills: client.skills ?? "",
      job_change_reason: client.jobChangeReason ?? "",
      desired_conditions: client.desiredConditions ?? "",
      meeting_notes: client.meetingNotes ?? "",
      status_memo: client.statusMemo ?? "",
    },
  });

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

        <div className="space-y-2">
          <Label htmlFor="name">
            氏名 <span className="text-red-600">*</span>
          </Label>
          <Input id="name" {...register("name")} disabled={isPending} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">
            メールアドレス <span className="text-red-600">*</span>
          </Label>
          <Input id="email" type="email" {...register("email")} disabled={isPending} />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          <p className="text-muted-foreground text-xs">
            このメールで求職者がMairaに登録すると、自動的に連携できます
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
            DB 直接閲覧では復号できず、Maira の管理画面からのみ可読です。
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

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "保存中..." : "保存"}
        </Button>
      </form>
    </Card>
  );
}
