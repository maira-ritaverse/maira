import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import {
  getActiveConsent,
  getScenarioLastSentAt,
  getScenarioSendStats,
  listScenarioViews,
} from "@/lib/ma/queries";
import { getLineMaKpi, type KpiPeriod } from "@/lib/ma/line-kpi";
import { CURRENT_EMAIL_MA_CONSENT_VERSION, CURRENT_LINE_MA_CONSENT_VERSION } from "@/lib/ma/types";
import { MarketingScreen } from "./scenario-list";

/**
 * マーケティングオートメーション(MA)画面
 *
 * EMPRO の「マーケティング → Eメール(MA)」を参考にした、シナリオベースの
 * 自動メール配信管理画面。Phase C-1 ではメール / 求職者向け 7 シナリオを表示。
 *
 * 流れ:
 *   1. layout.tsx で organization_member ガード済み
 *   2. getActiveConsent("email_ma") で同意状態を取得
 *   3. listScenarioViews でプリセット + 自組織の有効化状態を取得
 *   4. クライアントコンポーネント MarketingScreen に渡す
 *      - 未同意なら冒頭にモーダル表示(MarketingScreen 側で制御)
 *      - 同意済みなら各シナリオの ON/OFF UI 表示
 *
 * advisor も閲覧は可能だが、ON/OFF や同意操作は admin のみ
 * (UI 側でも disable し、API 側でも 403 で弾く二重防御)。
 */
// 認証 ユーザー の 組織 単位 で 変動 する 動的 ページ。 CDN / Vercel の RSC
// キャッシュ で 古い 表示 が 残る の を 防ぐ ため force-dynamic を 明示。
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketingPage({ searchParams }: { searchParams?: SearchParams }) {
  const sp = searchParams ? await searchParams : {};
  const periodRaw = sp.period;
  const period: KpiPeriod = periodRaw === "prev" ? "prev" : "current";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // 並列に取得して TTFB を短くする(全て自組織分のみ、依存関係なし)
  const [scenarios, emailConsent, lineConsent, sendStats, lastSentAtByScenarioId, lineKpi] =
    await Promise.all([
      listScenarioViews(role.organization.id),
      getActiveConsent(role.organization.id, "email_ma"),
      getActiveConsent(role.organization.id, "line_ma"),
      getScenarioSendStats(role.organization.id, 30),
      getScenarioLastSentAt(role.organization.id),
      getLineMaKpi(role.organization.id, period),
    ]);

  // クライアント側で scenario_id → stats の O(1) lookup ができるよう Record にする。
  // 値が無い scenario_id は「表示しない」ではなく「0/0/0 として表示」を期待する。
  const sendStatsByScenarioId = Object.fromEntries(
    sendStats.map((s) => [s.scenarioId, { sent: s.sent, failed: s.failed, skipped: s.skipped }]),
  );

  // Resend 設定診断:Vercel 環境変数の有無だけ見る。
  // 値そのものは絶対にクライアントに渡さない(キー漏洩防止)。
  // 「設定されているか」だけを真偽値で渡す。
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Resend 未設定の場合は警告バナーを出す。
          admin だけでなく advisor にも見せる(運用状況の透明性のため)。 */}
      {!resendConfigured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="inline-flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            Resend が未設定です
          </p>
          <p className="mt-1">
            <code className="font-mono text-xs">RESEND_API_KEY</code> または{" "}
            <code className="font-mono text-xs">EMAIL_FROM</code> が Vercel
            の環境変数に設定されていません。
            <br />
            シナリオを有効化しても自動配信は <code>skipped</code>{" "}
            としてログに記録されるだけで、実際のメールは送信されません。
            <br />
            設定方法は <code className="font-mono text-xs">docs/ma-ops-guide.md</code> を参照。
          </p>
        </div>
      )}

      <MarketingScreen
        scenarios={scenarios}
        emailConsent={emailConsent}
        lineConsent={lineConsent}
        emailConsentVersion={CURRENT_EMAIL_MA_CONSENT_VERSION}
        lineConsentVersion={CURRENT_LINE_MA_CONSENT_VERSION}
        isAdmin={role.member.role === "admin"}
        sendStatsByScenarioId={sendStatsByScenarioId}
        lastSentAtByScenarioId={lastSentAtByScenarioId}
        lineKpi={lineKpi}
        period={period}
      />
    </div>
  );
}
