import { redirect } from "next/navigation";
import { DiagnosisTake } from "@/components/features/diagnosis/diagnosis-take";
import { createClient } from "@/lib/supabase/server";

/**
 * 診断の回答画面(Server Component)
 *
 * ロジック・state は client コンポーネントに任せ、ここでは
 * - 認証チェック(layout でも実施しているが、防御的に二重で行う)
 * - クライアント側に渡すべき初期データは現状なし
 * のみを担当する。
 */
export default async function DiagnosisTakePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <DiagnosisTake />;
}
