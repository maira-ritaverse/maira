"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const SESSION_OPENER = "(面接開始)";

/**
 * 面接シミュレーター(本格化)
 *
 * 機能:
 *   - セッション(interview_sessions)を新規作成して永続化
 *   - 各メッセージは送信完了時に /api/interview/sessions/[id] へ POST(暗号化保存)
 *   - 音声入力:Web Speech API(SpeechRecognition)。未対応ブラウザはテキストのみ
 *   - 音声出力:speechSynthesis(assistant の応答完了時に読み上げ)
 *   - 完了 → 詳細レポートページへ遷移(PDF はそこで window.print)
 *
 * 注意:
 *   - SpeechRecognition / speechSynthesis は Safari iOS で挙動が不安定。
 *     UI は「音声 ON/OFF トグル」を提供し、ユーザの選択を尊重する
 */
export function InterviewChat() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const openerSentRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastSpokenAssistantIdRef = useRef<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [position, setPosition] = useState("");
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [input, setInput] = useState("");
  const [completed, setCompleted] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/interview/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          messages,
          positionContext: {
            companyName: companyName || undefined,
            position: position || undefined,
          },
        },
      }),
    }),
    onFinish: ({ message }) => {
      // assistant 応答の永続化(暗号化は API で行う)
      const text = extractText(message);
      if (sessionId && text) {
        void persistMessage(sessionId, "assistant", text);
      }
      // 音声 ON なら読み上げ(初回は SESSION_OPENER 由来 → ユーザ向けの最初の質問)
      if (voiceEnabled && text && lastSpokenAssistantIdRef.current !== message.id) {
        lastSpokenAssistantIdRef.current = message.id;
        speak(text);
      }
    },
  });

  // 開始 → セッション作成 + ダミー入力で AI の最初の質問を引き出す
  useEffect(() => {
    if (!started) return;
    if (openerSentRef.current) return;
    const init = async () => {
      try {
        const res = await fetch("/api/interview/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positionContext: {
              companyName: companyName || undefined,
              position: position || undefined,
            },
          }),
        });
        if (!res.ok) {
          setPersistError(`セッション作成失敗: HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as { id?: string };
        if (json.id) setSessionId(json.id);
      } catch (err) {
        setPersistError(err instanceof Error ? err.message : "不明なエラー");
      }
    };
    void init();

    openerSentRef.current = true;
    sendMessage({
      role: "user",
      parts: [{ type: "text", text: SESSION_OPENER }],
    } as UIMessage);
  }, [started, companyName, position, sendMessage]);

  // 新着 → 最下部へスクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // SpeechRecognition 初期化(ブラウザ対応してれば)
  useEffect(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event: SpeechRecognitionEvent) => {
      const text = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const startRecording = () => {
    const rec = recognitionRef.current;
    if (!rec) {
      alert("このブラウザは音声入力に対応していません(Chrome / Edge / Safari の最新版を推奨)");
      return;
    }
    try {
      rec.start();
      setIsRecording(true);
    } catch {
      // already started
    }
  };

  const stopRecording = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "streaming") return;
    const text = input;
    setInput("");
    if (sessionId) void persistMessage(sessionId, "user", text);
    sendMessage({ role: "user", parts: [{ type: "text", text }] } as UIMessage);
  };

  const completeSession = async () => {
    if (!sessionId) return;
    try {
      // AI の最後の応答(総評想定)を summary として保存する。
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const summary = lastAssistant ? extractText(lastAssistant) : "";
      await fetch(`/api/interview/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markCompleted: true, summary: summary || undefined }),
      });
      setCompleted(true);
    } catch {
      // 表示は失敗しても続けられるので握りつぶす
    }
  };

  if (!started) {
    return (
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">セットアップ</h2>
        <p className="text-muted-foreground text-xs">
          任意:想定する企業 / ポジションを入力すると、面接官 AI がその文脈に合わせた質問をします。
        </p>
        <div className="space-y-2">
          <label htmlFor="cn" className="text-muted-foreground text-xs">
            想定企業名(任意)
          </label>
          <Input
            id="cn"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="例:○○株式会社"
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="pos" className="text-muted-foreground text-xs">
            ポジション(任意)
          </label>
          <Input
            id="pos"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="例:バックエンドエンジニア"
            maxLength={100}
          />
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
          />
          音声モードを使う(質問読み上げ + 音声入力。マイク許可が必要)
        </label>
        <Button onClick={() => setStarted(true)}>面接を開始する</Button>
      </Card>
    );
  }

  return (
    <Card className="flex h-[65vh] flex-col p-0">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages
          .filter((m) => {
            if (m.role !== "user") return true;
            return extractText(m) !== SESSION_OPENER;
          })
          .map((m) => {
            const text = extractText(m);
            return (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {text}
                </div>
              </div>
            );
          })}
        {status === "streaming" && (
          <div className="text-muted-foreground text-xs">面接官 AI が応答中…</div>
        )}
        {error && (
          <div className="text-xs text-red-600 dark:text-red-300">
            エラーが発生しました:{error.message}
          </div>
        )}
        {persistError && (
          <div className="text-xs text-amber-600 dark:text-amber-300">
            (保存エラー:{persistError} — 履歴は失われる可能性があります)
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-foreground/10 flex items-center gap-2 border-t p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="回答を入力(Enter で送信)"
          maxLength={2000}
          disabled={status === "streaming" || completed}
        />
        {voiceEnabled && (
          <Button
            type="button"
            variant="outline"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={status === "streaming" || completed}
            title="長押し中に話してください"
          >
            🎤 {isRecording ? "録音中…" : "話す"}
          </Button>
        )}
        <Button type="submit" disabled={!input.trim() || status === "streaming" || completed}>
          送信
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void completeSession()}
          disabled={completed || !sessionId}
          title="セッションを完了化してレポートを保存"
        >
          完了
        </Button>
      </form>

      {completed && sessionId && (
        <div className="border-foreground/10 border-t p-3">
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            セッションを完了しました。
          </p>
          <Link href={`/app/interview/${sessionId}`} className="text-primary text-sm underline">
            評価レポートを開く
          </Link>
        </div>
      )}
    </Card>
  );
}

function extractText(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

async function persistMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  try {
    await fetch(`/api/interview/sessions/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
  } catch {
    // 永続化失敗はセッション継続に影響させない
  }
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  } catch {
    // ignore unsupported
  }
}
