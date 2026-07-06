import { redirect } from "next/navigation";

import { decryptField } from "@/lib/crypto/field-encryption";
import { getUserRole } from "@/lib/organizations/queries";
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { LineIntroEditor } from "./line-intro-editor";

/**
 * /agency/settings/line-intro
 *
 * エージェント 自身 の 「LINE 自己 紹介」 を 編集 する ページ。
 *   ・顔 写真 (avatar-images バケット の line-intro/ プレフィックス)
 *   ・ヘッド ライン (120 字、 平文)
 *   ・本文 (2,000 字、 暗号化 保存)
 *
 * 認可:
 *   ・organization_member (advisor / admin) 前提。 未 ログイン は /login。
 *   ・自分 の 行 のみ 編集 (API 側 で organization_id + user_id 縛り)。
 */
export const dynamic = "force-dynamic";

export default async function LineIntroSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const supabase = await createClient();
  const { data: memberRow } = await supabase
    .from("organization_members")
    .select(
      "line_intro_headline, encrypted_line_intro_body, line_intro_photo_storage_path, line_intro_updated_at",
    )
    .eq("user_id", user.id)
    .eq("organization_id", role.organization.id)
    .maybeSingle();

  const member = memberRow as {
    line_intro_headline: string | null;
    encrypted_line_intro_body: string | null;
    line_intro_photo_storage_path: string | null;
    line_intro_updated_at: string | null;
  } | null;

  // 復号 失敗 (鍵 ローテ 直後 の env 反映 遅れ 等) で ページ 全体 が 500 に なる の を
  // 防ぐ。 本文 は 空 で 開き、 別途 バナー で 「復号 失敗」 を 明示 して 上書き 保存 の
  // 判断 を admin に 委ねる。
  let body = "";
  let bodyDecryptFailed = false;
  if (member?.encrypted_line_intro_body) {
    try {
      body = (await decryptField(member.encrypted_line_intro_body)) ?? "";
    } catch (e) {
      bodyDecryptFailed = true;
      console.warn(
        `[line-intro/page] body decrypt failed: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }
  const photoUrl = resolveAvatarPublicUrl(supabase, member?.line_intro_photo_storage_path ?? null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">LINE 自己紹介</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          担当している顧客に LINE で 自己紹介を送信できます。 顔写真とヘッドライン、
          エージェントとしての思いを登録してください。
        </p>
      </div>

      {bodyDecryptFailed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">本文の復号に失敗しました</p>
          <p className="mt-1 text-xs">
            暗号化鍵の状態を運営 (maira-info@revorise.jp) にお問い合わせください。 この まま 保存
            する と 本文 は 空 で 上書き されます。 上書き を 避け たい 場合 は 変更 せず に ページ
            を 離れて ください。
          </p>
        </div>
      )}

      <LineIntroEditor
        initialHeadline={member?.line_intro_headline ?? ""}
        initialBody={body}
        initialPhotoUrl={photoUrl}
        updatedAt={member?.line_intro_updated_at ?? null}
      />
    </div>
  );
}
