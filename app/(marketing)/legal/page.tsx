import Link from "next/link";

/**
 * 特定商取引法 に基づく 表記
 *
 * 電気通信利用役務 (SaaS / アプリ内課金) 提供者として 必要 な 表示項目。
 * 経産省 ガイドライン に 沿った 標準項目 + Myaira 個別事項を 掲載。
 *
 * 法改正 / 屋号変更時は 本ページ を 更新する だけで 反映 される。
 *
 * 参考:消費者庁「特定商取引法ガイド」
 *   https://www.no-trouble.caa.go.jp/what/mailorder/
 */
export const metadata = {
  title: "特定商取引法に基づく表記 | Myaira",
  description:
    "Myaira(マイラ)を 運営する 株式会社Revorise の 特定商取引法 に基づく表記。販売事業者名、所在地、連絡先、販売価格、支払方法、引渡時期、返品・解約条件を 明示します。",
};

const COMPANY = "株式会社Revorise";
const REPRESENTATIVE = "久保 椋矢";
const ADDRESS = "大阪府大阪市北区豊崎 1-8-1";
const CONTACT_EMAIL = "maira-info@revorise.jp";
const SERVICE_NAME = "Myaira(マイラ)";

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">特定商取引法に基づく表記</h1>
          <p className="text-muted-foreground mt-1 text-xs">最終更新日:2026 年 6 月 29 日</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">販売事業者</h2>
          <p>{COMPANY}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">代表者</h2>
          <p>{REPRESENTATIVE}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">所在地</h2>
          <p>{ADDRESS}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">連絡先</h2>
          <p>
            メール:
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="text-muted-foreground text-xs">
            ※ お電話番号 は 請求あり次第 遅滞なく 提示します。 ご連絡は サポートメール または{" "}
            <Link href="/support" className="underline">
              サポートページ
            </Link>{" "}
            より お問い合わせください。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">サービス名</h2>
          <p>{SERVICE_NAME}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">販売価格</h2>
          <p>各 サービスページ または アプリ内 課金画面 に 表示する 金額(税込)とします。</p>
          <ul className="ml-6 list-disc space-y-1 text-xs">
            <li>求職者向け 基本機能:無料(AI 利用回数 / 月次 制限 あり)</li>
            <li>求職者向け アドオン:アプリ内 表示価格 に従い 月額 課金</li>
            <li>エージェント企業向け Pro プラン:お問い合わせ ベース (個別 見積)</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">商品代金以外の必要料金</h2>
          <p>消費税、インターネット接続料、通信料 等は ご利用者の 負担と なります。</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">支払方法</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>クレジットカード(Visa / Mastercard / AMEX / JCB / Diners)</li>
            <li>App Store / Google Play 経由 の アプリ内 課金(将来対応予定)</li>
            <li>エージェント企業 Pro プラン:銀行振込 / クレジットカード(個別 取り決め)</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">支払時期</h2>
          <p>サブスクリプション 契約 時 に 初回 課金、以降 毎月 同日 に 自動 更新 課金 します。</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">商品の引渡時期</h2>
          <p>決済 完了 後、アカウント に 即時 反映 されます (デジタルサービス 提供)。</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">返品・キャンセル(中途解約)</h2>
          <p>
            デジタル サービス の 特性 上、決済後の 返金 は 原則 お受けできません。 ただし、 当社の
            責に 帰する 重大な 不具合 で サービスが 利用 できない 状態 が 30 日 以上 続いた 場合
            は、 お問い合わせ いただく ことで 個別 対応 いたします。
          </p>
          <p>
            サブスクリプション の 解約 は アカウント 内 の 設定 ページ から いつでも 可能 で、 次回
            課金日 までは 引き続き ご利用 いただけます。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">動作環境</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>最新版 の Google Chrome / Safari / Firefox / Edge</li>
            <li>iOS 16 以降 / Android 10 以降 (PWA インストール 推奨)</li>
            <li>安定した インターネット接続</li>
          </ul>
        </section>

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">
            関連:
            <Link href="/terms" className="ml-2 underline">
              利用規約
            </Link>
            <Link href="/privacy" className="ml-2 underline">
              プライバシーポリシー
            </Link>
            <Link href="/support" className="ml-2 underline">
              サポート
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
