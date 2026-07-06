"use client";

import {
  Briefcase,
  CalendarClock,
  Heart,
  Image as ImageIcon,
  Paperclip,
  Smile,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";
import type { ConversationMessage } from "@/lib/line/conversations";
import { COMMON_STICKERS, getStickerImageUrl } from "@/lib/line/stickers";

import { MeetingProposePanel } from "@/components/features/meetings/meeting-propose-panel";

/**
 * LINE風 個別 チャット UI (Client Component)
 *
 * 構成:
 *   ・上部:メッセージ バブル の リスト (古い順、 一番下 が 最新)
 *   ・下部:固定 入力欄 + 送信 ボタン
 *
 * スタイル:
 *   ・送信 (outbound) = 右側、 LINE グリーン (#06C755)
 *   ・受信 (inbound) = 左側、 白 + グレー枠
 *   ・スタンプ = LINE CDN 画像
 *   ・system = 中央 グレー テキスト
 *
 * 機能:
 *   ・10 秒 ごと に 新着 メッセージ を ポーリング
 *   ・送信後 自動 リフレッシュ
 *   ・送信中 / 失敗 状態 表示
 *   ・unfollowed なら 送信欄 disable
 */
type Props = {
  lineUserId: string;
  initialMessages: ConversationMessage[];
  unfollowed: boolean;
  jobOptions: Array<{ id: string; label: string }>;
  scheduledMeetings: Array<{
    id: string;
    title: string;
    startsAt: string;
    joinUrl: string;
  }>;
};

// 受信 メッセージ 反映 の レイテンシー。 3 秒 = 1 分 で 20 回 = Vercel
// Function 呼び出し は 小規模 で 余裕 が ある。 体感 を 大幅 改善。
const POLL_INTERVAL_MS = 3_000;
const STICKER_CDN = "https://stickershop.line-scdn.net/stickershop/v1/sticker";

export function LineConversationClient({
  lineUserId,
  initialMessages,
  unfollowed,
  jobOptions,
  scheduledMeetings,
}: Props) {
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [jobShareOpen, setJobShareOpen] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [meetingProposeOpen, setMeetingProposeOpen] = useState(false);
  // AI 返信 案 生成 の 状態
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{
    nextStep: string;
    replyText: string;
  } | null>(null);
  const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 最下部 へ スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // ポーリング + 復帰 時 即時 取得
  useEffect(() => {
    const ctrl = new AbortController();
    let active = true;

    const poll = async () => {
      try {
        const url = `/api/agency/line/conversations/${encodeURIComponent(lineUserId)}/messages`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { messages: ConversationMessage[] };
        if (active && json.messages.length !== messages.length) {
          setMessages(json.messages);
        }
      } catch {
        // ポーリング 失敗 は 無視 (次回 試行)
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);

    // タブ が フォアグラウンド に 戻った とき に 即時 ポーリング
    // (バック グラウンド 中 に 受信 した メッセージ を 体感 即時 で 反映)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      active = false;
      ctrl.abort();
    };
  }, [lineUserId, messages.length]);

  const onSend = async () => {
    if (!text.trim()) return;
    if (unfollowed) {
      setError("ブロック / 友達解除 された 相手 には 送信 できません");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, text: text.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; sendMethod: "reply" | "push" }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setText("");
      // 即時 リフレッシュ
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const onSendSticker = async (packageId: string, stickerId: string) => {
    if (unfollowed) {
      setError("ブロック / 友達解除 された 相手 には 送信 できません");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId,
          sticker: { packageId, stickerId },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; sendMethod: "reply" | "push" }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setStickerPickerOpen(false);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const onSendImage = async (file: File) => {
    if (unfollowed) {
      setError("ブロック / 友達解除 された 相手 には 送信 できません");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("lineUserId", lineUserId);
      fd.append("file", file);
      const res = await fetch("/api/agency/line/share-image", {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; sendMethod: "reply" | "push" }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const onShareJobs = async () => {
    if (selectedJobIds.length === 0) return;
    if (unfollowed) {
      setError("ブロック / 友達解除 された 相手 には 送信 できません");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/share-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, jobIds: selectedJobIds }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; jobCount: number }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setJobShareOpen(false);
      setSelectedJobIds([]);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const refresh = async () => {
    try {
      const url = `/api/agency/line/conversations/${encodeURIComponent(lineUserId)}/messages`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = (await res.json()) as { messages: ConversationMessage[] };
      setMessages(json.messages);
    } catch {
      // ignore
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter で 送信
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSend();
    }
  };

  const onGenerateSuggestion = async () => {
    setAiSuggestBusy(true);
    setAiSuggestOpen(true);
    setAiSuggestError(null);
    setAiSuggestion(null);
    try {
      const res = await fetch(
        `/api/agency/line/conversations/${encodeURIComponent(lineUserId)}/ai-suggest`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        nextStep?: string;
        replyText?: string;
        message?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      setAiSuggestion({
        nextStep: body.nextStep ?? "",
        replyText: body.replyText ?? "",
      });
    } catch (e) {
      setAiSuggestError(getErrorMessage(e));
    } finally {
      setAiSuggestBusy(false);
    }
  };

  const onAdoptSuggestion = () => {
    if (aiSuggestion) {
      setText(aiSuggestion.replyText);
      setAiSuggestOpen(false);
      setAiSuggestion(null);
    }
  };

  const onDismissSuggestion = () => {
    setAiSuggestOpen(false);
    setAiSuggestion(null);
    setAiSuggestError(null);
  };

  return (
    <>
      {/* 確定済 面談 バナー (未来 の もの のみ、 上 5 件) */}
      {scheduledMeetings.length > 0 && (
        <ScheduledMeetingsBanner
          meetings={scheduledMeetings}
          onCanceled={async () => {
            await refresh();
            // ページ 再読込 で バナー も 更新
            window.location.reload();
          }}
        />
      )}

      {/* メッセージ リスト (LINE OA Manager 風 = 薄グレー 背景) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-100 px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-center text-xs">
            まだ メッセージ が ありません。
          </p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1] : null;
              const showDateSep = !prev || !isSameDay(prev.createdAt, m.createdAt);
              return (
                <div key={m.id}>
                  {showDateSep && <DateSeparator iso={m.createdAt} />}
                  <MessageBubble message={m} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 日程 提案 パネル */}
      {meetingProposeOpen && (
        <MeetingProposePanel
          lineUserId={lineUserId}
          onSent={async () => {
            setMeetingProposeOpen(false);
            await refresh();
          }}
          onClose={() => setMeetingProposeOpen(false)}
          unfollowed={unfollowed}
        />
      )}

      {/* 求人 共有 パネル (展開時 だけ 表示) */}
      {jobShareOpen && (
        <div className="space-y-2 border-t bg-white p-3">
          <p className="text-xs font-semibold">求人 を 共有 (最大 12 件)</p>
          {jobOptions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              送信可能 な 求人 が ありません (status=open を 確認)。
            </p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {jobOptions.map((j) => (
                <label
                  key={j.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedJobIds.includes(j.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        if (selectedJobIds.length >= 12) return;
                        setSelectedJobIds([...selectedJobIds, j.id]);
                      } else {
                        setSelectedJobIds(selectedJobIds.filter((id) => id !== j.id));
                      }
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{j.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setJobShareOpen(false)}>
              閉じる
            </Button>
            <Button
              size="sm"
              onClick={onShareJobs}
              disabled={selectedJobIds.length === 0 || sending}
              className="bg-[#06C755] text-white hover:bg-[#05a647]"
            >
              {selectedJobIds.length} 件 を 共有
            </Button>
          </div>
        </div>
      )}

      {/* スタンプ ピッカー (展開時 だけ 表示) */}
      {stickerPickerOpen && (
        <div className="grid grid-cols-6 gap-2 border-t bg-white p-3">
          {COMMON_STICKERS.map((s) => (
            <button
              key={`${s.packageId}-${s.stickerId}`}
              onClick={() => onSendSticker(s.packageId, s.stickerId)}
              disabled={sending || unfollowed}
              className="rounded-md p-1 transition-colors hover:bg-slate-100 disabled:opacity-50"
              title={s.label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getStickerImageUrl(s.stickerId)}
                alt={s.label}
                className="h-14 w-14 object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* 入力欄 */}
      <div className="border-t bg-white p-2">
        {error && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {aiSuggestOpen && (
          <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 font-semibold text-emerald-900">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                AI 返信 案
              </span>
              <button
                type="button"
                onClick={onDismissSuggestion}
                className="text-muted-foreground hover:text-foreground text-[10px]"
              >
                閉じる
              </button>
            </div>
            {aiSuggestBusy && <p className="text-muted-foreground">生成 中…</p>}
            {aiSuggestError && <p className="text-red-700">{aiSuggestError}</p>}
            {aiSuggestion && (
              <div className="space-y-2">
                <div>
                  <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold">
                    次 の ステップ
                  </div>
                  <p className="text-slate-900">{aiSuggestion.nextStep}</p>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold">
                    返信 案
                  </div>
                  <p className="rounded bg-white p-2 whitespace-pre-wrap text-slate-900">
                    {aiSuggestion.replyText}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={onAdoptSuggestion}>
                    採用して 入力欄 に 貼る
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mb-2 flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerateSuggestion}
            disabled={aiSuggestBusy || unfollowed || messages.length === 0}
            title="会話 履歴 を もと に AI が 返信 案 を 提案 (AI 上限 に 1 回 カウント)"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            AI で 返信 案 を 生成
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setStickerPickerOpen((v) => !v);
              setJobShareOpen(false);
            }}
            disabled={unfollowed || sending}
            aria-label="スタンプ を 選ぶ"
            className="shrink-0"
          >
            <Smile className="size-4" aria-hidden />
          </Button>
          <label
            className={`border-input bg-background hover:bg-accent inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border text-sm ${
              unfollowed || sending ? "pointer-events-none opacity-50" : ""
            }`}
            aria-label="画像 を 送信"
          >
            <ImageIcon className="size-4" aria-hidden />
            <input
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onSendImage(f);
                e.target.value = "";
              }}
            />
          </label>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setJobShareOpen((v) => !v);
              setStickerPickerOpen(false);
              setMeetingProposeOpen(false);
            }}
            disabled={unfollowed || sending}
            aria-label="求人 を 共有"
            className="shrink-0"
          >
            <Briefcase className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setMeetingProposeOpen((v) => !v);
              setStickerPickerOpen(false);
              setJobShareOpen(false);
            }}
            disabled={unfollowed || sending}
            aria-label="面談 日程 を 提案"
            className="shrink-0"
          >
            <CalendarClock className="size-4" aria-hidden />
          </Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              unfollowed ? "解除 された 相手 には 送信 できません" : "メッセージ を 入力..."
            }
            disabled={unfollowed || sending}
            rows={2}
            className="border-input bg-background min-h-11 flex-1 resize-none rounded-md border px-3 py-2 text-sm"
          />
          <Button
            onClick={onSend}
            disabled={!text.trim() || sending || unfollowed}
            className="bg-[#06C755] text-white hover:bg-[#05a647]"
          >
            {sending ? "送信中" : "送信"}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">
          Cmd/Ctrl + Enter で 送信 · 30 秒以内 の Reply は 無料、 過ぎていれば Push (課金通数 1)
        </p>
      </div>
    </>
  );
}

/** 同日 か 判定 (ISO 文字列 同士)。 日付 区切り 用 */
function isSameDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function DateSeparator({ iso }: { iso: string }) {
  const d = new Date(iso);
  const today = new Date();
  let label: string;
  if (isSameDay(iso, today.toISOString())) {
    label = "今日";
  } else {
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    if (isSameDay(iso, yesterday.toISOString())) {
      label = "昨日";
    } else {
      label = d.toLocaleDateString("ja-JP", {
        year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
        month: "long",
        day: "numeric",
        weekday: "short",
      });
    }
  }
  return (
    <div className="my-4 flex justify-center">
      <span className="rounded-full bg-slate-300/70 px-3 py-1 text-[10px] font-medium text-slate-700">
        {label}
      </span>
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  if (message.messageType === "system") {
    // 「興味あり」 等 の 構造化 system は 目立つ カード で 表示
    if (message.systemKind === "job_interest") {
      const meta = message.systemMeta;
      const jobLabel =
        meta?.position && meta?.companyName
          ? `${meta.position} / ${meta.companyName}`
          : meta?.position || meta?.companyName || "(求人 情報 取得失敗)";
      const sender = meta?.senderDisplayName ?? "求職者";
      return (
        <div className="my-3 flex justify-center">
          <div className="flex max-w-md items-start gap-2 rounded-lg border-2 border-pink-200 bg-pink-50 px-3 py-2 shadow-sm">
            <Heart className="size-4 shrink-0 fill-pink-500 text-pink-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-pink-800">
                {sender} さん が 興味あり と 回答
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-800">{jobLabel}</p>
              {meta?.jobId && (
                <a
                  href={`/agency/jobs/${meta.jobId}`}
                  className="mt-1 inline-block text-[10px] text-pink-700 underline hover:text-pink-900"
                >
                  求人 詳細 を 開く →
                </a>
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-slate-300/70 px-3 py-1 text-[10px] font-medium text-slate-700">
          {message.text ?? "[システム]"}
        </span>
      </div>
    );
  }

  const isOutbound = message.direction === "outbound";
  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} gap-2`}>
      <div className="flex max-w-[75%] flex-col gap-0.5">
        <div
          className={`rounded-2xl px-3 py-2 text-sm wrap-break-word ${
            isOutbound
              ? "bg-[#06C755] text-white"
              : "border border-slate-200 bg-white text-slate-900"
          }`}
        >
          {renderContent(message)}
        </div>
        <div className={`text-[10px] text-slate-500 ${isOutbound ? "self-end" : "self-start"}`}>
          {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {isOutbound && message.sendStatus === "failed" && (
            <span className="ml-1 text-red-600">送信失敗</span>
          )}
          {isOutbound && message.sendStatus === "queued" && (
            <span className="ml-1 text-amber-600">送信中...</span>
          )}
          {isOutbound && message.sendMethod === "reply" && (
            <span className="ml-1 text-emerald-700">Reply</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduledMeetingsBanner({
  meetings,
  onCanceled,
}: {
  meetings: Array<{ id: string; title: string; startsAt: string; joinUrl: string }>;
  onCanceled: () => Promise<void>;
}) {
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCancel = async (meetingId: string) => {
    const ok = window.confirm(
      "この 面談 を キャンセル しますか?\nZoom 会議 削除 + LINE で 求職者 に 通知 されます。",
    );
    if (!ok) return;
    setCancelingId(meetingId);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/cancel-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingScheduleId: meetingId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await onCanceled();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-xs font-semibold text-emerald-800">確定済 面談 ({meetings.length} 件)</p>
      {meetings.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{m.title}</p>
            <p className="text-emerald-700">
              {new Date(m.startsAt).toLocaleString("ja-JP", {
                month: "numeric",
                day: "numeric",
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="flex gap-1">
            <a
              href={m.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-emerald-300 bg-white px-2 py-1 text-emerald-700 hover:bg-emerald-100"
            >
              Zoom
            </a>
            <button
              onClick={() => onCancel(m.id)}
              disabled={cancelingId === m.id}
              className="rounded border border-red-300 bg-white px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {cancelingId === m.id ? "キャンセル中..." : "キャンセル"}
            </button>
          </div>
        </div>
      ))}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function renderContent(m: ConversationMessage) {
  switch (m.messageType) {
    case "text":
      return <span style={{ whiteSpace: "pre-wrap" }}>{m.text ?? "[復号失敗]"}</span>;
    case "sticker":
      if (m.stickerId) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${STICKER_CDN}/${m.stickerId}/android/sticker.png`}
            alt="sticker"
            className="h-24 w-24"
          />
        );
      }
      return <span className="text-muted-foreground italic">[スタンプ]</span>;
    case "image":
      if (m.hasAttachment) {
        return (
          <a
            href={`/api/agency/line/attachments/${m.id}?inline=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/agency/line/attachments/${m.id}?inline=1`}
              alt="image"
              className="max-h-64 max-w-full rounded"
              loading="lazy"
            />
          </a>
        );
      }
      return <span className="italic">[画像]</span>;
    case "video":
      if (m.hasAttachment) {
        return (
          <video
            src={`/api/agency/line/attachments/${m.id}?inline=1`}
            controls
            className="max-h-64 max-w-full rounded"
          />
        );
      }
      return <span className="italic">[動画]</span>;
    case "audio":
      if (m.hasAttachment) {
        return (
          <audio
            src={`/api/agency/line/attachments/${m.id}?inline=1`}
            controls
            className="max-w-full"
          />
        );
      }
      return <span className="italic">[音声]</span>;
    case "file":
      if (m.hasAttachment) {
        return (
          <a
            href={`/api/agency/line/attachments/${m.id}?inline=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            <Paperclip className="size-3.5" aria-hidden />
            <span>{m.attachmentFileName ?? "ファイル"}</span>
          </a>
        );
      }
      return <span className="italic">[ファイル]</span>;
    case "location":
      return <span className="italic">[位置情報]</span>;
    case "flex":
    case "template":
      return <span className="italic">[リッチメッセージ]</span>;
    default:
      return <span className="italic">[{m.messageType}]</span>;
  }
}
