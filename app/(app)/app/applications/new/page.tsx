import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ApplicationForm } from "../application-form";

/**
 * 新規応募作成ページ
 *
 * フォーム本体は ApplicationForm(クライアントコンポーネント)に委譲。
 * このページは認証チェックとレイアウトのみを担当する。
 */
export default async function NewApplicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">新規応募を追加</h1>
        <Button render={<Link href="/app/applications" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      <ApplicationForm mode="create" />
    </div>
  );
}
