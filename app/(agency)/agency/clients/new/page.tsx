import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { Button } from "@/components/ui/button";
import { ClientForm } from "./client-form";

/**
 * クライアント新規登録ページ
 *
 * layout.tsx でロールガードは終わっているが、API 直叩き対策と同様に
 * Server Component 側でも明示チェックする(防御的)。
 */
export default async function NewClientPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member") {
    redirect("/app");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">クライアント登録</h1>
        <Button render={<Link href="/agency/clients" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>
      <ClientForm />
    </div>
  );
}
