"use client";

/**
 * レポート の 対象 メンバー 切替 セレクター (admin 専用)。
 *
 * 状態 は URL の searchParams (?member=<uuid>) に 持たせる。 SSR 側 (page.tsx)
 * が これ を 読んで 全 query に memberId を 渡し、 レポート 内容 を そのメンバー
 * 担当分 だけ に 絞り込む。
 *
 * 「組織 全体」 = ?member パラメータ なし。 個別 メンバー 選択 時 は uuid を
 * URL に 載せる。 期間 フィルタ (period / from / to) と 干渉 させ ない よう、
 * URLSearchParams で 既存 パラメータ を 保ったまま member のみ 更新 する。
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type ReportMemberOption = {
  memberId: string;
  displayName: string;
};

type Props = {
  members: ReportMemberOption[];
  /** 現在 選択 中 の memberId (null = 組織全体) */
  currentMemberId: string | null;
};

export function MemberSelector({ members, currentMemberId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateUrl = useCallback(
    (nextMemberId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextMemberId) {
        params.set("member", nextMemberId);
      } else {
        params.delete("member");
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground text-xs">対象</span>
      <select
        value={currentMemberId ?? ""}
        onChange={(e) => updateUrl(e.target.value || null)}
        className="border-input bg-background rounded-md border px-2 py-1 text-sm"
        aria-label="レポート対象メンバー"
      >
        <option value="">組織全体</option>
        {members.map((m) => (
          <option key={m.memberId} value={m.memberId}>
            {m.displayName || "(名前未設定)"}
          </option>
        ))}
      </select>
    </label>
  );
}
