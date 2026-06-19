"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 既存 履歴書 から 「複製」して 新規 履歴書 を 作成 する ボタン。
 *
 * 複製は 月次クォータ を 消費 しない。 サーバ側 (createResume) で sourceResumeId
 * を 受け取り、 所有者検証 後 に 新規行 INSERT。
 *
 * UX:
 *   ・既存 履歴書 が 0 件 → ボタン disabled
 *   ・1 件以上 → モーダル で 複製元 を 選択 → POST /api/resumes
 *   ・成功 → 新しい 履歴書 の 編集画面 に 遷移
 */
type ResumeOption = {
  id: string;
  title: string;
};

type Props = {
  resumes: ResumeOption[];
};

export function DuplicateResumeButton({ resumes }: Props) {
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
    const source = resumes.find((r) => r.id === selectedId);
    startTransition(async () => {
      try {
        // 複製元 の 既存データ を コピー して 作成 する 場合、 一般的 には
        // sourceResumeId だけ 渡せば 良い (サーバ側で 全体を コピー しない)。
        // ここでは 「タイトル を <元タイトル>のコピー」「最小限の input」で 作成 し、
        // 編集画面 で 引き継ぐ 形に する。
        // (元の 写真 URL を 引き継ぎ たい 場合は ここで /api/resumes/[id] から
        //  取得 → carryOver で 渡す 拡張 が 可能。 まずは シンプル に。)
        const res = await fetch("/api/resumes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: source ? `${source.title} のコピー` : "履歴書 (複製)",
            document_date: "",
            sourceResumeId: selectedId,
          }),
        });
        const data = (await res.json()) as { id?: string; message?: string; error?: string };
        if (!res.ok || !data.id) {
          throw new Error(data.message ?? data.error ?? "複製 に 失敗");
        }
        router.push(`/app/resumes/${data.id}`);
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
        disabled={resumes.length === 0}
        title={resumes.length === 0 ? "複製元 と なる 履歴書 が ありません" : "既存から 複製"}
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
        {resumes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
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
