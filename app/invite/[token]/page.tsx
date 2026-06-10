import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/auth/actions";
import type { OrganizationRole } from "@/lib/organizations/types";
import { AcceptInvitationButton } from "./accept-button";

const roleLabel: Record<OrganizationRole, string> = {
  admin: "管理者",
  advisor: "アドバイザー",
};

type InvitationRecord = {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  organizations: { name: string } | { name: string }[] | null;
};

/**
 * 招待着地ページ /invite/[token]
 *
 * 未ログインでもアクセスできる「公開ページ」。middleware.ts で /invite を
 * 認証ガードの対象外にしている。
 *
 * 表示分岐(7 通り):
 *   1. 招待が存在しない/取消/受諾済み/期限切れ → エラー画面
 *   2. 未ログイン                              → ログイン/登録案内(S5b/S5c で導線)
 *   3. ログイン済み + email 不一致              → ログアウトを促す
 *   4. ログイン済み + 既に org メンバー         → 「既に所属」案内
 *   5. ログイン済み + 求職者データ保有          → 「別 email で招待を」案内
 *   6. ログイン済み + email 一致 + まっさら     → 受諾ボタン
 *
 * RPC 側でも同じ検証を行うため、ここでの分岐は「UX 上の先回り表示」。
 * RPC を信頼の最終境界とし、UI だけで守らない。
 *
 * 招待行の取得は service_role を使う:invitations の RLS は同 org メンバー
 * しか SELECT を許可していないため、未ログイン or 別ユーザーからは読めない。
 * (S1 で「招待リンク経由は別途 service_role / token 検証」と明記済み)
 */
export default async function InviteLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. 招待を service_role で取得(RLS バイパス)
  const service = createServiceClient();
  const { data: invRaw } = await service
    .from("organization_invitations")
    .select(
      `
      id,
      organization_id,
      email,
      role,
      status,
      expires_at,
      organizations ( name )
    `,
    )
    .eq("token", token)
    .maybeSingle<InvitationRecord>();

  if (!invRaw) {
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <AlertTitle>招待リンクが無効です</AlertTitle>
          <AlertDescription>
            このリンクは存在しないか、取り消されています。招待者にご確認ください。
          </AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  // 失効判定:DB の status が pending でも expires_at を過ぎていれば期限切れ扱い
  // (Server Component なのでリクエストごとの now で OK)
  const now = new Date();
  const isExpired = new Date(invRaw.expires_at).getTime() <= now.getTime();
  if (invRaw.status !== "pending" || isExpired) {
    const msg =
      invRaw.status === "accepted"
        ? "この招待は既に受諾されています。"
        : invRaw.status === "revoked"
          ? "この招待は取り消されました。"
          : "この招待は期限が切れています。";
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <AlertTitle>招待リンクが無効です</AlertTitle>
          <AlertDescription>{msg}招待者にご確認ください。</AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  const orgRaw = invRaw.organizations;
  const organizationName =
    (Array.isArray(orgRaw) ? orgRaw[0]?.name : orgRaw?.name) ?? "(不明な組織)";

  // 2. 認証状況を確認(ログインしているか)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未ログイン → 登録/ログイン案内(S5b で signup 統合済み、S5c でログイン統合予定)
  if (!user) {
    // ログイン側は S5c で next 対応を入れる予定。S5b 時点では参考リンクとして
    // 同じ next クエリだけ付けておく(callback 経由でない通常ログインなので、
    // /login 側で next を読んで遷移するのは S5c の責務)。
    const nextParam = encodeURIComponent(`/invite/${token}`);
    return (
      <CenteredCard>
        <div className="space-y-4">
          <header className="space-y-1">
            <h1 className="text-xl font-bold">招待が届いています</h1>
            <p className="text-muted-foreground text-sm">
              <span className="font-medium">{organizationName}</span> から{" "}
              <span className="font-medium">{roleLabel[invRaw.role]}</span> として招待されています。
            </p>
          </header>
          <Alert>
            <AlertTitle>{invRaw.email} 宛の招待です</AlertTitle>
            <AlertDescription>
              参加するには、この招待メールアドレスでログインまたは登録してください。
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button render={<Link href={`/login?next=${nextParam}`} />} className="flex-1">
              ログイン
            </Button>
            <Button
              render={<Link href={`/signup?invitationToken=${token}`} />}
              variant="outline"
              className="flex-1"
            >
              新規登録
            </Button>
          </div>
        </div>
      </CenteredCard>
    );
  }

  // 3. ログイン済み + email 不一致
  const userEmail = (user.email ?? "").toLowerCase();
  const invEmail = invRaw.email.toLowerCase();
  if (userEmail !== invEmail) {
    return (
      <CenteredCard>
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>異なるアカウントでログイン中です</AlertTitle>
            <AlertDescription>
              この招待は <span className="font-medium">{invRaw.email}</span> 宛です。
              現在ログイン中の <span className="font-medium">{user.email}</span>{" "}
              とは異なります。ログアウトして、招待メールのアカウントで再ログインしてください。
            </AlertDescription>
          </Alert>
          <form
            action={async () => {
              "use server";
              await logout();
            }}
          >
            <Button type="submit" variant="outline" className="w-full">
              ログアウトする
            </Button>
          </form>
        </div>
      </CenteredCard>
    );
  }

  // 4. ログイン済み + 既に組織メンバー
  const { data: existingMember } = await supabase
    .from("organization_members")
    .select("id, organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    // 既に同じ組織のメンバーなら直接組織ホームへ
    if (existingMember.organization_id === invRaw.organization_id) {
      redirect("/agency/clients");
    }
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <AlertTitle>既に別の組織に所属しています</AlertTitle>
          <AlertDescription>
            1 つのアカウントで複数の組織に所属することはできません。
            別の組織への参加には、別のメールアドレスで招待を受けてください。
          </AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  // 5. ログイン済み + 求職者データ保有チェック
  // 求職者として 1 件でもデータがあれば拒否。RPC でも同じ判定をするが、
  // UX 上はここで先に表示しておく。
  const hasSeekerData = await detectSeekerData(supabase, user.id);
  if (hasSeekerData) {
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <AlertTitle>このアカウントは求職者として利用中です</AlertTitle>
          <AlertDescription>
            <span className="font-medium">{user.email}</span> は、既に求職者用のデータ
            (履歴書・キャリア棚卸し・応募情報など)を保有しています。
            エージェントとして参加するには、別のメールアドレスで招待を受けてください。
          </AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  // 6. すべての検証 OK → 受諾ボタン
  return (
    <CenteredCard>
      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-bold">組織への参加</h1>
          <p className="text-muted-foreground text-sm">
            <span className="font-medium">{organizationName}</span> に{" "}
            <span className="font-medium">{roleLabel[invRaw.role]}</span> として参加しますか?
          </p>
        </header>
        <div className="text-muted-foreground space-y-1 rounded-lg border px-3 py-2 text-xs">
          <div>
            参加メール: <span className="font-medium">{user.email}</span>
          </div>
          <div>
            有効期限:{" "}
            {new Date(invRaw.expires_at).toLocaleString("ja-JP", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
        <AcceptInvitationButton token={token} />
      </div>
    </CenteredCard>
  );
}

/**
 * 求職者データの存在を 1 回でも見つけたら true で返す。
 * RPC 側でも同じ判定をするが、ここでは UX 上の先回り表示用。
 * 4 テーブルを順に SELECT id LIMIT 1 で軽く突く。
 *
 * 注意:この関数はログイン済み user のセッション付き supabase で呼ぶ前提。
 *      各テーブルの RLS は自分のデータのみ閲覧可なので、ここでも自分の行のみ見える。
 */
async function detectSeekerData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const tables = ["resumes", "career_profiles", "applications", "conversations"] as const;
  for (const table of tables) {
    const { data } = await supabase.from(table).select("id").eq("user_id", userId).limit(1);
    if (data && data.length > 0) return true;
  }
  return false;
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <div className="ring-foreground/10 bg-card w-full max-w-md rounded-2xl p-6 shadow-sm ring-1">
        {children}
      </div>
    </div>
  );
}
