"use client";

import { useRouter, usePathname } from "next/navigation";
import { OnboardingTour } from "./onboarding-tour";

type Props = {
  autoStart: boolean;
  replay: boolean;
};

/**
 * ダッシュボード(/app)に常設するオンボーディングツアーの mount 用 client wrapper。
 *
 * 役割:
 * - 初回ログイン時は autoStart=true でツアーが自動起動。
 * - 「ツアーを再表示」ボタン(/app/settings/onboarding)からは /app?replay=tour に
 *   遷移してくる。Server Component の page.tsx で searchParams を読み、replay=true を
 *   この wrapper に渡すことで forceStart 起動する。
 * - 再表示完了/スキップ時には URL の ?replay=tour を取り除き(router.replace)、
 *   再読込で再度起動してしまわないようにする。
 *
 * 「再表示は必ずダッシュボード上で起こす」ことで、ツアーが「ダッシュボードを起点に
 * 各機能を紹介する」流れと一致するようにしている(設定ページから直接起動すると、
 * ステップ2以降の文脈が崩れるため)。
 */
export function OnboardingTourMount({ autoStart, replay }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <OnboardingTour
      autoStart={autoStart}
      forceStart={replay}
      onClose={
        replay
          ? () => {
              // ?replay=tour をクリーンアップ。pathname だけに置換することで
              // ブラウザ履歴を汚さずクエリだけ落とす。
              router.replace(pathname);
            }
          : undefined
      }
    />
  );
}
