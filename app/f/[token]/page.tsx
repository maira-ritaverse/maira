import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";

import { PublicIntakeForm } from "./public-intake-form";

/**
 * 公開フォームページ /f/[token]
 *
 * 認証不要。token から intake_form を解決して組織名を表示し、
 * 入力フォームを描画する。
 *
 * service role を server component の中で使うが、ここでは公開情報(organizations.name)
 * しか読まないので OK。送信は別 API ルートで行う。
 */
type RouteParams = { params: Promise<{ token: string }> };

export default async function PublicIntakeFormPage({ params }: RouteParams) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    notFound();
  }
  const service = createServiceClient();
  const { data } = await service
    .from("intake_forms")
    .select("organization_id, is_active, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (!data) notFound();

  // Supabase の embed select は配列で返るので unknown 経由で narrow
  const row = data as unknown as {
    organization_id: string;
    is_active: boolean;
    organizations: { name: string } | { name: string }[] | null;
  };
  const orgNameRaw = Array.isArray(row.organizations)
    ? (row.organizations[0]?.name ?? null)
    : (row.organizations?.name ?? null);
  const orgName = orgNameRaw ?? "エージェント";

  return (
    <div className="bg-background min-h-screen p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{orgName} お問い合わせ</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            ご相談内容を入力してください。担当者より追ってご連絡いたします。
          </p>
        </div>

        {!row.is_active ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            このフォームは現在受付を停止しています。お手数ですが直接お問い合わせください。
          </div>
        ) : (
          <PublicIntakeForm token={token} />
        )}
      </div>
    </div>
  );
}
