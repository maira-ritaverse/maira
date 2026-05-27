"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OnboardingTour } from "@/components/features/onboarding/onboarding-tour";

/**
 * オンボーディングツアーを再起動するボタン
 *
 * forceStart 経由でツアーを起動する。
 * autoStart=false を渡しているため、再表示完了で onboarded_at は変更されない
 * (= 初回完了の記録を保持する)。
 *
 * ツアー終了時(onClose)に forceStart を false に戻すことで、再度ボタンが押せる状態にする。
 */
export function OnboardingReplayButton() {
  const [forceStart, setForceStart] = useState(false);

  const handleStart = () => {
    setForceStart(true);
  };

  const handleClose = () => {
    setForceStart(false);
  };

  return (
    <>
      <Button onClick={handleStart} disabled={forceStart}>
        {forceStart ? "ツアー実行中..." : "🎓 ツアーを再表示する"}
      </Button>

      {forceStart && <OnboardingTour autoStart={false} forceStart={true} onClose={handleClose} />}
    </>
  );
}
