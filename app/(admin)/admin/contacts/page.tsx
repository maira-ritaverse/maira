import { Card } from "@/components/ui/card";

import { ContactsInbox } from "./contacts-inbox";

/**
 * /admin/contacts
 *
 * 運営者用:問い合わせ受信箱。
 * 既読 / 未読切替 + 自由メモ。
 */
export default function AdminContactsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">問い合わせ受信箱</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          LP / アプリ内からの問い合わせを履歴として保管。Resend メール通知と並列で残るため
          対応漏れを防げます。会社名 / 氏名 / メアド / 本文で検索可能。
        </p>
      </div>
      <Card className="p-4">
        <ContactsInbox />
      </Card>
    </div>
  );
}
