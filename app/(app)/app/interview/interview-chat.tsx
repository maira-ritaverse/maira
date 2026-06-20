"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const SESSION_OPENER = "(面接開始)";

/**
 * 面接シミュレーター(本格化)
 *
 * 機能:
 *   - セッション (interview_sessions) を 新規 作成 して 永続化
 *   - 各 メッセージ は 送信 完了時 に /api/interview/sessions/[id] へ POST (暗号化保存)
 *   - 音声入力: Web Speech API (SpeechRecognition)。 未対応 ブラウザ は テキスト のみ
 *   - 音声出力: speechSynthesis (assistant の 応答 完了時 に 読み上げ)
 *   - 完了 → 詳細レポート ページ へ 遷移 (PDF は そこ で window.print)
 *
 * 音声 周り の 既知 問題 と 対策:
 *   - iOS Safari は voices.getVoices() が 初回 空 → onvoiceschanged で 再取得
 *   - iOS Safari は ページ ロード 直後 の speak() が 詰まる → ユーザ 操作 を 起点 に 起動
 *   - 押下中 PTT は スマホ で 誤動作 が 多い → タップ で toggle 式 に 変更
 *   - 認識 エラー は alert ではなく インライン Alert で 静的 表示 (not-allowed 等 を 分類)
 */

type SpeechErrorKind = "not_allowed" | "no_speech" | "audio_capture" | "network" | "other";

const SPEECH_ERROR_LABEL: Record<SpeechErrorKind, string> = {
  not_allowed:
    "マイク 権限 が ありません。 ブラウザ の URL 横 の ロック マーク → サイト 設定 で 「マイク」を 許可 して ください。",
  no_speech: "音声 が 検出 されません でした。 マイク に 向かって もう 一度 話して みて ください。",
  audio_capture: "マイク を 認識 できません。 デバイス が 接続 されて いる か 確認 して ください。",
  network: "ネットワーク エラー で 認識 に 失敗 しました。 通信 環境 を 確認 して ください。",
  other: "音声 認識 で エラー が 発生 しました。 再試行 して ください。",
};

export function InterviewChat() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const openerSentRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastSpokenAssistantIdRef = useRef<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [position, setPosition] = useState("");
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [input, setInput] = useState("");
  const [interimText, setInterimText] = useState("");
  const [completed, setCompleted] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<SpeechErrorKind | null>(null);
  // 初回 mount 時 に ブラウザ 側 で 1 回 だけ 評価 (lazy initializer)。
  // useEffect 内 で setState する と eslint react-hooks/set-state-in-effect が
  // 警告 を 出す ため、 ライブラリ 検知 は ここ で 完結 させる。
  const [voiceSupported] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const SR =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    return Boolean(SR);
  });

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
      const text = extractText(message);
      if (sessionId && text) {
        void persistMessage(sessionId, "assistant", text);
      }
      if (voiceEnabled && text && lastSpokenAssistantIdRef.current !== message.id) {
        lastSpokenAssistantIdRef.current = message.id;
        speakWithVoice(text, voiceRef.current, () => setIsSpeaking(false));
        setIsSpeaking(true);
      }
    },
  });

  // 開始 → セッション 作成 + opener 送信
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

    // iOS Safari 対策: 既存 TTS キュー を 一度 クリア (ロード 直後 詰まり 防止)
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    openerSentRef.current = true;
    sendMessage({
      role: "user",
      parts: [{ type: "text", text: SESSION_OPENER }],
    } as UIMessage);
  }, [started, companyName, position, sendMessage]);

  // 新着 → 最下部 へ スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // SpeechRecognition 初期化 (voiceSupported は 既 に lazy initializer で 判定 済)
  useEffect(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText) {
        setInput((prev) => (prev ? `${prev} ${finalText}` : finalText));
        setInterimText("");
      } else {
        setInterimText(interim);
      }
    };
    rec.onend = () => {
      setIsRecording(false);
      setInterimText("");
    };
    rec.onerror = (event: Event) => {
      setIsRecording(false);
      setInterimText("");
      // SpeechRecognitionErrorEvent は TS 標準 lib に 未収録 (実行時 は ある)。
      // event.error は 仕様 で string な ので unknown 経由 で 取り出す。
      const err = (event as unknown as { error?: string }).error ?? "other";
      setSpeechError(classifySpeechError(err));
    };
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  // speechSynthesis voice 選定 (onvoiceschanged が iOS で 必須)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      // 優先: ja-JP の Kyoko (iOS) / Otoya / Google 日本語 / 任意 ja-JP
      const ja = voices.filter((v) => v.lang === "ja-JP" || v.lang.startsWith("ja"));
      const preferred =
        ja.find((v) => /Kyoko/i.test(v.name)) ??
        ja.find((v) => /Otoya/i.test(v.name)) ??
        ja.find((v) => /Google/i.test(v.name)) ??
        ja[0];
      if (preferred) voiceRef.current = preferred;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const toggleRecording = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (isRecording) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    } else {
      setSpeechError(null);
      setInterimText("");
      try {
        rec.start();
        setIsRecording(true);
      } catch {
        // 既に 起動 中 等 — 状態 を 同期
        setIsRecording(true);
      }
    }
  }, [isRecording]);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    setIsSpeaking(false);
  }, []);

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
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const summary = lastAssistant ? extractText(lastAssistant) : "";
      await fetch(`/api/interview/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markCompleted: true, summary: summary || undefined }),
      });
      setCompleted(true);
      stopSpeaking();
    } catch {
      // ignore
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
          音声 モード を 使う (質問 読み上げ + 音声 入力。 マイク 許可 が 必要)
        </label>
        {voiceEnabled && !voiceSupported && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              この ブラウザ は 音声 入力 に 対応 して いません。 テキスト 入力 で 進めて ください。
              (Chrome / Edge / Safari の 最新版 推奨)
            </AlertDescription>
          </Alert>
        )}
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
        {isSpeaking && (
          <div className="flex items-center justify-end gap-2 text-xs text-emerald-700">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            読み上げ 中
            <Button type="button" size="sm" variant="outline" onClick={stopSpeaking}>
              停止
            </Button>
          </div>
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
        {speechError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              {SPEECH_ERROR_LABEL[speechError]}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <form onSubmit={submit} className="border-foreground/10 space-y-2 border-t p-3">
        {/* 音声 認識 中 の interim 結果 */}
        {isRecording && interimText && (
          <p className="text-muted-foreground text-[10px] italic">認識中: {interimText}</p>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="回答を入力(Enter で送信)"
            maxLength={2000}
            disabled={status === "streaming" || completed}
          />
          {voiceEnabled && voiceSupported && (
            <Button
              type="button"
              variant={isRecording ? "default" : "outline"}
              onClick={toggleRecording}
              disabled={status === "streaming" || completed}
              title="タップ で 録音 開始 / 停止"
              className={isRecording ? "animate-pulse bg-red-500 text-white hover:bg-red-600" : ""}
            >
              {isRecording ? "● 録音中" : "話す"}
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
        </div>
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

/**
 * 選択 された voice を 使って 読み上げ。 voice=null なら ブラウザ デフォルト。
 * 読み上げ 終了 時 に onDone を 呼ぶ (UI の isSpeaking 制御 用)。
 */
function speakWithVoice(
  text: string,
  voice: SpeechSynthesisVoice | null,
  onDone: () => void,
): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onDone();
    return;
  }
  try {
    // 直前 の 読み上げ が 残って いれば クリア (iOS Safari の キュー 詰まり 対策)
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 1.0;
    if (voice) utter.voice = voice;
    utter.onend = () => onDone();
    utter.onerror = () => onDone();
    window.speechSynthesis.speak(utter);
  } catch {
    onDone();
  }
}

function classifySpeechError(error: string): SpeechErrorKind {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "not_allowed";
    case "no-speech":
      return "no_speech";
    case "audio-capture":
      return "audio_capture";
    case "network":
      return "network";
    default:
      return "other";
  }
}
