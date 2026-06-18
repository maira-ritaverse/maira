import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAgencyClientCv } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ id: string; cvId: string }> };

/**
 * 職務経歴書 プレビュー(ブラウザ用 read-only)。
 *
 * 自由記述の whitespace-pre-wrap で改行を尊重しつつ、要約と本文を縦に並べる
 * シンプルなレイアウト。実際の印刷物に近い見た目を確認したい場合は
 * 同ページの「PDF をダウンロード」を使う(buildAgencyCvHtml + Puppeteer)。
 */
export default async function AgencyCvPreviewPage({ params }: RouteParams) {
  const { id: clientRecordId, cvId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const client = await getClientRecord(clientRecordId);
  if (!client || client.organizationId !== role.organization.id) notFound();

  const cv = await getAgencyClientCv(cvId, role.organization.id);
  if (!cv || cv.clientRecordId !== clientRecordId) notFound();

  const today = cv.documentDate
    ? new Date(cv.documentDate).toLocaleDateString("ja-JP")
    : new Date().toLocaleDateString("ja-JP");

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link
              href={`/agency/clients/${clientRecordId}/agency-cvs/${cvId}`}
              className="hover:underline"
            >
              ← 編集に戻る
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold">{cv.title}(プレビュー)</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {client.name} さん向け / A4 縦 / 自由記述
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={`/api/agency/client-cvs/${cvId}/pdf`} download>
                PDF をダウンロード
              </a>
            }
          />
          <Button
            size="sm"
            render={
              <Link href={`/agency/clients/${clientRecordId}/agency-cvs/${cvId}`}>編集へ戻る</Link>
            }
          />
        </div>
      </div>

      <Card className="bg-muted/20 p-3">
        <p className="text-muted-foreground text-xs">
          このプレビューはブラウザ表示用です。印刷物に近い見た目は「PDF
          をダウンロード」で確認できます。
        </p>
      </Card>

      <Card className="space-y-4 p-8">
        <header className="space-y-1 text-center">
          <h2 className="text-2xl font-bold tracking-wide">職務経歴書</h2>
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>{client.name}</span>
            <span>{today} 現在</span>
          </div>
        </header>

        <section className="space-y-2">
          <h3 className="bg-muted border-foreground border-l-2 px-2 py-1 text-base font-semibold">
            要約
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {cv.body.summary || "(未入力)"}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="bg-muted border-foreground border-l-2 px-2 py-1 text-base font-semibold">
            職務経歴・本文
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {cv.body.body || "(未入力)"}
          </p>
        </section>
      </Card>
    </div>
  );
}
