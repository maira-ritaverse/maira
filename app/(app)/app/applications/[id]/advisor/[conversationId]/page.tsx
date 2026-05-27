import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getApplication, verifyApplicationOwner } from "@/lib/applications/queries";
import { getMessages } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";
import { AdvisorChatForm } from "./chat-form";

/**
 * 応募アドバイザー チャット画面
 *
 * 経路:
 * - 応募詳細の「Mairaに相談する」→ /advisor/session で conversation を作成 → ここに遷移
 *
 * 二重確認(notFound 条件):
 * - 自分の application でない
 * - 自分の conversation でない
 * - conversation の module が application_tracker でない
 * - conversation.metadata.application_id が URL の applicationId と一致しない
 */
export default async function AdvisorChatPage({
  params,
}: {
  params: Promise<{ id: string; conversationId: string }>;
}) {
  const { id: applicationId, conversationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isOwner = await verifyApplicationOwner(applicationId, user.id);
  if (!isOwner) notFound();

  const { data: conv } = await supabase
    .from("conversations")
    .select("user_id, module, metadata")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.user_id !== user.id || conv.module !== "application_tracker") {
    notFound();
  }

  const metadata = (conv.metadata ?? {}) as { application_id?: string };
  if (metadata.application_id !== applicationId) {
    notFound();
  }

  const [application, initialMessages] = await Promise.all([
    getApplication(applicationId, user.id),
    getMessages(conversationId),
  ]);

  if (!application) notFound();

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Mairaに相談</h1>
          <p className="text-muted-foreground truncate text-xs">
            応募:{application.details.company} / {application.details.position}
          </p>
        </div>
        <Button
          render={<Link href={`/app/applications/${applicationId}`} />}
          variant="outline"
          size="sm"
        >
          応募に戻る
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <AdvisorChatForm
          applicationId={applicationId}
          conversationId={conversationId}
          initialMessages={initialMessages}
        />
      </div>
    </div>
  );
}
