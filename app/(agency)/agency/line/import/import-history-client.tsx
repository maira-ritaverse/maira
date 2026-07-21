"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

type Friend = {
  lineUserId: string;
  displayName: string;
  clientName: string | null;
};

type Props = { friends: Friend[] };

type ImportResult = {
  ok: true;
  total: number;
  parsed: number;
  inserted: number;
  duplicate: number;
  skipped: number;
  errors: string[];
};

export function ImportHistoryClient({ friends }: Props) {
  const [lineUserId, setLineUserId] = useState("");
  const [selfSenderLabels, setSelfSenderLabels] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onSubmit = async () => {
    if (!lineUserId) {
      setError("対象 友達 を 選択 して ください");
      return;
    }
    if (!file) {
      setError("CSV ファイル を 選んで ください");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("lineUserId", lineUserId);
      fd.append("selfSenderLabels", selfSenderLabels);
      fd.append("file", file);
      const res = await fetch("/api/agency/line/import-history", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => null)) as
        | ImportResult
        | { error: string; message?: string; reason?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "reason" in body && body.reason
              ? body.reason
              : "error" in body
                ? body.error
                : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setResult(body);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">CSV を 取込</h2>

      <div className="space-y-1.5">
        <Label htmlFor="import-friend" className="text-xs">
          対象 友達
        </Label>
        <select
          id="import-friend"
          value={lineUserId}
          onChange={(e) => setLineUserId(e.target.value)}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        >
          <option value="">— 選択 —</option>
          {friends.map((f) => (
            <option key={f.lineUserId} value={f.lineUserId}>
              {f.displayName}
              {f.clientName ? ` (${f.clientName})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="import-self-labels" className="text-xs">
          「自分」 と 判定 する 送信者名 (カンマ区切り)
        </Label>
        <Input
          id="import-self-labels"
          value={selfSenderLabels}
          onChange={(e) => setSelfSenderLabels(e.target.value)}
          placeholder="例: Myairaテスト, 自分"
        />
        <p className="text-muted-foreground text-[10px]">
          CSV の 送信者 列 で この 文字列 と 一致 する 行 は outbound (エージェント側 送信) として
          扱われ ます。 残り は inbound (求職者 受信)。
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="import-file" className="text-xs">
          CSV ファイル (最大 10 MB)
        </Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          <AlertDescription>
            <p className="font-semibold text-emerald-700">取込 完了</p>
            <ul className="mt-2 space-y-0.5 text-xs">
              <li>CSV 行数 (ヘッダ除く):{result.total}</li>
              <li>パース 成功:{result.parsed}</li>
              <li>新規 追加:{result.inserted}</li>
              <li>重複 (スキップ):{result.duplicate}</li>
              <li>パース 失敗 (スキップ):{result.skipped}</li>
              {result.errors.length > 0 && (
                <li className="text-red-600">エラー:{result.errors.join(", ")}</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onSubmit}
          disabled={uploading || !file || !lineUserId}
          className="bg-[#06C755] text-white hover:bg-[#05a647]"
        >
          {uploading ? "取込 中..." : "取込 開始"}
        </Button>
      </div>
    </Card>
  );
}
