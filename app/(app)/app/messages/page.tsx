import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listThreads } from "@/lib/advisor/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /app/messages
 *
 * 求職者 向け advisor チャット 一覧。 RLS で 自分 が seeker の thread だけ 見える。
 */
export default async function MessagesIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const threads = await listThreads(supabase);

  // 相手 (エージェント) の 組織 名 を 一括 取得
  const orgIds = Array.from(new Set(threads.map((t) => t.organizationId)));
  let orgNameMap = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
    orgNameMap = new Map(
      ((orgs ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]),
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app" className="hover:underline">
            ← ダッシュボード
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">エージェント と の メッセージ</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          連携 して いる エージェント 担当者 と Maira 上 で 直接 やり取り できます。
        </p>
      </div>

      {threads.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          まだ 会話 は ありません。 エージェント から メッセージ が 届く と ここ に 表示 されます。
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => {
            const orgName = orgNameMap.get(t.organizationId) ?? "エージェント";
            const lastAt = t.lastMessageAt
              ? new Date(t.lastMessageAt).toLocaleString("ja-JP")
              : "—";
            return (
              <Link
                key={t.id}
                href={`/app/messages/${t.id}`}
                className="block rounded-md border bg-white p-4 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{orgName}</span>
                  <span className="text-muted-foreground text-[10px]">{lastAt}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {t.lastMessagePreview ?? "(まだ メッセージ が ありません)"}
                  </p>
                  {t.unreadForSeeker > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {t.unreadForSeeker}
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
