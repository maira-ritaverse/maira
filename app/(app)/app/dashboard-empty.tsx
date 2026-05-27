import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * 初回ユーザー(career_profile なし)向けのダッシュボード。
 *
 * 何もデータがないので、まずキャリア棚卸しに誘導することに専念する。
 * 4 機能の説明カードはアプリ全体の理解を助けるために併記する。
 */
export function DashboardEmpty() {
  return (
    <div className="space-y-6">
      {/* メインCTA:棚卸し導線を強調表示 */}
      <Card className="border-primary/40 bg-primary/5 p-6">
        <h2 className="text-lg font-bold">まずはキャリア棚卸しから始めましょう</h2>
        <p className="mt-2 text-sm">
          Mairaと雑談感覚で5-10分話すだけで、あなたの強みや希望が綺麗に整理されます。
          整理結果は、書類作成や応募相談に自動的に活用されます。
        </p>
        <Button render={<Link href="/app/career/new" />} className="mt-4">
          キャリア棚卸しを始める
        </Button>
      </Card>

      {/* 4機能の概要 */}
      <div>
        <h2 className="mb-3 text-lg font-bold">Mairaができること</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <p className="font-medium">💬 キャリア棚卸し</p>
            <p className="text-muted-foreground mt-2 text-sm">
              雑談形式の対話で、あなたの強み・価値観・希望を構造化します
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-medium">📝 書類作成</p>
            <p className="text-muted-foreground mt-2 text-sm">
              履歴書・職務経歴書・志望動機・自己PRを、あなたの棚卸し結果から自動生成
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-medium">📋 応募管理 + Maira相談</p>
            <p className="text-muted-foreground mt-2 text-sm">
              応募の進捗管理 + ポップアップでいつでもMairaに相談できる
            </p>
          </Card>
          {/* 音声面接は本格ローンチで提供。未実装である旨を明示し、透過率で抑える */}
          <Card className="p-5 opacity-60">
            <p className="font-medium">🎙️ 音声面接(準備中)</p>
            <p className="text-muted-foreground mt-2 text-sm">
              本格ローンチで提供予定。音声でリアルな面接練習ができる
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
