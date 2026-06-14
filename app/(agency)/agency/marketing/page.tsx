import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getActiveConsent, listScenarioViews } from "@/lib/ma/queries";
import { CURRENT_EMAIL_MA_CONSENT_VERSION } from "@/lib/ma/types";
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
export default async function MarketingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // 並列に取得して TTFB を短くする(両方とも自組織分のみ、依存関係なし)
  const [scenarios, consent] = await Promise.all([
    listScenarioViews(role.organization.id),
    getActiveConsent(role.organization.id, "email_ma"),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <MarketingScreen
        scenarios={scenarios}
        consent={consent}
        consentVersion={CURRENT_EMAIL_MA_CONSENT_VERSION}
        isAdmin={role.member.role === "admin"}
      />
    </div>
  );
}
