"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { EmailTemplate } from "@/lib/email-templates/templates";
import { useDialog } from "@/lib/ui/use-dialog";

type SendEmailDialogProps = {
  clientId: string;
  clientName: string;
  /** 担当アドバイザーの表示名(テンプレ差し替え用)。null なら "担当者" にフォールバック */
  advisorName: string | null;
  organizationName: string;
};

type Template = {
  key: string;
  label: string;
  subject: string;
  body: string;
};

/**
 * メールテンプレ(コード組み込み)。後で organization-scoped にしたくなったら
 * email_templates テーブルを追加して DB に持つ。差し替え変数:
 *   {client_name} / {advisor_name} / {organization_name}
 */
const TEMPLATES: Template[] = [
  {
    key: "initial_greeting",
    label: "初回ご挨拶",
    subject: "ご登録ありがとうございます({organization_name})",
    body:
      "{client_name} 様\n\n" +
      "この度は {organization_name} にご登録いただきありがとうございます。\n" +
      "担当の {advisor_name} と申します。\n\n" +
      "まずは現状の希望条件や経歴について、お時間をいただきヒアリングさせてください。\n" +
      "ご都合の良い日時をいくつか頂けますと幸いです。\n\n" +
      "どうぞよろしくお願いいたします。\n{advisor_name}",
  },
  {
    key: "meeting_followup",
    label: "面談後のフォローアップ",
    subject: "本日はありがとうございました",
    body:
      "{client_name} 様\n\n" +
      "本日はお時間をいただきありがとうございました。\n" +
      "面談で伺った内容をふまえて、ご紹介できそうな求人を選定しております。\n" +
      "近日中に改めてご連絡差し上げます。\n\n" +
      "ご不明点がございましたら、いつでもご連絡ください。\n\n" +
      "{advisor_name}\n{organization_name}",
  },
  {
    key: "silence_check",
    label: "ご様子伺い(ご無沙汰)",
    subject: "ご活動状況いかがでしょうか",
    body:
      "{client_name} 様\n\n" +
      "ご無沙汰しております。{advisor_name} です。\n" +
      "ご活動状況いかがでしょうか。\n\n" +
      "改めて条件を整理してご紹介できる求人をお探ししたいと考えております。\n" +
      "ご都合の良い時間にご返信いただけますと幸いです。\n\n" +
      "{advisor_name}",
  },
];

/**
 * クライアント詳細画面の「メール送信」ダイアログ。
 *
 * - テンプレ選択 → 件名 / 本文に自動展開
 * - {client_name} / {advisor_name} / {organization_name} を差し替え
 * - 送信成功 → 対応履歴 (email) に自動記録 + router.refresh()
 */
export function SendEmailDialog({
  clientId,
  clientName,
  advisorName,
  organizationName,
}: SendEmailDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DB 上の組織カスタムテンプレ。Dialog 表示後にだけ取得する。
  const [dbTemplates, setDbTemplates] = useState<EmailTemplate[]>([]);

  useDialog(open, () => setOpen(false), dialogRef);

  // ダイアログを開いたタイミングで組織のテンプレを取得(失敗しても本動作は継続)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const json = await apiFetch<{ templates: EmailTemplate[] }>("/api/agency/email-templates");
        if (cancelled) return;
        setDbTemplates(json?.templates ?? []);
      } catch {
        // 黙って失敗(コード組み込みテンプレが使える)
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    const ctx = {
      client_name: clientName,
      advisor_name: advisorName ?? "担当者",
      organization_name: organizationName,
    };
    const replace = (s: string): string =>
      s
        .replace(/\{client_name\}/g, ctx.client_name)
        .replace(/\{advisor_name\}/g, ctx.advisor_name)
        .replace(/\{organization_name\}/g, ctx.organization_name);
    setSubject(replace(t.subject));
    setBody(replace(t.body));
  };

  const applyDbTemplate = (t: EmailTemplate) => {
    const ctx = {
      client_name: clientName,
      advisor_name: advisorName ?? "担当者",
      organization_name: organizationName,
    };
    const replace = (s: string): string =>
      s
        .replace(/\{client_name\}/g, ctx.client_name)
        .replace(/\{advisor_name\}/g, ctx.advisor_name)
        .replace(/\{organization_name\}/g, ctx.organization_name);
    setSubject(replace(t.subject));
    setBody(replace(t.body));
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      setError("件名と本文の両方を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/agency/clients/${clientId}/send-email`, {
        method: "POST",
        json: { subject, body },
      });
      router.refresh();
      setOpen(false);
      setSubject("");
      setBody("");
    } catch (err) {
      setError(`送信失敗: ${getErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        メール送信
      </Button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="メール送信"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <Card className="bg-background max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">メール送信({clientName})</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-muted-foreground text-xs">テンプレート</label>
              <div className="flex flex-wrap gap-1.5">
                {/* 組織のカスタムテンプレ(あれば優先表示) */}
                {dbTemplates.map((t) => (
                  <button
                    key={`db-${t.id}`}
                    type="button"
                    onClick={() => applyDbTemplate(t)}
                    className="bg-primary/10 text-primary hover:bg-primary/20 rounded-full px-2.5 py-0.5 text-xs"
                    title="組織のカスタムテンプレ"
                  >
                    {t.name}
                  </button>
                ))}
                {/* コード組み込みのデフォルトテンプレ */}
                {TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyTemplate(t.key)}
                    className="bg-muted text-muted-foreground hover:bg-accent rounded-full px-2.5 py-0.5 text-xs"
                    title="標準テンプレ"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="email_subject" className="text-muted-foreground text-xs">
                件名
              </label>
              <Input
                id="email_subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="件名を入力"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email_body" className="text-muted-foreground text-xs">
                本文
              </label>
              <textarea
                id="email_body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
                rows={10}
                className="border-input bg-background w-full rounded-lg border px-3 py-2 font-mono text-sm"
                placeholder="本文を入力"
              />
              <p className="text-muted-foreground text-xs">
                送信後は対応履歴(email)として自動記録されます。
              </p>
            </div>

            {error && <p className="text-destructive text-xs">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                閉じる
              </Button>
              <Button onClick={send} disabled={submitting}>
                {submitting ? "送信中…" : "送信"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
