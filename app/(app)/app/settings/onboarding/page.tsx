import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOnboardingCompleted } from "@/lib/onboarding/queries";
import { Card } from "@/components/ui/card";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { OnboardingReplayButton } from "./replay-button";

/**
 * オンボーディングツアー再表示ページ
 *
 * 設定 → オンボーディングツアー からアクセスする。
 * ユーザーが任意のタイミングで使い方ツアーを再起動できるようにする。
 *
 * 再表示時は onboarded_at を変更しない(autoStart=false / forceStart=true)。
 * 「完了済み」フラグはあくまで初回完了の記録なので、再起動で書き換わると
 * 「いつ初めて使い方を理解したか」が分からなくなる。
 */
export default async function OnboardingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const onboardingDone = await isOnboardingCompleted(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SettingsBackLink href="/app/settings" label="設定" />
      <div>
        <h1 className="text-2xl font-bold">オンボーディングツアー</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Myairaの使い方ツアーをいつでも再表示できます
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <p className="font-medium">使い方ツアー</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Myairaの主な機能と、最初に何をすべきかを案内する10ステップのツアーです。
              いつでも再表示できます。
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              状態:{onboardingDone ? "完了済み" : "未完了"}
            </p>
          </div>

          <OnboardingReplayButton />
        </div>
      </Card>
    </div>
  );
}
