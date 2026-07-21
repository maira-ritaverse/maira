import Link from "next/link";
import { Suspense } from "react";

import { Card } from "@/components/ui/card";

import { CreateOrganizationForm } from "./create-organization-form";

/**
 * /admin/organizations/new
 *
 * 新規エージェント企業 + 管理者 1 名を発行するフォーム。
 * 入力:会社名 + 管理者メールアドレス
 * 流れ:Supabase の招待メールが送られる → ユーザがパスワードを自分で設定 → 初回ログイン完了
 */
export default function NewOrganizationPage() {
  return (
    // 新規発行フォームは入力欄が少ないので中央寄せにしておく(画面いっぱいに広げない)
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/admin/organizations" className="text-muted-foreground text-sm hover:underline">
          ← 企業一覧に戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">エージェント企業を新規発行</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          会社名と管理者のメールアドレスを入力すると、Myaira から招待メールが送られます。
          受信者はメール内のリンクから自分でパスワードを設定し、初回ログインを完了します。
        </p>
      </div>

      <Card className="space-y-3 p-5">
        {/* CreateOrganizationForm は useSearchParams() を使うため Suspense 必須(Next.js 15+)。
            フォーム本体は数行で立ち上がるので、簡素なフォールバックで十分。 */}
        <Suspense fallback={<p className="text-muted-foreground text-sm">読み込み中…</p>}>
          <CreateOrganizationForm />
        </Suspense>
      </Card>

      <Card className="space-y-2 border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
          招待リンクがタイムアウトした場合
        </h2>
        <p className="text-xs text-blue-900 dark:text-blue-200">
          メール内のリンクは時間が経つと無効になります。受信者が間に合わなかった場合は、
          ログイン画面の「パスワードを忘れた」から同じメアドで再送できます。
          パスワードリセットを完了するとアカウントが有効化されます。
        </p>
      </Card>
    </div>
  );
}
