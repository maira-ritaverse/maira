import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { InterviewChat } from "./interview-chat";

/**
 * 面接シミュレーター(本格化版)
 *
 * - チャット部:新規セッション開始 + 永続化 + 音声 I/O
 * - 履歴部:過去セッションの一覧(レポートを開ける)
 */
export default async function InterviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 過去セッション一覧(軽量:summary は読まない)
  const { data: pastSessions } = await supabase
    .from("interview_sessions")
    .select("id, position_context, started_at, completed_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(20);

  type PastRow = {
    id: string;
    position_context: { companyName?: string; position?: string } | null;
    started_at: string;
    completed_at: string | null;
  };
  const past = (pastSessions ?? []) as PastRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">面接シミュレーター</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          ベテラン面接官 AI が 5〜8 問の質問を出し、回答ごとにフィードバックを返します。 音声入力 /
          読み上げにも対応(セットアップ画面で ON にしてください)。
        </p>
      </div>

      <InterviewChat />

      {past.length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="text-lg font-semibold">過去のセッション</h2>
          <ul className="divide-foreground/10 divide-y">
            {past.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <Link
                  href={`/app/interview/${p.id}`}
                  className="hover:bg-accent flex flex-wrap items-baseline justify-between gap-2 rounded px-1 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">
                      {p.position_context?.companyName || p.position_context?.position
                        ? `${p.position_context.companyName ?? ""} ${p.position_context.position ?? ""}`.trim()
                        : "一般想定の面接"}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(p.started_at).toLocaleString("ja-JP")}
                    {p.completed_at ? "(完了)" : "(未完了)"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
