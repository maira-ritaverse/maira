"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * パスワード 入力欄(表示 / 非表示 トグル 付き)
 *
 * 役割:
 *   ・既存の Input と 同じ props を 受け、内部で type を password/text 切替
 *   ・右端に 目アイコン(👁) ボタン を absolute 配置、トグル
 *   ・react-hook-form の register と そのまま 互換(ref を forward)
 *
 * 使い方:
 *   <PasswordInput {...register("password")} disabled={isPending} />
 *
 * 設計判断:
 *   ・「押している間だけ 表示」では なく トグル式 (一般的な UX に 揃える)
 *   ・送信中(disabled)は トグルも 無効化(意図しない 操作 防止)
 *   ・aria-pressed / aria-label で アクセシビリティ 対応
 *   ・autoComplete は ratio に 寄せて 呼び出し側で 指定
 *
 * 共通化 した 理由:
 *   ログイン / 新規登録 / パスワード再設定 / 設定 で 計 7 箇所 同パターン。
 *   各所 に コピペ する と トグル 仕様 が ズレた 時 直しきれない。
 */
type Props = Omit<React.ComponentProps<"input">, "type"> & {
  /** 初期表示状態(既定: 非表示) */
  defaultShow?: boolean;
};

export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, disabled, defaultShow = false, ...props },
  ref,
) {
  const [show, setShow] = React.useState(defaultShow);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={show ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        disabled={disabled}
        aria-label={show ? "パスワードを隠す" : "パスワードを表示"}
        aria-pressed={show}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center px-3 disabled:opacity-50"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
