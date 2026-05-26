import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getMessages } from "@/lib/career/conversations";
import { getDocumentConversation, verifyDocumentConversation } from "@/lib/documents/conversations";
import { documentTypeLabels, type DocumentType } from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";
import { DocumentContent } from "./document-content";

/**
 * 書類詳細表示ページ
 *
 * Server Component で書類本文(assistantメッセージ)と metadata を取得し、
 * クライアントコンポーネントの DocumentContent に渡す。
 * 所有者でない / モジュール不一致のIDなら 404。
 */
export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const isValid = await verifyDocumentConversation(id, user.id);
  if (!isValid) notFound();

  const [conversation, messages] = await Promise.all([
    getDocumentConversation(id, user.id),
    getMessages(id),
  ]);

  if (!conversation) notFound();

  const metadata = (conversation.metadata ?? {}) as {
    document_type?: DocumentType;
    job_info_preview?: string;
  };

  const documentType = metadata.document_type;
  const typeLabel = documentType ? documentTypeLabels[documentType] : "書類";

  // assistant メッセージが書類本文(再生成時に複数になり得るので最新を使用)
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const documentContent = assistantMessages[assistantMessages.length - 1]?.content ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{typeLabel}</h1>
          {metadata.job_info_preview && (
            <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
              対象求人:{metadata.job_info_preview}
            </p>
          )}
        </div>
        <Button render={<Link href="/app/documents" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      {documentContent ? (
        <DocumentContent content={documentContent} />
      ) : (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">書類の内容が見つかりません</p>
        </Card>
      )}
    </div>
  );
}
