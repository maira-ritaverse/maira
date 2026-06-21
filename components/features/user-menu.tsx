"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/auth/actions";

type Props = {
  email: string;
  displayName: string | null;
  /**
   * 「設定」 リンク の 遷移 先。
   * 求職者 (app) は "/app/settings"、 エージェント (agency) は "/agency/settings"。
   * layout 側 で 明示 する (= 固定 にする と 反対 側 へ 飛んで 不整合 が 起きる)。
   */
  settingsHref: string;
  /** アバター 画像 の public URL (null なら 頭文字 fallback) */
  avatarUrl?: string | null;
};

export function UserMenu({ email, displayName, settingsHref, avatarUrl }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      await logout();
    });
  };

  // 表示名がなければメールアドレスの先頭文字をアバターに使う
  const initial = (displayName ?? email).charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="relative h-9 w-9 rounded-full" data-tour="user-menu">
            <Avatar className="h-9 w-9">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName ?? email} />}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />

      <DropdownMenuContent align="end" className="w-56">
        {/* base-ui の GroupLabel は Menu.Group 内に置く必要があるため、必ず Group で囲む */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm leading-none font-medium">{displayName ?? "ユーザー"}</p>
              <p className="text-muted-foreground text-xs leading-none">{email}</p>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={settingsHref} />}>
          <Settings className="mr-2 size-4" aria-hidden />
          設定
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* base-ui の Menu.Item は onSelect を持たない(onClick のみ)。
            以前 onSelect で書いていたためハンドラが発火していなかった。 */}
        <DropdownMenuItem onClick={handleLogout} disabled={isPending}>
          {isPending ? "ログアウト中..." : "ログアウト"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
