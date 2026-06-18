import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getAgencyClientCv } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { AgencyCvEditor } from "./agency-cv-editor";

type RouteParams = { params: Promise<{ id: string; cvId: string }> };

export default async function AgencyCvEditPage({ params }: RouteParams) {
  const { id: clientRecordId, cvId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const client = await getClientRecord(clientRecordId);
  if (!client || client.organizationId !== role.organization.id) notFound();

  const cv = await getAgencyClientCv(cvId, role.organization.id);
  if (!cv || cv.clientRecordId !== clientRecordId) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link
              href={`/agency/clients/${clientRecordId}?tab=documents`}
              className="hover:underline"
            >
              ← {client.name} さんの書類
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold">職務経歴書を編集</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/agency/clients/${clientRecordId}/agency-cvs/${cvId}/preview`} />}
          >
            プレビュー
          </Button>
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
            variant="ghost"
            size="sm"
            render={<Link href={`/agency/clients/${clientRecordId}?tab=documents`} />}
          >
            一覧へ戻る
          </Button>
        </div>
      </div>

      <AgencyCvEditor
        clientRecordId={clientRecordId}
        cv={cv}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
