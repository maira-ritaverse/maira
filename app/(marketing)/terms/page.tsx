import Link from "next/link";

/**
 * 利用規約
 */
export const metadata = {
  title: "利用規約 | Myaira",
  description: "Myaira の利用規約。",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">利用規約</h1>
          <p className="text-muted-foreground mt-1 text-xs">最終更新日:2026 年 6 月 15 日</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 1 条(適用)</h2>
          <p>
            本規約は、株式会社Revorise(以下「当社」)が提供する AI 採用エージェント「Myaira」
            (以下「本サービス」)の利用条件を定めるものです。
            本サービスを利用する全ての利用者は、本規約に同意したものとみなされます。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 2 条(利用登録)</h2>
          <p>
            本サービスの利用には、当社が指定する方法による利用登録が必要です。
            利用登録時には、当社の
            <Link href="/privacy" className="mx-1 underline">
              プライバシーポリシー
            </Link>
            への同意が必須です。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 3 条(禁止事項)</h2>
          <p>利用者は、以下の行為をしてはなりません。</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>法令または公序良俗に違反する行為</li>
            <li>第三者の個人情報を本人の同意なくアップロードする行為</li>
            <li>会議録音について、参加者全員の同意なく録音 / アップロードする行為</li>
            <li>本サービスのリバースエンジニアリング・スクレイピング・過度な API 呼び出し</li>
            <li>他の利用者または第三者の権利を侵害する行為</li>
            <li>その他、当社が不適切と判断する行為</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 4 条(会議録音について)</h2>
          <p>
            本サービスは、利用者が会議録音(音声・動画ファイル)をアップロードまたは Zoom / Google
            Meet 連携経由で取り込み、AI が文字起こしを行う機能を提供します。
          </p>
          <p>
            利用者は、録音内容に他の参加者が含まれる場合、
            <strong>
              当該参加者全員から事前に録音および本サービスでの解析処理について
              明示的な同意を取得する責任を負います。
            </strong>
            この義務違反により生じた一切の損害について、当社は責任を負いません。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 5 条(料金 / サブスクリプション)</h2>
          <p>
            本サービスの一部機能は有料プランの契約により利用可能です。料金、課金サイクル、
            解約条件等の詳細は、本サービス内の料金ページおよび Stripe Subscription
            の規約に従います。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 6 条(知的財産権)</h2>
          <p>
            本サービスに含まれる全てのコンテンツ(ソフトウェア、デザイン、商標、AI プロンプト等)
            の知的財産権は、当社または正当な権利者に帰属します。 利用者がアップロード /
            入力したコンテンツの著作権は、当該利用者に帰属します。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 7 条(免責事項)</h2>
          <p>
            本サービスは「現状有姿」で提供され、特定の用途への適合性、利用者の転職活動の成功、
            データの正確性等を保証しません。当社の故意・重過失による場合を除き、
            本サービスの利用または利用不能から生じた損害について責任を負いません。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 8 条(サービスの変更 / 終了)</h2>
          <p>
            当社は、利用者への事前通知をもって、本サービスの内容を変更し、または
            提供を終了することができます。終了の場合、合理的な期間を設けて
            データのエクスポート手段を提供します。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 9 条(準拠法 / 管轄)</h2>
          <p>
            本規約は日本法に準拠し、本サービスに関連して生じた紛争については、
            東京地方裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">
            関連:
            <Link href="/privacy" className="ml-2 underline">
              プライバシーポリシー
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
