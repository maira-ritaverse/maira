/**
 * /mf/[token]
 *
 * 公開 MA フォーム(marketing form)の表示ページ。認証不要。
 *
 * 既存の /f/[token](intake_forms)と衝突しないよう /mf 配下にする。
 * ・is_published=false / トークン不一致 → 404
 * ・is_published=true → タイトル + 説明 + 質問 + 送信フォームを表示
 * ・送信は Client 側から /api/public/forms/[token]/submit へ POST
 */
import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";

import { PublicFormScreen } from "./public-form-screen";

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ token: string }>;

export default async function PublicFormPage({ params }: { params: RouteParams }) {
  const { token } = await params;

  const admin = createServiceClient();
  const { data } = await admin
    .from("forms")
    .select("id, title, description, schema_json, is_published")
    .eq("public_token", token)
    .maybeSingle();

  if (!data || !(data as { is_published: boolean }).is_published) {
    notFound();
  }

  const row = data as {
    id: string;
    title: string;
    description: string | null;
    schema_json: unknown;
  };

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-white p-4 sm:p-6">
      <PublicFormScreen
        token={token}
        title={row.title}
        description={row.description}
        schema={Array.isArray(row.schema_json) ? row.schema_json : []}
      />
    </div>
  );
}
