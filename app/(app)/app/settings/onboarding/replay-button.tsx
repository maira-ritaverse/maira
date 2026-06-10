"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * オンボーディングツアーを再起動するボタン
 *
 * ツアーのステップにはダッシュボード本体(/app の data-tour="dashboard-content")や
 * サイドバー各項目を target にしているステップが含まれるため、設定ページ上で起動すると
 * 一部 target が存在せず、react-joyride が黙ってスキップしてしまう。
 * これを避けるため、再表示時は /app?replay=tour に遷移し、ダッシュボード側で
 * クエリを検知してツアーを起動する設計にしている(OnboardingTourMount 参照)。
 *
 * onboarded_at は autoStart=false 側で扱われるため、再表示で記録は変更されない。
 */
export function OnboardingReplayButton() {
  return <Button render={<Link href="/app?replay=tour" />}>🎓 ツアーを再表示する</Button>;
}
