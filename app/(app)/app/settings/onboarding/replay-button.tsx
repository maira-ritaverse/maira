"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * オンボーディングツアーを再起動するボタン
 *
 * ツアーは「ダッシュボードを起点に主要機能を紹介する」流れになっているため、
 * 設定ページ上ではなく、必ずダッシュボードに遷移してから起動する。
 * 再表示時は /app?replay=tour に遷移し、ダッシュボード側でクエリを検知して
 * ツアーを起動する設計にしている(OnboardingTourMount 参照)。
 *
 * onboarded_at は autoStart=false 側で扱われるため、再表示で記録は変更されない。
 */
export function OnboardingReplayButton() {
  return <Button render={<Link href="/app?replay=tour" />}>🎓 ツアーを再表示する</Button>;
}
