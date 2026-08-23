import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * /agency/line (index) — トーク 未選択 時 の 空状態
 *
 * 左 の サイドバー から 会話 を 選ぶ と /agency/line/[lineUserId] が 中央 + 右 に
 * 表示 される。 ここ は その 前 の 状態。
 */
export default async function AgencyLineEmptyState() {
  // 過去履歴 取込 は admin 限定(/agency/line/import が非管理者を redirect する)。
  // advisor には辿れないリンクを出さない。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getUserRole(user.id) : null;
  const isAdmin = role?.member?.role === "admin";

  return (
    <div className="flex flex-1 items-center justify-center bg-slate-100">
      <div className="max-w-xs space-y-3 text-center">
        <div className="bg-muted mx-auto flex h-14 w-14 items-center justify-center rounded-full">
          <MessageCircle className="size-7 text-slate-400" aria-hidden />
        </div>
        <p className="text-sm font-medium">トーク を 選択 して ください</p>
        <p className="text-muted-foreground text-xs">
          左 の 一覧 から 会話 を 選ぶ と、 ここ に メッセージ が 表示 されます。
        </p>
        <div className="text-muted-foreground flex flex-wrap justify-center gap-3 pt-2 text-xs">
          <Link href="/agency/line/users" className="hover:text-foreground underline">
            友達 / 紐付け
          </Link>
          <Link href="/agency/line/broadcasts" className="hover:text-foreground underline">
            一斉配信
          </Link>
          {isAdmin && (
            <Link href="/agency/line/import" className="hover:text-foreground underline">
              過去履歴 取込
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
