"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import type { ClientAuditLogEntry } from "@/lib/audit/client-audit-log";
import { clientStatusLabels } from "@/lib/clients/types";

type AuditLogSectionProps = {
  entries: ClientAuditLogEntry[];
};

// 暗号化フィールドのラベル(encrypted_xxx カラム名 → 表示名)
const ENCRYPTED_FIELD_LABEL: Record<string, string> = {
  encrypted_recommendation_comment: "推薦コメント",
  encrypted_other_agency_status: "他社エージェント利用状況",
  encrypted_contact_method_preference: "連絡方法希望",
  encrypted_education_detail: "学歴(詳細)",
  encrypted_skills: "スキル",
  encrypted_job_change_reason: "転職理由",
  encrypted_desired_conditions: "希望条件(詳細)",
  encrypted_meeting_notes: "面談所感",
  encrypted_status_memo: "ステータスメモ",
};

// DB 列名 → 日本語ラベル(UI 表示用)
const FIELD_LABEL: Record<string, string> = {
  name: "氏名",
  email: "メール",
  phone: "電話",
  status: "対応状況",
  assigned_member_id: "担当者",
  notes: "備考",
  close_reason: "クローズ理由",
  entry_site: "エントリーサイト",
  email_distribution_enabled: "MA 配信",
  name_kana: "氏名カナ",
  birth_date: "生年月日",
  gender: "性別",
  nationality: "国籍",
  marital_status: "婚姻状況",
  postal_code: "郵便番号",
  prefecture: "都道府県",
  city: "市区町村",
  street: "番地",
  building: "建物名",
  phone2: "電話 2",
  email2: "メール 2",
  current_employment_type: "雇用形態",
  current_annual_income: "現年収",
  final_education: "最終学歴",
  job_change_timing: "転職時期",
  desired_annual_income: "希望年収",
  intake_date: "受付日",
  first_meeting_date: "面談実施日",
  experience_industries: "経験業種",
  experience_occupations: "経験職種",
  desired_industries: "希望業種",
  desired_occupations: "希望職種",
  desired_locations: "希望勤務地",
  crm_tags: "CRM タグ",
};

const INITIAL_VISIBLE = 6;

/**
 * クライアント変更履歴セクション(詳細画面の下部に配置)。
 *
 * client_audit_log を時系列降順で表示。初期は INITIAL_VISIBLE 件、
 * 「もっと見る」で全件展開。0 件のときは「履歴なし」を出すだけ。
 *
 * 値の表示は人間可読性を優先:
 *   - status は clientStatusLabels で「初回面談」→「求人紹介中」のように出す
 *   - assigned_member_id は UUID をそのまま出すと無意味なので「担当者変更」とだけ表示
 *   - 真偽値は「許可 / 停止」表記に倒す
 */
export function AuditLogSection({ entries }: AuditLogSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, INITIAL_VISIBLE);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">変更履歴</h2>
        <span className="text-muted-foreground text-xs tabular-nums">{entries.length}件</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">まだ変更履歴がありません</p>
      ) : (
        <>
          <ul className="divide-foreground/10 divide-y">
            {visible.map((e) => (
              <AuditLogItem key={e.id} entry={e} />
            ))}
          </ul>
          {entries.length > INITIAL_VISIBLE && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              >
                {expanded ? "折りたたむ" : `さらに ${entries.length - INITIAL_VISIBLE} 件を見る`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AuditLogItem({ entry }: { entry: ClientAuditLogEntry }) {
  const isEncryptedField = entry.fieldName.startsWith("encrypted_");
  const fieldLabel = isEncryptedField
    ? (ENCRYPTED_FIELD_LABEL[entry.fieldName] ?? entry.fieldName)
    : (FIELD_LABEL[entry.fieldName] ?? entry.fieldName);
  const oldDisplay = useMemo(
    () => formatValueForDisplay(entry.fieldName, entry.oldValue),
    [entry.fieldName, entry.oldValue],
  );
  const newDisplay = useMemo(
    () => formatValueForDisplay(entry.fieldName, entry.newValue),
    [entry.fieldName, entry.newValue],
  );

  return (
    <li className="space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{fieldLabel}</span>
        <span className="text-muted-foreground text-xs">
          {entry.fieldName === "merge_from" ? "から統合されました" : "が変更されました"}
        </span>
        {isEncryptedField && (
          <span
            className="inline-block rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300"
            title="暗号化された機密情報のため、変更内容は履歴に残しません"
          >
            🔒 暗号化
          </span>
        )}
      </div>
      {/* 暗号化フィールドは old / new を表示しない(値を保存していないため) */}
      {!isEncryptedField && entry.fieldName !== "merge_from" && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5">{oldDisplay}</span>
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {newDisplay}
          </span>
        </div>
      )}
      {/* マージは old_value に source id を入れる運用 */}
      {entry.fieldName === "merge_from" && entry.oldValue && (
        <div className="text-muted-foreground text-xs">
          元レコード ID: <span className="font-mono">{entry.oldValue}</span>
        </div>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</span>
        {entry.actorName && (
          <>
            <span aria-hidden>·</span>
            <span>{entry.actorName}</span>
          </>
        )}
      </div>
    </li>
  );
}

function formatValueForDisplay(fieldName: string, raw: string | null): string {
  if (raw === null) return "(未設定)";
  if (fieldName === "status") {
    return (clientStatusLabels as Record<string, string>)[raw] ?? raw;
  }
  if (fieldName === "assigned_member_id") {
    // UUID をそのまま出すと無意味なので変更があった事実だけ表示する。
    return "(担当者)";
  }
  if (fieldName === "email_distribution_enabled") {
    return raw === "true" ? "許可" : "停止";
  }
  return raw;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
