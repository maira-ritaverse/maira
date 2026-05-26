import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCareerProfile } from "@/lib/career/conversations";
import {
  documentTypeLabels,
  documentTypes,
  requiresJobInfo,
  type DocumentType,
} from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";
import { DocumentGenerateForm } from "./generate-form";

/**
 * 書類生成フォーム画面
 *
 * URL の [type] が未知の値なら 404。
 * career_profile がない状態で来た場合は一覧へ戻す。
 */
export default async function NewDocumentTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;

  if (!documentTypes.includes(type as DocumentType)) {
    notFound();
  }

  const documentType = type as DocumentType;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    redirect("/app/documents");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{documentTypeLabels[documentType]}を作成</h1>
        </div>
        <Button render={<Link href="/app/documents/new" />} variant="outline" size="sm">
          書類タイプ選択へ
        </Button>
      </div>

      <DocumentGenerateForm
        documentType={documentType}
        requiresJobInfo={requiresJobInfo(documentType)}
      />
    </div>
  );
}
