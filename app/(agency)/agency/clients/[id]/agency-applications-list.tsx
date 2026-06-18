"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import {
  AGENCY_APPLICATION_STATUS_LABEL,
  type AgencyApplication,
  type AgencyApplicationDetails,
  type AgencyApplicationStatus,
} from "@/lib/agency-client-documents/types";

type ReferralRow = {
  id: string;
  jobPostingId: string;
  companyName: string;
  position: string;
  existingApplication: AgencyApplication | null;
};

type Props = {
  clientRecordId: string;
  referrals: ReferralRow[];
};

export function AgencyApplicationsList({ clientRecordId, referrals }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState(referrals);

  const handleCreate = (referralId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: AgencyApplication }>("/api/agency/agency-applications", {
          method: "POST",
          json: {
            client_record_id: clientRecordId,
            referral_id: referralId,
          },
        });
        if (!res?.item) throw new Error("response_missing_item");
        setRows((prev) =>
          prev.map((r) => (r.id === referralId ? { ...r, existingApplication: res.item } : r)),
        );
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {r.companyName}
                    {r.position && <span className="text-muted-foreground"> / {r.position}</span>}
                  </p>
                  <p className="text-muted-foreground text-xs">紹介 ID:{r.id}</p>
                </div>
                {r.existingApplication ? (
                  <StatusBadge status={r.existingApplication.status} />
                ) : (
                  <Button size="sm" onClick={() => handleCreate(r.id)} disabled={pending}>
                    {pending ? "記録中…" : "+ 代行応募を記録"}
                  </Button>
                )}
              </div>
              {r.existingApplication && (
                <ApplicationEditor
                  application={r.existingApplication}
                  onChange={(updated) =>
                    setRows((prev) =>
                      prev.map((row) =>
                        row.id === r.id ? { ...row, existingApplication: updated } : row,
                      ),
                    )
                  }
                  onDelete={() =>
                    setRows((prev) =>
                      prev.map((row) =>
                        row.id === r.id ? { ...row, existingApplication: null } : row,
                      ),
                    )
                  }
                />
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplicationEditor({
  application,
  onChange,
  onDelete,
}: {
  application: AgencyApplication;
  onChange: (updated: AgencyApplication) => void;
  onDelete: () => void;
}) {
  const [details, setDetails] = useState<AgencyApplicationDetails>(application.details);
  const [status, setStatus] = useState<AgencyApplicationStatus>(application.status);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateDetails = (patch: Partial<AgencyApplicationDetails>) =>
    setDetails((prev) => ({ ...prev, ...patch }));

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: AgencyApplication }>(
          `/api/agency/agency-applications/${application.id}`,
          {
            method: "PATCH",
            json: { details, status },
          },
        );
        if (!res?.item) throw new Error("response_missing_item");
        onChange(res.item);
        setSavedAt(new Date());
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("この代行応募の記録を削除します。実行しますか?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await apiFetch(`/api/agency/agency-applications/${application.id}`, { method: "DELETE" });
        onDelete();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="border-input bg-muted/20 space-y-3 rounded-md border p-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>ステータス</Label>
          <select
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as AgencyApplicationStatus)}
            disabled={pending}
          >
            {(Object.keys(AGENCY_APPLICATION_STATUS_LABEL) as AgencyApplicationStatus[]).map(
              (s) => (
                <option key={s} value={s}>
                  {AGENCY_APPLICATION_STATUS_LABEL[s]}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="space-y-1">
          <Label>応募経路</Label>
          <Input
            value={details.applied_via}
            onChange={(e) => updateDetails({ applied_via: e.target.value })}
            placeholder="自社マイページ / メール / 紹介状 / 自社採用ページ など"
            maxLength={200}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label>先方担当者</Label>
          <Input
            value={details.contact_name}
            onChange={(e) => updateDetails({ contact_name: e.target.value })}
            maxLength={100}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label>次回アクション(任意の ISO 日時)</Label>
          <Input
            value={details.next_action_at}
            onChange={(e) => updateDetails({ next_action_at: e.target.value })}
            placeholder="2026-07-01T10:00"
            maxLength={30}
            disabled={pending}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>進捗メモ</Label>
        <Textarea
          value={details.status_memo}
          onChange={(e) => updateDetails({ status_memo: e.target.value })}
          rows={3}
          maxLength={4000}
          placeholder="先方反応・社内共有メモなど"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-muted-foreground text-xs">
          {savedAt ? `${savedAt.toLocaleTimeString("ja-JP")} に保存しました` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
            記録を削除
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<AgencyApplicationStatus, string> = {
  submitted: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100",
  screening: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
  interview: "bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-100",
  offer: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  rejected: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: AgencyApplicationStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {AGENCY_APPLICATION_STATUS_LABEL[status]}
    </span>
  );
}
