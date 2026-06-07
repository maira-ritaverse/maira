"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 職務経歴書フォームの AI 下書き / 候補生成ボタン(Phase 4-d で共通化)
 *
 * 同じ振る舞いを 4 つのボタン(職務要約 / 自己PR / 各職歴 / スキル候補)で共有する:
 * - hasCareerProfile === false: ボタン無効化 + 棚卸しへの導線リンクを下に表示
 * - 他の AI 生成中(disabled=true): ボタン無効化(連打防止)
 * - 生成中(isDrafting=true): 「生成中...」表示、自身も disabled
 * - 当該フィールド固有の理由で無効化(例:会社名未入力): disabledHint で
 *   ボタン下にヒント文を出す
 *
 * 履歴書(resume-form.tsx の AIDraftButton)と同型のデザイン。
 * 将来履歴書側もこちらに寄せられるが、4-d 時点では CV のみで使う。
 */
type Props = {
  // ボタンに表示するラベル(例:「AIで下書き」「AIでスキル候補を提案」)
  label: string;
  // 押下中の生成かどうか(true なら「生成中...」表示 + 無効化)
  isDrafting: boolean;
  // 他の AI 生成中で無効化したい時に true(連打防止のため、isDrafting と OR で使う)
  disabled: boolean;
  // career_profile の有無(false なら無効化 + 棚卸し導線リンク)
  hasCareerProfile: boolean;
  // career_profile 以外の理由で無効化する時のヒント(例:「会社名を入力してください」)
  // 与えると button は無効、下にヒント文が出る
  disabledHint?: string;
  // クリックハンドラ(無効時は呼ばれない)
  onClick: () => void;
  // aria-label のオーバーライド(指定なければ label を使う)
  ariaLabel?: string;
};

export function AIActionButton({
  label,
  isDrafting,
  disabled,
  hasCareerProfile,
  disabledHint,
  onClick,
  ariaLabel,
}: Props) {
  // 棚卸し未完了:導線リンクを下に出して無効化
  // (棚卸しが無いと AI 生成のもとになるデータが無いため、API 側でも 400 を返す)
  if (!hasCareerProfile) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" size="sm" disabled aria-disabled="true">
          <Sparkles className="mr-1 h-4 w-4" />
          {label}
        </Button>
        <p className="text-muted-foreground text-xs">
          <Link href="/app/career" className="underline hover:no-underline">
            キャリア棚卸し
          </Link>
          を完了すると利用できます
        </p>
      </div>
    );
  }

  // 当該フィールド固有の無効化理由(例:会社名未入力でこの職歴行は生成不可)
  if (disabledHint) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" size="sm" disabled aria-disabled="true">
          <Sparkles className="mr-1 h-4 w-4" />
          {label}
        </Button>
        <p className="text-muted-foreground text-xs">{disabledHint}</p>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
    >
      <Sparkles className="mr-1 h-4 w-4" />
      {isDrafting ? "生成中..." : label}
    </Button>
  );
}
