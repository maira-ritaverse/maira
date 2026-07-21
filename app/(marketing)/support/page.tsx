import Link from "next/link";

/**
 * サポート / お問い合わせ ページ
 *
 * Zoom Marketplace 申請の「Support URL」要件を満たす公開ページ。
 * ・連絡先メアド(Cloudflare Email Routing で個人 Gmail に転送)
 * ・サービス全体 / Zoom 連携 / Google 連携 のよくある質問への リンク
 * ・障害情報の通知先
 *
 * URL: https://app.maira.pro/support
 */
export const metadata = {
  title: "サポート | Myaira",
  description:
    "Myaira(マイラ)のサポート / お問い合わせ窓口。連絡先、よくある質問、外部連携(Zoom / Google)のヘルプへのリンクをまとめています。",
};

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-8 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">サポート</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Myaira(マイラ)のご利用にあたって ご不明な点・不具合のご報告・外部サービス連携の
            セットアップなど、こちらの窓口で対応いたします。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">お問い合わせ</h2>
          <p>メールでお問い合わせいただけます。営業日 24 時間以内の返信を目安にしています。</p>
          <div className="bg-muted/50 space-y-2 rounded-lg border p-4">
            <p>
              <span className="text-muted-foreground text-xs">メール:</span>
              <br />
              <a
                href="mailto:support@maira.pro"
                className="text-foreground font-mono text-base font-medium underline"
              >
                support@maira.pro
              </a>
            </p>
            <p className="text-muted-foreground text-xs">
              ※ 返信に必要なため、メール本文に
              <span className="mx-1 font-medium">ご利用中のアカウントのメールアドレス</span>
              を必ず記載してください。
              <br />※ 個人情報(履歴書本文・パスワード等)は メール本文には書かないでください。
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">よくある質問(FAQ)</h2>

          <div className="space-y-4">
            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                Zoom と連携できません / エラーが出ます
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>
                  <Link href="/docs/zoom" className="text-foreground underline">
                    Zoom 連携の使い方ドキュメント
                  </Link>{" "}
                  の「トラブルシューティング」セクションを ご覧ください。よくある原因:
                </p>
                <ul className="ml-4 list-disc">
                  <li>個人の Zoom メールアドレスが招待されていない(Marketplace 公開前)</li>
                  <li>Zoom 側でアプリの 認可を 取り消してしまっている</li>
                  <li>ブラウザのキャッシュ / 別 Zoom アカウントへのログイン残り</li>
                </ul>
                <p>
                  解決しない場合は、上記の <code>support@maira.pro</code>{" "}
                  までメールでご連絡ください。 画面のスクリーンショットと「Zoom
                  に接続する」を押した直後の URL を 添付すると 早く解決 できます。
                </p>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                会議録音が Myaira に取り込まれません
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>以下を ご確認ください:</p>
                <ul className="ml-4 list-disc">
                  <li>
                    会議が <span className="font-medium">Cloud Recording(クラウド録画)</span> で
                    保存されているか(ローカル録画は取り込まれません)
                  </li>
                  <li>Zoom が録画処理を完了しているか(終了直後は数分〜数十分かかります)</li>
                  <li>
                    Myaira 側で 「会議録音 自動連携」 アドオン契約が 有効になっているか (連携 /
                    アドオンページで 確認可)
                  </li>
                  <li>
                    連携時に <code>cloud_recording:read:*</code> スコープが 承認されているか
                  </li>
                </ul>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                連携した Zoom / Google を 解除したい
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>
                  Myaira にログイン →{" "}
                  <code className="bg-muted rounded px-1">設定 → 連携・アドオン</code>{" "}
                  ページで、各サービスの「連携を解除」ボタンを 押してください。 解除と同時に、Myaira
                  側に 保管されている アクセストークンは 即座に 破棄されます。
                </p>
                <p>
                  さらに Zoom 側でも アプリの 認可を 取り消したい場合は{" "}
                  <a
                    href="https://marketplace.zoom.us/user/installed"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline"
                  >
                    Zoom Marketplace の Installed Apps ページ
                  </a>{" "}
                  で 「Myaira」 を 探して Remove を 押してください。
                </p>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                アカウントを 退会したい(全データ削除)
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>
                  Myaira にログイン →{" "}
                  <code className="bg-muted rounded px-1">設定 → アカウント</code> ページで{" "}
                  「アカウントを削除」を 押してください。 退会と同時に 履歴書本文 / 会議録音 /
                  文字起こし /連携トークン 等 すべてのデータが 削除されます。
                </p>
                <p>
                  退会フローが UI に 見つからない場合は <code>support@maira.pro</code>{" "}
                  までご連絡ください。
                </p>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                データ主体の権利(閲覧・修正・削除)を 行使したい
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>
                  <Link href="/privacy" className="text-foreground underline">
                    プライバシーポリシー 第 8 条
                  </Link>{" "}
                  に 規定された 権利(閲覧 / 修正 / 削除 / 退会 / 改定通知の受領)は、Myaira
                  画面内の各機能から 行使できます。 画面操作で 完結しない 個別ご要望は{" "}
                  <code>support@maira.pro</code> までご連絡ください。
                </p>
              </div>
            </details>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">障害情報・サービス停止のお知らせ</h2>
          <p className="text-muted-foreground text-xs">
            計画停止・大規模障害が 発生した場合は、Myaira 内の通知 および 上記メールへ 個別連絡
            いたします。 緊急時の問い合わせも 同じ窓口( <code>support@maira.pro</code>{" "}
            )宛にお願いいたします。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">関連ドキュメント</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              <Link href="/docs/zoom" className="underline">
                Zoom 連携の使い方
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="underline">
                プライバシーポリシー
              </Link>
            </li>
            <li>
              <Link href="/terms" className="underline">
                利用規約
              </Link>
            </li>
          </ul>
        </section>

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">運営:株式会社Revorise</p>
        </footer>
      </article>
    </main>
  );
}
