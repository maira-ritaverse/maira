import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listOrgMeetings } from "@/lib/meetings/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { MeetingsListClient } from "./meetings-list-client";

/**
 * 面談一覧ページ
 *
 * 組織全体の Web 面談予約(Zoom / Google Meet)を一覧表示する。
 * 今後と過去をタブで切替、各行に再スケジュール / キャンセル / 参加 / 録画閲覧の
 * クイックアクションを提供する。
 */
export default async function MeetingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  // 今後 + 直近過去(60 日)を並列取得
  const [upcoming, past] = await Promise.all([
    listOrgMeetings(supabase, role.organization.id, { past: false, limit: 100 }),
    listOrgMeetings(supabase, role.organization.id, { past: true, limit: 60 }),
  ]);

  // クライアント名マップ(行の表示用)
  const clientIds = Array.from(
    new Set(
      [...upcoming, ...past].map((m) => m.clientRecordId).filter((v): v is string => v !== null),
    ),
  );
  const clientNameMap = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data } = await supabase.from("client_records").select("id, name").in("id", clientIds);
    if (data) {
      for (const c of data as Array<{ id: string; name: string }>) {
        clientNameMap.set(c.id, c.name);
      }
    }
  }
  const clientNames = Object.fromEntries(clientNameMap);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">面談</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Zoom / Google Meet の予約・参加・録画取込状況を一覧で管理できます。
        </p>
      </div>

      {upcoming.length === 0 && past.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm">まだ面談の予約はありません。</p>
          <p className="text-muted-foreground mt-1 text-xs">
            クライアント詳細から「面談を予約」を押すと作成できます。
          </p>
        </Card>
      ) : (
        <MeetingsListClient upcoming={upcoming} past={past} clientNames={clientNames} />
      )}
    </div>
  );
}
