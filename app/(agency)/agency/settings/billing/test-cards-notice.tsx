import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Stripe テスト モード の 案内 バナー。
 *
 * 表示 条件:
 *   ・STRIPE_SECRET_KEY が sk_test_ で 始まる 場合 に のみ 表示
 *   ・本番 モード (sk_live_) では 表示 しない
 *
 * テスト カード 番号:
 *   ・4242 4242 4242 4242 (成功)
 *   ・4000 0000 0000 9995 (残高 不足)
 *   ・4000 0000 0000 0341 (認証 必要 = 3D Secure)
 */
export function TestCardsNotice() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !secret.startsWith("sk_test_")) return null;

  return (
    <Alert className="border-amber-300 bg-amber-50">
      <Info className="h-4 w-4 text-amber-700" aria-hidden />
      <AlertDescription className="text-xs text-amber-900">
        <div className="font-semibold">Stripe テスト モード で 稼働 中</div>
        <div className="mt-1">
          決済 は 実際 に 発生 しません。 テスト カード:
          <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">4242 4242 4242 4242</code>
          (成功) /
          <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">4000 0000 0000 9995</code>
          (残高 不足) /
          <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">4000 0000 0000 0341</code>
          (3D Secure)。 有効 期限 は 未来 の 任意 日、 CVC / 郵便 番号 は 任意 3 〜 5 桁 で 通過
          します。
        </div>
      </AlertDescription>
    </Alert>
  );
}
