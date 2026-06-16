import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getInterviewSessionWithMessages } from "@/lib/interview/sessions";

import { InterviewReport } from "./interview-report";

/**
 * 面接セッション詳細(評価レポート)
 *
 * 全メッセージを時系列で表示 + AI 総評 + 印刷スタイル(window.print → PDF)。
 * 本人(user_id 一致)のみ閲覧可。
 */
type RouteParams = { params: Promise<{ id: string }> };

export default async function InterviewSessionPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getInterviewSessionWithMessages(id);
  if (!data) notFound();

  return <InterviewReport session={data.session} messages={data.messages} />;
}
