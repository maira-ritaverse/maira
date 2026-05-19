import { redirect } from "next/navigation";
import { createCareerConversation } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * 新規キャリア棚卸し会話の作成
 *
 * このページに到達したら即座に新セッションを作成し、
 * /app/career/[id] にリダイレクトする(URL に永続的な ID を残すため)。
 */
export default async function NewCareerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const conversationId = await createCareerConversation(user.id);

  redirect(`/app/career/${conversationId}`);
}
