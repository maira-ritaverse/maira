import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { checkAiUsageLimit } from "@/lib/features/ai-usage";
import { checkIntakeLimit } from "@/lib/features/usage-limits";
import { createClient } from "@/lib/supabase/server";

/**
 * 求職者向け「AI 利用状況」ページ(/app/settings/integrations)
 *
 * 旧:Zoom / Google Meet 連携 + アドオン課金 + カレンダー購読 URL も同居していたが、
 *    これらはエージェント業務向けなので /agency/settings/integrations に移設。
 *    求職者は「面談に参加するだけ」で連携は不要なため、本ページは AI 利用状況のみ。
 */
export default async function UsageStatusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [intakeLimit, photoLimit, recLimit] = await Promise.all([
    checkIntakeLimit(supabase, user.id),
    checkAiUsageLimit(supabase, user.id, "photo_enhance"),
    checkAiUsageLimit(supabase, user.id, "job_recommendation_seeker"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app/settings" className="hover:underline">
            ← 設定
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">AI 利用状況</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          今月の AI 機能の利用回数と上限を確認できます。
        </p>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">今月の利用状況</h2>
        <UsageRow
          label="AI ヒアリング(録音アップロード)"
          current={intakeLimit.current}
          limit={intakeLimit.limit}
          addon={intakeLimit.addon}
        />
        <UsageRow
          label="AI 証明写真(自撮りから生成)"
          current={photoLimit.current}
          limit={photoLimit.limit}
          addon={photoLimit.addon}
        />
        <UsageRow
          label="AI 求人推薦(再計算)"
          current={recLimit.current}
          limit={recLimit.limit}
          addon={recLimit.addon}
        />
        <p className="text-muted-foreground text-[11px]">
          次回リセット:{new Date(intakeLimit.resetsAt).toLocaleString("ja-JP")}
        </p>
      </Card>
    </div>
  );
}

/** 利用状況 1 行(label と current / limit と addon バッジ)。 */
function UsageRow({
  label,
  current,
  limit,
  addon,
}: {
  label: string;
  current: number;
  limit: number;
  addon: boolean;
}) {
  const ratio = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  const tone = ratio >= 100 ? "bg-red-500" : ratio >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs">{label}</span>
        <span className="text-xs font-medium">
          {current}
          <span className="text-muted-foreground"> / {limit} 回</span>
          {addon && (
            <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              アドオン
            </span>
          )}
        </span>
      </div>
      <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
        <div className={`h-full transition-all ${tone}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
