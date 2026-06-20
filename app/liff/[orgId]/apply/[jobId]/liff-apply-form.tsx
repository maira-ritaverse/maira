"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * LIFF 応募 フォーム (Client Component)
 *
 * - LIFF SDK 初期化 + プロフィール 取得 + ID Token 取得
 * - 「応募 する」 → POST /api/liff/applications
 *   ・サーバ で ID Token 検証
 *   ・line_messages に system "応募希望" を 記録
 *   ・3 チャンネル 通知 (in-app / Slack / メール)
 */
import "@/lib/line/liff-types";

type Props = {
  liffId: string;
  lineChannelId: string;
  orgId: string;
  jobId: string;
  jobLabel: string;
};

export function LiffApplyForm({ liffId, lineChannelId, orgId, jobId, jobLabel }: Props) {
  const [liffReady, setLiffReady] = useState(false);
  const [profile, setProfile] = useState<{ userId: string; displayName: string } | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        for (let i = 0; i < 50; i += 1) {
          if (typeof window !== "undefined" && window.liff) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!window.liff) {
          setError("LIFF SDK 読込 失敗");
          return;
        }
        await window.liff.init({ liffId });
        setLiffReady(true);
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }
        const p = await window.liff.getProfile();
        setProfile({ userId: p.userId, displayName: p.displayName });
        setIdToken(window.liff.getIDToken());
      } catch (e) {
        setError(e instanceof Error ? e.message : "LIFF 初期化 失敗");
      }
    };
    void init();
  }, [liffId]);

  const onSubmit = async () => {
    if (!idToken) {
      setError("LINE 認証 トークン が ありません");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/liff/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          jobId,
          idToken,
          lineChannelId,
          comment,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信 失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const onClose = () => {
    if (window.liff?.closeWindow) {
      window.liff.closeWindow();
    } else {
      window.history.back();
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        <Card className="space-y-3 p-5 text-center">
          <h1 className="text-lg font-bold">応募 を 受け付けました</h1>
          <p className="text-sm">
            「{jobLabel}」 への 応募希望 を 担当エージェント に 送信 しました。 改めて LINE で
            ご連絡 します。
          </p>
          <Button onClick={onClose} className="w-full">
            閉じる
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header>
        <p className="text-muted-foreground text-xs">応募 確認</p>
        <h1 className="text-lg font-bold">{jobLabel}</h1>
      </header>

      <Card className="space-y-3 p-4">
        {liffReady && profile ? (
          <div className="text-sm">
            <p className="text-muted-foreground text-xs">応募者 (LINE プロフィール)</p>
            <p className="font-semibold">{profile.displayName}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">LINE 情報 を 取得 中...</p>
        )}

        <div className="space-y-1">
          <label htmlFor="liff-comment" className="text-xs font-semibold">
            希望 / メモ (任意)
          </label>
          <textarea
            id="liff-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="例: 希望面接日 / 質問 など"
            className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-muted-foreground text-[10px]">{comment.length} / 1,000 字</p>
        </div>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="sticky bottom-4 space-y-2">
        <Button
          onClick={onSubmit}
          disabled={!liffReady || !profile || !idToken || submitting}
          className="w-full bg-[#06C755] text-white hover:bg-[#05a647]"
        >
          {submitting ? "送信中..." : "この 内容 で 応募 する"}
        </Button>
        <Link
          href={`/liff/${orgId}/jobs/${jobId}`}
          className="block text-center text-xs text-slate-600 underline"
        >
          求人詳細 に 戻る
        </Link>
      </div>
    </div>
  );
}
