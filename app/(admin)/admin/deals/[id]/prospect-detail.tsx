"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SALES_STAGE_KEYS,
  SALES_STAGE_LABEL,
  type SalesMeeting,
  type SalesProspect,
  type SalesStage,
} from "@/lib/sales/types";

import { stageBadgeClass } from "../deals-client";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ProspectDetail({
  prospect,
  initialMeetings,
}: {
  prospect: SalesProspect;
  initialMeetings: SalesMeeting[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState<SalesStage>(prospect.stage);
  const [company, setCompany] = useState(prospect.companyName);
  const [contactName, setContactName] = useState(prospect.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(prospect.contactEmail ?? "");
  const [notes, setNotes] = useState(prospect.notes ?? "");
  const [editing, setEditing] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meetings] = useState<SalesMeeting[]>(initialMeetings);

  const patch = async (body: Record<string, unknown>, note: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/deals/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      setSavedNote(note);
      setTimeout(() => setSavedNote(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const onChangeStage = (next: SalesStage) => {
    setStage(next);
    void patch({ stage: next }, "ステージを更新しました");
  };

  const saveInfo = () => {
    if (!company.trim()) {
      setError("会社名を入力してください");
      return;
    }
    void patch(
      {
        company_name: company.trim(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
      },
      "会社情報を更新しました",
    ).then(() => setEditing(false));
  };

  const remove = async () => {
    if (!confirm(`商談「${company}」を削除しますか?\nミーティング・議事録もすべて削除されます。`))
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/deals/${prospect.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push("/admin/deals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/admin/deals" className="text-muted-foreground text-xs hover:underline">
          ← 商談一覧
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">{company}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stageBadgeClass(stage)}`}
          >
            {SALES_STAGE_LABEL[stage]}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {savedNote && <div className="text-xs text-emerald-600">{savedNote}</div>}

      {/* ステージ + 会社情報 */}
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs">ステージ</Label>
          <select
            value={stage}
            onChange={(e) => onChangeStage(e.target.value as SalesStage)}
            disabled={busy}
            className="border-input bg-background rounded-md border px-2 py-1 text-sm"
          >
            {SALES_STAGE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SALES_STAGE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>

        {editing ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">会社名</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">担当者名</Label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">メールアドレス</Label>
              <Input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                maxLength={254}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={saveInfo} disabled={busy}>
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-slate-700">
              担当:{contactName || "—"}
              {contactEmail && <span className="text-muted-foreground"> ・ {contactEmail}</span>}
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              会社情報を編集
            </Button>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">メモ</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={8000}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patch({ notes }, "メモを保存しました")}
              disabled={busy}
            >
              メモを保存
            </Button>
          </div>
        </div>
      </Card>

      {/* ミーティング(録音→議事録→AIアドバイス。Phase 3 で取り込み UI を追加) */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">ミーティング</h2>
        {meetings.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-sm">
            まだミーティングがありません。録音の取り込み(→ 自動議事録 →
            AI次アクション)は次のフェーズで追加します。
          </Card>
        ) : (
          <ul className="space-y-3">
            {meetings.map((m) => (
              <li key={m.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      #{m.meetingNo} {m.title ?? "(無題)"}
                      {m.stage && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {SALES_STAGE_LABEL[m.stage]}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {fmtDate(m.meetingDate ?? m.createdAt)}
                    </span>
                  </div>
                  {m.minutes && (
                    <div>
                      <p className="text-muted-foreground text-xs font-semibold">議事録</p>
                      <p className="text-sm whitespace-pre-wrap">{m.minutes}</p>
                    </div>
                  )}
                  {m.advice && (
                    <div className="rounded-md bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-800">AI 次アクション</p>
                      <p className="text-sm whitespace-pre-wrap">{m.advice}</p>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-4">
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy} className="text-red-600">
          この商談を削除
        </Button>
      </div>
    </div>
  );
}
