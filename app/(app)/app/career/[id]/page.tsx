import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getMessages, verifyConversationOwner } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";
import { CareerChatForm } from "./chat-form";

/**
 * キャリア棚卸し:個別会話画面
 *
 * Server Component で過去メッセージをDBから取得し、クライアント側の useChat に
 * 初期値として渡す。所有者でない / モジュール不一致のIDなら 404 を返す。
 */
export default async function CareerConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isOwner = await verifyConversationOwner(id, user.id);
  if (!isOwner) notFound();

  const initialMessages = await getMessages(id);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">キャリア棚卸し</h1>
          <p className="text-muted-foreground text-xs">会話は自動的に保存されます</p>
        </div>
        <Button render={<Link href="/app/career" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <CareerChatForm conversationId={id} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
