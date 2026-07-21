"use client";

/**
 * 面談を予約するダイアログ(クライアント詳細から呼び出す)
 *
 * - provider 選択(現状 Zoom 固定。Phase 3 で Google Meet を解放)
 * - タイトル / 議題(暗号化)/ 日時 / 長さ を入力
 * - 送信 → POST /api/agency/meetings → 成功で URL を表示して router.refresh()
 *
 * Zoom 未接続のときは、設定画面への導線リンクと再認可ボタンを出す。
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiClientError, getErrorMessage } from "@/lib/api/client-fetch";
import { useDialog } from "@/lib/ui/use-dialog";

type ScheduleMeetingDialogProps = {
  clientId: string;
  clientName: string;
};

type MeetingResponse = {
  meeting: {
    id: string;
    provider: "zoom" | "google_meet";
    title: string;
    startsAt: string;
    joinUrl: string;
    hostUrl: string | null;
    passcode: string | null;
  };
};

/**
 * datetime-local input から ISO 8601(offset 付き)を得る。
 * input の値は「ローカル時刻のまま」なので、new Date() に通すと
 * ブラウザのタイムゾーン情報が乗る。
 */
function localDatetimeToIso(value: string): string {
  return new Date(value).toISOString();
}

/** "+1 時間後" を datetime-local 用の文字列に整形 */
function defaultStartLocal(): string {
  const t = new Date();
  t.setHours(t.getHours() + 1);
  t.setMinutes(0, 0, 0);
  // toISOString は UTC を吐くので、ローカル文字列を組み立てる
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  const hh = String(t.getHours()).padStart(2, "0");
  const mi = String(t.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function ScheduleMeetingDialog({ clientId, clientName }: ScheduleMeetingDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const [provider, setProvider] = useState<"zoom" | "google_meet">("zoom");
  const [title, setTitle] = useState(`${clientName} 様 面談`);
  const [agenda, setAgenda] = useState("");
  const [startLocal, setStartLocal] = useState(defaultStartLocal());
  const [duration, setDuration] = useState(45);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 再認可が必要な状態(設定画面へのリンクを出す) */
  const [needsReconnect, setNeedsReconnect] = useState(false);
  /** 成功時のレスポンス */
  const [result, setResult] = useState<MeetingResponse["meeting"] | null>(null);

  // 閉じた時に副作用状態をリセットする(成功表示・エラーを次回開いたとき持ち越さない)
  const handleClose = () => {
    setOpen(false);
    setError(null);
    setNeedsReconnect(false);
    setResult(null);
  };
  useDialog(open, handleClose, dialogRef);

  const submit = async () => {
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsReconnect(false);
    try {
      const json = await apiFetch<MeetingResponse>("/api/agency/meetings", {
        method: "POST",
        json: {
          provider,
          clientRecordId: clientId,
          title: title.trim(),
          agenda: agenda.trim(),
          startsAt: localDatetimeToIso(startLocal),
          durationMinutes: duration,
        },
      });
      if (!json) {
        setError("予約は作成されましたが応答が読み取れませんでした。ページを更新してください。");
        return;
      }
      setResult(json.meeting);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        const codes = [
          "zoom_not_connected",
          "zoom_scope_insufficient",
          "google_not_connected",
          "google_scope_insufficient",
        ];
        if (err.serverError && codes.includes(err.serverError)) {
          setNeedsReconnect(true);
          setError(getErrorMessage(err));
        } else {
          setError(getErrorMessage(err));
        }
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        面談を予約
      </Button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="面談を予約"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <Card className="bg-background max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">面談を予約({clientName})</h2>
              <button
                type="button"
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground text-sm"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            {/* 成功表示モード ---------------------------------------------------- */}
            {result ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="text-muted-foreground">予約を作成しました。</span>
                </p>
                <div className="bg-muted space-y-2 rounded-md p-3 text-sm">
                  <div className="font-semibold">{result.title}</div>
                  <div className="text-muted-foreground">
                    {new Date(result.startsAt).toLocaleString("ja-JP")}
                  </div>
                  <div className="break-all">
                    <span className="text-muted-foreground">参加 URL: </span>
                    <a
                      href={result.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {result.joinUrl}
                    </a>
                  </div>
                  {result.passcode && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">パスコード: </span>
                      {result.passcode}
                    </div>
                  )}
                  {result.hostUrl && (
                    <div className="text-xs break-all">
                      <span className="text-muted-foreground">主催者用 URL: </span>
                      <a
                        href={result.hostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {result.hostUrl}
                      </a>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  招待メール・カレンダー添付ファイル (.ics) は Phase 2
                  で自動送信されるようになります。
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleClose}>
                    閉じる
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* 入力フォーム ---------------------------------------------------- */}
                <div className="space-y-2">
                  <label className="text-muted-foreground text-xs">サービス</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProvider("zoom")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        provider === "zoom"
                          ? "border-primary bg-primary/10 text-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      Zoom
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("google_meet")}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        provider === "google_meet"
                          ? "border-primary bg-primary/10 text-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      Google Meet
                    </button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {provider === "zoom"
                      ? "Zoom クラウド録画(自動開始)で録画され、終了後に Myaira に取込まれます。"
                      : "Google Calendar に予定が作成されます。録画は Workspace の Meet 録画機能 + Drive 同期で取込まれます。"}
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="meeting_title" className="text-muted-foreground text-xs">
                    タイトル(求職者にも見えます)
                  </label>
                  <Input
                    id="meeting_title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="meeting_agenda" className="text-muted-foreground text-xs">
                    議題メモ(エージェント側のみ・暗号化保存)
                  </label>
                  <textarea
                    id="meeting_agenda"
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="希望条件のヒアリング、職務経歴のすり合わせ など"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="meeting_start" className="text-muted-foreground text-xs">
                      開始日時
                    </label>
                    <Input
                      id="meeting_start"
                      type="datetime-local"
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="meeting_duration" className="text-muted-foreground text-xs">
                      長さ
                    </label>
                    <select
                      id="meeting_duration"
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                    >
                      <option value={15}>15 分</option>
                      <option value={30}>30 分</option>
                      <option value={45}>45 分</option>
                      <option value={60}>60 分</option>
                      <option value={90}>90 分</option>
                    </select>
                  </div>
                </div>

                <div className="text-muted-foreground space-y-1 text-xs">
                  <div>
                    録画は終了後に Myaira へ自動取込され、面談文字起こし →
                    履歴書/職務経歴書下書きに活用されます。
                  </div>
                </div>

                {/* エラー表示 */}
                {error && (
                  <div className="border-destructive bg-destructive/10 text-destructive rounded-md border p-2 text-xs">
                    {error}
                    {needsReconnect && (
                      <div className="mt-1">
                        <a
                          href="/agency/settings/integrations"
                          className="underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          設定 → 外部連携で Zoom を接続/再認可する
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleClose} disabled={submitting}>
                    キャンセル
                  </Button>
                  <Button onClick={submit} disabled={submitting}>
                    {submitting ? "作成中…" : "予約を作成"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
