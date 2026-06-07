import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  AcceptConnectionButton,
  RejectConnectionButton,
  RevokeConnectionButton,
} from "@/components/features/connections/connection-actions";
import { DisclosureSummary } from "@/components/features/connections/disclosure-summary";
import { listConnections } from "@/lib/connections/queries";
import { createClient } from "@/lib/supabase/server";
import type { Connection } from "@/lib/connections/types";

/**
 * 連携管理ページ(求職者本人)
 *
 * 自分宛ての招待・連携中・解除済みを 1 画面で一元管理する。
 * RLS 経由で本人の行のみ取得され、エージェント側の内部メモ(notes)などは
 * Server Component の段階で除外している(lib/connections/queries.ts 参照)。
 *
 * 組織名の表示について:
 *   Phase 4 で organizations に「求職者が当事者の client_records 行に対応する
 *   organization のみ select 可」ポリシーを追加したため、本ページでも組織名を
 *   表示できる。listConnections は PostgREST の埋め込みで organizations(name) を
 *   join し、organizationName が取れたものを優先表示する。RLS で見えない場合や
 *   組織名未設定の場合は汎用ラベルにフォールバックする。
 */
export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { invited, linked, revoked } = await listConnections();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">エージェントとの連携</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          エージェントから届いた招待の承認・拒否、連携中の状態確認、連携の解除ができます。
        </p>
      </div>

      {/* 開示範囲の事前告知:招待が無くても「承認すると何が共有されるか」を
          常に画面上に置く。「ボタンを押した瞬間に初めて知る」を避けるため。 */}
      <Card className="bg-muted/30 p-5">
        <p className="mb-3 text-sm font-semibold">連携を承認すると共有される情報</p>
        <DisclosureSummary />
      </Card>

      <InvitedSection items={invited} />
      <LinkedSection items={linked} />
      <RevokedSection items={revoked} />
    </div>
  );
}

// ====================================================================
// 招待中(invited)
// ====================================================================
function InvitedSection({ items }: { items: Connection[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">届いている招待</h2>
        <span className="text-muted-foreground text-xs">{items.length}件</span>
      </div>
      {items.length === 0 ? (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">届いている招待はありません。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {agencyLabel(c.organizationName)}から連携の招待が届いています
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    招待日時:{formatDateTime(c.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <AcceptConnectionButton clientRecordId={c.id} />
                  <RejectConnectionButton clientRecordId={c.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ====================================================================
// 連携中(linked)
// 開示中の情報を明示し、解除導線を出す。
// ====================================================================
function LinkedSection({ items }: { items: Connection[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">連携中のエージェント</h2>
        <span className="text-muted-foreground text-xs">{items.length}件</span>
      </div>
      {items.length === 0 ? (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">現在連携中のエージェントはありません。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card
              key={c.id}
              className="border-green-200 bg-green-50/40 p-4 dark:border-green-900 dark:bg-green-950/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-medium">{agencyLabel(c.organizationName)}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      連携日時:{formatDateTime(c.linkedAt)}
                    </p>
                  </div>
                  <div className="border-t pt-3">
                    <p className="mb-2 text-xs font-medium">このエージェントに開示中の情報</p>
                    <DisclosureSummary />
                  </div>
                </div>
                <div className="shrink-0">
                  <RevokeConnectionButton clientRecordId={c.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ====================================================================
// 解除済み(revoked)
// 過去の連携を履歴として薄く表示。アクションなし。件数が多くなったら
// 件数のみ表示にしてもよいが、現状は折りたたまずに見せる。
// ====================================================================
function RevokedSection({ items }: { items: Connection[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-muted-foreground text-base font-medium">解除済みの連携</h2>
        <span className="text-muted-foreground text-xs">{items.length}件</span>
      </div>
      <div className="space-y-2">
        {items.map((c) => (
          <Card key={c.id} className="bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">
              {agencyLabel(c.organizationName)} — 解除日時:{formatDateTime(c.revokedAt)}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ====================================================================
// 表示ヘルパー
// ====================================================================
/**
 * 組織名がある場合はそれを、ない場合(RLS で見えない or 名前未設定)は汎用ラベルに
 * フォールバックする表示ヘルパー。
 * - 招待元/連携先の判別に使う:Phase 4 で RLS が通れば「○○エージェント」表示。
 */
function agencyLabel(name: string | null): string {
  if (name && name.trim().length > 0) return name;
  return "連携中のエージェント";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
