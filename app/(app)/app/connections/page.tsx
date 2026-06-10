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
  if (!user) redirect("/login");

  const { invited, linked, revokeRequested, revoked } = await listConnections();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">エージェントとの連携</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          エージェントから届いた招待の承認・拒否、連携中の状態確認、連携の解除申請ができます。
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
      <RevokeRequestedSection items={revokeRequested} />
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
                  <RevokeConnectionButton clientRecordId={c.id} graceDays={c.graceDays} />
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
// 解除申請中(revoke_requested)
//
// P3 で追加。本人が解除を申請したが、承認 or 猶予期限経過までは「申請中」として
// 別セクションで見せる。
// - アクションボタンなし(取り下げは方針未確定のためスコープ外)
// - revoke_deadline までの残り日数を表示。期限超過後も link_status は
//   revoke_requested のまま見えるので、残り日数は「期限切れ」になる
//   (RLS / RPC 側で開示は既に止まっているため UX 上の問題はない)
// - 残り日数の計算はクライアント時刻ベース(Server Component で計算しても
//   ページレンダリング時点で固まり「今」とずれるため、ブラウザ時刻で都度算出)。
//   ※ Hydration mismatch を避けるため、初期描画では deadline の絶対日時のみ
//      表示し、残り日数の動的計算はクライアント側で見られる範囲に止めるか、
//      Server Component で「申請日 → 期限日」を絶対値で出す方が安全。
//   実装は後者を採用:絶対日時で表示、残り日数は近似(Server Component 時点)で。
// ====================================================================
function RevokeRequestedSection({ items }: { items: Connection[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">解除を申請中</h2>
        <span className="text-muted-foreground text-xs">{items.length}件</span>
      </div>
      <div className="space-y-3">
        {items.map((c) => {
          const daysLeft = computeDaysLeft(c.revokeDeadline);
          return (
            <Card
              key={c.id}
              className="border-orange-200 bg-orange-50/40 p-4 dark:border-orange-900 dark:bg-orange-950/20"
            >
              <div className="space-y-2">
                <p className="text-sm font-medium">{agencyLabel(c.organizationName)}</p>
                <p className="text-muted-foreground text-xs">
                  申請日時:{formatDateTime(c.revokeRequestedAt)}
                </p>
                <p className="text-muted-foreground text-xs">
                  停止予定:{formatDateTime(c.revokeDeadline)}
                  {daysLeft !== null && (
                    <span className="ml-2">
                      ({daysLeft > 0 ? `あと約 ${daysLeft} 日` : "期限切れ"})
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground border-t pt-2 text-xs">
                  エージェントの承認、または猶予期限の経過で開示が停止します。
                  停止までの間は、引き続き履歴書・職務経歴書・希望条件が開示されます。
                </p>
              </div>
            </Card>
          );
        })}
      </div>
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

/**
 * 残り日数の概算(Server Component 描画時点での今と比較)。
 * 表示はあくまで目安。実際の遮断は revoke_deadline と now() の比較で行われ、
 * このページの数値とのズレ(リクエスト時刻 vs 開示判定時刻)は許容する。
 */
function computeDaysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline).getTime();
  if (Number.isNaN(d)) return null;
  const diffMs = d - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
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
