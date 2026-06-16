"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * 本人データのエクスポートセクション(個人情報保護法 第33条 対応)。
 *
 * 仕組み:
 *   - `<a href="/api/account/export" download>` で直接ダウンロード起動
 *   - サーバ側で audit_logs に「data_exported」を記録
 *   - 大きい JSON になり得るので、生成に数十秒かかる可能性を UI で伝える
 *
 * クライアント JS による fetch + blob 経由でも実現できるが、
 * 直リンク方式の方が「巨大 JSON もブラウザの DL マネージャに乗る」「ローディング表示が標準」で堅い。
 */
export function AccountExportSection() {
  return (
    <Card className="space-y-2 p-5">
      <div>
        <h2 className="text-base font-semibold">自分のデータをエクスポート</h2>
        <p className="text-muted-foreground text-xs">
          履歴書 / 職務経歴書 / キャリア棚卸し / 応募・タスクを 1 つの JSON
          ファイルにまとめてダウンロードできます。生成に数十秒かかる場合があります。
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        render={
          <a href="/api/account/export" download>
            JSON でダウンロード
          </a>
        }
      >
        JSON でダウンロード
      </Button>
    </Card>
  );
}
