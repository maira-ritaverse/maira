import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listThreads } from "@/lib/advisor/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /agency/advisor
 *
 * エージェント 向け advisor チャット (求職者 と の DM) 一覧。
 * 「LINE 連携 して いない 求職者 と も やり取り したい」場合 の メイン 経路。
 *
 * 各 行 から 詳細 チャット へ 遷移 (/agency/advisor/[id])。
 */
export default async function AgencyAdvisorIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const threads = await listThreads(supabase);

  // 相手 (求職者) の 表示 名 を 一括 取得
  const clientIds = Array.from(new Set(threads.map((t) => t.clientRecordId)));
  let nameMap = new Map<string, string | null>();
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("client_records")
      .select("id, display_name")
      .in("id", clientIds);
    nameMap = new Map(
      ((clients ?? []) as Array<{ id: string; display_name: string | null }>).map((c) => [
        c.id,
        c.display_name,
      ]),
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">求職者 メッセージ</h1>
        <Link
          href="/agency"
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          ← ホーム
        </Link>
      </div>
      <p className="text-muted-foreground text-sm">
        Maira アプリ 内 の 求職者 と の DM 一覧。 LINE 連携 が なく ても やり取り できます。
      </p>

      {threads.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          まだ 会話 は ありません。 求職者 詳細 画面 から 「メッセージ を 送る」で 新規 開始
          できます。
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => {
            const name = nameMap.get(t.clientRecordId) ?? "求職者";
            const lastAt = t.lastMessageAt
              ? new Date(t.lastMessageAt).toLocaleString("ja-JP")
              : "—";
            return (
              <Link
                key={t.id}
                href={`/agency/advisor/${t.id}`}
                className="block rounded-md border bg-white p-4 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground text-[10px]">{lastAt}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {t.lastMessagePreview ?? "(まだ メッセージ が ありません)"}
                  </p>
                  {t.unreadForAgency > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {t.unreadForAgency}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
