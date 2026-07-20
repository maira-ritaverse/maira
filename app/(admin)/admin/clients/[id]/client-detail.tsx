"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import {
  clientCloseReasonLabels,
  clientEmploymentTypeLabels,
  clientFinalEducationLabels,
  clientGenderLabels,
  clientJobChangeTimingLabels,
  clientLinkStatusLabels,
  clientMaritalStatusLabels,
  clientStatusLabels,
} from "@/lib/clients/types";

type ClientDetailData = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationIsPersonal: boolean;
  name: string;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  email2: string | null;
  status: string;
  linkStatus: string;
  linkedUserId: string | null;
  linkedAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  closeReason: string | null;
  emailDistributionEnabled: boolean;
  entrySite: string | null;
  birthDate: string | null;
  gender: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  street: string | null;
  building: string | null;
  currentEmploymentType: string | null;
  currentAnnualIncome: number | null;
  finalEducation: string | null;
  experienceIndustries: string[];
  experienceOccupations: string[];
  desiredIndustries: string[];
  desiredOccupations: string[];
  desiredLocations: string[];
  desiredAnnualIncome: number | null;
  jobChangeTiming: string | null;
  intakeDate: string | null;
  firstMeetingDate: string | null;
  crmTags: string[];
  customFields: Record<string, unknown>;
  hasRecommendationComment: boolean;
  hasOtherAgencyStatus: boolean;
  hasContactMethodPreference: boolean;
  hasEducationDetail: boolean;
  hasSkills: boolean;
  hasJobChangeReason: boolean;
  hasDesiredConditions: boolean;
  hasMeetingNotes: boolean;
  hasStatusMemo: boolean;
  assignedMemberId: string | null;
  assignedMemberEmail: string | null;
  createdByMemberId: string | null;
  createdByEmail: string | null;
  referralCount: number;
  createdAt: string;
  updatedAt: string;
};

type DetailResponse = { client: ClientDetailData };

type DecryptedNotes = {
  recommendationComment: string | null;
  otherAgencyStatus: string | null;
  contactMethodPreference: string | null;
  educationDetail: string | null;
  skills: string | null;
  jobChangeReason: string | null;
  desiredConditions: string | null;
  meetingNotes: string | null;
  statusMemo: string | null;
};

export function ClientDetail({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<DecryptedNotes | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DetailResponse>(`/api/admin/clients/${clientId}`);
      setData(res?.client ?? null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void fetchDetail();
  }, [fetchDetail]);

  const handleReveal = async () => {
    // 「トグル 展開 は 明示的 な アクション」 な の で、 まず 理由 を promptで取る
    // (キャンセル でも 表示 は 進める: 業務 上 の 明確 な 名前 を つけ るか どう か
    //  は 運用 次第。 audit ログ には reason=null で 残る)
    const reason = window.prompt(
      "内部メモを復号して表示します。この操作は audit ログに記録されます。\n\n理由 (任意、最大 500 文字):",
      "",
    );
    if (reason === null) return; // キャンセル → 表示 しない
    setRevealing(true);
    setRevealError(null);
    try {
      const res = await apiFetch<DecryptedNotes>(`/api/admin/clients/${clientId}/reveal-notes`, {
        method: "POST",
        json: { reason: reason || undefined },
      });
      if (res) setNotes(res);
    } catch (err) {
      setRevealError(getErrorMessage(err));
    } finally {
      setRevealing(false);
    }
  };

  if (loading && !data) return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  if (error) return <p className="text-destructive text-xs">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">求職者が見つかりません。</p>;

  const hasAnyEncrypted =
    data.hasRecommendationComment ||
    data.hasOtherAgencyStatus ||
    data.hasContactMethodPreference ||
    data.hasEducationDetail ||
    data.hasSkills ||
    data.hasJobChangeReason ||
    data.hasDesiredConditions ||
    data.hasMeetingNotes ||
    data.hasStatusMemo;

  return (
    <div className="space-y-8">
      {/* === ヘッダ === */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {data.nameKana ?? "—"}
            <span className="ml-2 text-[10px]">/ {data.id}</span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            <Link href={`/admin/organizations/${data.organizationId}`} className="hover:underline">
              {data.organizationName}
            </Link>
            {data.organizationIsPersonal && (
              <span className="ml-1 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                個人
              </span>
            )}
            {" ・ 登録日 "}
            {new Date(data.createdAt).toLocaleDateString("ja-JP")}
            {" ・ 応募 "}
            {data.referralCount} 件
          </p>
        </div>
        <RefreshButton onClick={() => void fetchDetail()} loading={loading} />
      </div>

      {/* === ステータス系 === */}
      <Section title="ステータス">
        <Row label="案件ステータス">
          {clientStatusLabels[data.status as keyof typeof clientStatusLabels] ?? data.status}
        </Row>
        <Row label="連携ステータス">
          {clientLinkStatusLabels[data.linkStatus as keyof typeof clientLinkStatusLabels] ??
            data.linkStatus}
          {data.linkedUserId && (
            <span className="text-muted-foreground ml-2 text-[10px]">
              linked_user_id: {data.linkedUserId}
            </span>
          )}
        </Row>
        {data.closeReason && (
          <Row label="クローズ理由">
            {clientCloseReasonLabels[data.closeReason as keyof typeof clientCloseReasonLabels] ??
              data.closeReason}
          </Row>
        )}
        <Row label="担当CA">
          {data.assignedMemberEmail ?? <span className="text-muted-foreground">未割当</span>}
        </Row>
        <Row label="起票者">
          {data.createdByEmail ?? <span className="text-muted-foreground">—</span>}
          <span className="text-muted-foreground ml-2 text-[10px]">
            2026-07-19 以降の起票のみ actor 記録あり
          </span>
        </Row>
        <Row label="MA配信">
          {data.emailDistributionEnabled ? (
            <span className="text-emerald-700 dark:text-emerald-400">許可</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-500">停止</span>
          )}
        </Row>
      </Section>

      {/* === 基本属性 === */}
      <Section title="基本属性">
        <Row label="氏名">{data.name}</Row>
        <Row label="カナ">{data.nameKana ?? "—"}</Row>
        <Row label="生年月日">{data.birthDate ?? "—"}</Row>
        <Row label="性別">
          {data.gender
            ? (clientGenderLabels[data.gender as keyof typeof clientGenderLabels] ?? data.gender)
            : "—"}
        </Row>
        <Row label="国籍">{data.nationality ?? "—"}</Row>
        <Row label="婚姻">
          {data.maritalStatus
            ? (clientMaritalStatusLabels[
                data.maritalStatus as keyof typeof clientMaritalStatusLabels
              ] ?? data.maritalStatus)
            : "—"}
        </Row>
      </Section>

      {/* === 連絡先 === */}
      <Section title="連絡先">
        <Row label="メール">{data.email ?? "—"}</Row>
        <Row label="サブメール">{data.email2 ?? "—"}</Row>
        <Row label="電話">{data.phone ?? "—"}</Row>
        <Row label="サブ電話">{data.phone2 ?? "—"}</Row>
      </Section>

      {/* === 住所 === */}
      <Section title="住所">
        <Row label="郵便番号">{data.postalCode ?? "—"}</Row>
        <Row label="都道府県">{data.prefecture ?? "—"}</Row>
        <Row label="市区">{data.city ?? "—"}</Row>
        <Row label="番地">{data.street ?? "—"}</Row>
        <Row label="建物">{data.building ?? "—"}</Row>
      </Section>

      {/* === 現職 === */}
      <Section title="現職 / 経歴">
        <Row label="雇用形態">
          {data.currentEmploymentType
            ? (clientEmploymentTypeLabels[
                data.currentEmploymentType as keyof typeof clientEmploymentTypeLabels
              ] ?? data.currentEmploymentType)
            : "—"}
        </Row>
        <Row label="現年収">
          {typeof data.currentAnnualIncome === "number"
            ? `${data.currentAnnualIncome.toLocaleString()} 万円`
            : "—"}
        </Row>
        <Row label="最終学歴">
          {data.finalEducation
            ? (clientFinalEducationLabels[
                data.finalEducation as keyof typeof clientFinalEducationLabels
              ] ?? data.finalEducation)
            : "—"}
        </Row>
        <Row label="経験業種">
          {data.experienceIndustries.length > 0 ? data.experienceIndustries.join(" / ") : "—"}
        </Row>
        <Row label="経験職種">
          {data.experienceOccupations.length > 0 ? data.experienceOccupations.join(" / ") : "—"}
        </Row>
      </Section>

      {/* === 希望条件 === */}
      <Section title="希望条件">
        <Row label="希望業種">
          {data.desiredIndustries.length > 0 ? data.desiredIndustries.join(" / ") : "—"}
        </Row>
        <Row label="希望職種">
          {data.desiredOccupations.length > 0 ? data.desiredOccupations.join(" / ") : "—"}
        </Row>
        <Row label="希望勤務地">
          {data.desiredLocations.length > 0 ? data.desiredLocations.join(" / ") : "—"}
        </Row>
        <Row label="希望年収">
          {typeof data.desiredAnnualIncome === "number"
            ? `${data.desiredAnnualIncome.toLocaleString()} 万円`
            : "—"}
        </Row>
        <Row label="転職時期">
          {data.jobChangeTiming
            ? (clientJobChangeTimingLabels[
                data.jobChangeTiming as keyof typeof clientJobChangeTimingLabels
              ] ?? data.jobChangeTiming)
            : "—"}
        </Row>
      </Section>

      {/* === 運用 === */}
      <Section title="運用">
        <Row label="エントリー元">{data.entrySite ?? "—"}</Row>
        <Row label="受付日">{data.intakeDate ?? "—"}</Row>
        <Row label="初回面談">{data.firstMeetingDate ?? "—"}</Row>
        <Row label="CRMタグ">{data.crmTags.length > 0 ? data.crmTags.join(" / ") : "—"}</Row>
        <Row label="平文メモ">
          {data.notes ? <span className="whitespace-pre-wrap">{data.notes}</span> : "—"}
        </Row>
      </Section>

      {/* === 暗号化 内部 メモ (トグル 展開) === */}
      <div className="rounded border border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              内部メモ(暗号化フィールド)
            </h2>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
              推薦文 / 面談メモ / 転職理由 / 希望条件詳細 / 学歴詳細 / スキル / 他社利用状況 /
              連絡方法の希望 / ステータスメモ を復号して表示します。展開すると audit
              ログに記録されます (admin_revealed_client_encrypted_notes)。
            </p>
            {!hasAnyEncrypted && (
              <p className="mt-2 text-xs text-amber-800/60 dark:text-amber-200/60">
                この求職者には暗号化された内部メモは登録されていません。
              </p>
            )}
          </div>
          {hasAnyEncrypted && !notes && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleReveal()}
              disabled={revealing}
            >
              {revealing ? "復号中…" : "内部メモを復号して表示"}
            </Button>
          )}
        </div>
        {revealError && <p className="mt-2 text-xs text-red-700">{revealError}</p>}
        {notes && (
          <div className="mt-4 space-y-3">
            <EncryptedField label="推薦文" value={notes.recommendationComment} />
            <EncryptedField label="他社利用状況" value={notes.otherAgencyStatus} />
            <EncryptedField label="連絡方法の希望" value={notes.contactMethodPreference} />
            <EncryptedField label="学歴詳細" value={notes.educationDetail} />
            <EncryptedField label="スキル" value={notes.skills} />
            <EncryptedField label="転職理由" value={notes.jobChangeReason} />
            <EncryptedField label="希望条件詳細" value={notes.desiredConditions} />
            <EncryptedField label="面談メモ" value={notes.meetingNotes} />
            <EncryptedField label="ステータスメモ" value={notes.statusMemo} />
          </div>
        )}
      </div>

      {/* === カスタムフィールド === */}
      {Object.keys(data.customFields).length > 0 && (
        <Section title="カスタムフィールド">
          <pre className="bg-muted overflow-x-auto rounded p-3 text-xs">
            {JSON.stringify(data.customFields, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-muted-foreground mb-2 text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <div className="grid gap-2 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="break-words">{children}</span>
    </div>
  );
}

function EncryptedField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-semibold">{label}</p>
      {value ? (
        <p className="mt-0.5 text-sm whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-muted-foreground/60 mt-0.5 text-xs">(未入力)</p>
      )}
    </div>
  );
}
