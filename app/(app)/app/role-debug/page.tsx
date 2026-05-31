import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 開発用:現在のユーザーのロール情報を表示
 *
 * マルチテナント基盤(Phase 1)の動作確認用ページ。
 * 本番リリース前に削除 or 管理者限定にする予定。
 */
export default async function RoleDebugPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">ロール情報(開発用)</h1>
      <Card>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">アカウント種別</dt>
              <dd className="text-muted-foreground">{role.accountType}</dd>
            </div>
            {role.organization && (
              <div>
                <dt className="font-medium">所属企業</dt>
                <dd className="text-muted-foreground">
                  {role.organization.name}(ID: {role.organization.id})
                </dd>
              </div>
            )}
            {role.member && (
              <div>
                <dt className="font-medium">企業内ロール</dt>
                <dd className="text-muted-foreground">{role.member.role}</dd>
              </div>
            )}
            {role.accountType === "seeker" && (
              <p className="text-muted-foreground">このアカウントは求職者(seeker)です。</p>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
