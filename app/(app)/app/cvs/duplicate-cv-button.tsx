"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 既存 職務経歴書 から 「複製」する ボタン。 月次クォータ を 消費 しない。
 *
 * 詳細仕様 は app/(app)/app/resumes/duplicate-resume-button.tsx と 同型。
 */
type CvOption = {
  id: string;
  title: string;
};

type Props = {
  cvs: CvOption[];
};

export function DuplicateCvButton({ cvs }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onDuplicate = () => {
    if (!selectedId) {
      setError("複製元 を 選んで ください");
      return;
    }
    setError(null);
    const source = cvs.find((c) => c.id === selectedId);
    startTransition(async () => {
      try {
        const res = await fetch("/api/cvs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: source ? `${source.title} のコピー` : "職務経歴書 (複製)",
            document_date: "",
            body: { summary: "", self_pr: "", work_experience: [], skills: [] },
            sourceCvId: selectedId,
          }),
        });
        const data = (await res.json()) as { id?: string; message?: string; error?: string };
        if (!res.ok || !data.id) {
          throw new Error(data.message ?? data.error ?? "複製 に 失敗");
        }
        router.push(`/app/cvs/${data.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={cvs.length === 0}
        title={cvs.length === 0 ? "複製元 と なる 職務経歴書 が ありません" : "既存から 複製"}
      >
        <Copy className="mr-1 h-4 w-4" />
        既存から 複製
      </Button>
    );
  }

  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-3 text-xs">
      <p className="font-medium">複製元 を 選んで ください</p>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={isPending}
        className="border-input rounded border bg-transparent px-2 py-1 text-xs"
      >
        <option value="">— 選択 —</option>
        {cvs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-1">
        <Button type="button" size="sm" onClick={onDuplicate} disabled={isPending}>
          {isPending ? "複製中..." : "複製する"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setSelectedId("");
            setError(null);
          }}
          disabled={isPending}
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}
