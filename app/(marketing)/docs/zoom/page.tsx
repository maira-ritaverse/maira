import Link from "next/link";

/**
 * Zoom 連携の使い方ドキュメント(Documentation URL 要件)
 *
 * Zoom Marketplace 申請の必須 URL:Documentation URL に指定する公開ページ。
 * 連携の追加・利用・削除を ステップ毎に 解説する。
 *
 * URL: https://app.maira.pro/docs/zoom
 */
export const metadata = {
  title: "Zoom 連携の使い方 | Maira",
  description:
    "Maira(マイラ)と Zoom の連携方法、Cloud Recording の自動取り込み、面談予約 / 再スケジュール / キャンセル、連携解除までの 操作手順をまとめたドキュメントです。",
};

export default function ZoomDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-8 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">Zoom 連携の使い方</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Maira と Zoom を連携すると、エージェント担当者は 1on1 キャリア面談の予約・録画取り込み
            (文字起こし → 履歴書 AI ドラフト)を 1 つの画面で 完結できます。 本ページでは 接続から
            解除までの 操作手順を 順番に 説明します。
          </p>
        </header>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">概要 — Maira × Zoom で できること</h2>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              Maira から クライアント(求職者)と の 1on1 面談を Zoom 会議として 1 クリックで予約
            </li>
            <li>会議終了後、Cloud Recording の 自動取り込み + 文字起こし</li>
            <li>文字起こしから AI(Anthropic Claude)が 履歴書 / 職務経歴書の 下書きを 自動生成</li>
            <li>クライアントの ダッシュボードに 「会議に参加」ボタンが 常時表示</li>
            <li>
              再スケジュール / キャンセルも Maira から実行 → Zoom と 自動同期、クライアントにも 通知
            </li>
          </ul>
          <p className="text-muted-foreground text-xs">
            連携は <span className="font-medium">ユーザー単位(User-managed)</span>{" "}
            です。エージェント 担当者 一人ひとりが ご自身の Zoom アカウントを 接続する形
            になります。
          </p>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Step 1 — Zoom を Maira に接続する</h2>
          <ol className="ml-6 list-decimal space-y-2">
            <li>Maira にエージェント担当者として ログインします。</li>
            <li>
              画面右上のメニュー →{" "}
              <code className="bg-muted rounded px-1">設定 → 連携・アドオン</code> を 開きます。
              (直接 URL は <code>/agency/settings/integrations</code> )
            </li>
            <li>
              「Zoom 連携」カードの 「<strong>Zoom に接続する</strong>」ボタンを クリック します。
            </li>
            <li>
              Zoom の OAuth 同意画面が 開きます。要求された スコープを 確認し 「
              <strong>Allow</strong>」を 押します。
            </li>
            <li>
              自動的に Maira の <code>設定 → 連携・アドオン</code> ページに 戻り、
              「接続中」バッジが 表示されれば 完了です。
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            ※ Maira 側に 保存される Zoom OAuth アクセス / リフレッシュトークンは AES-256-GCM 方式で
            暗号化されます。詳細は{" "}
            <Link href="/privacy" className="underline">
              プライバシーポリシー 第 7-1 条
            </Link>{" "}
            を ご覧ください。
          </p>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Step 2 — Maira から Zoom 面談を 予約する</h2>
          <ol className="ml-6 list-decimal space-y-2">
            <li>
              <code className="bg-muted rounded px-1">クライアント詳細画面</code> を 開きます。
            </li>
            <li>
              「<strong>面談を予約</strong>」ボタンを クリック → ダイアログが 開きます。
            </li>
            <li>サービスとして「Zoom」を 選択します。</li>
            <li>
              タイトル(求職者にも 見える)/ 議題メモ(エージェント側のみ) / 開始日時 / 長さ を
              入力します。
            </li>
            <li>
              「予約を作成」を 押すと、Zoom 上に 会議が 自動作成され、参加 URL が 表示されます。
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            予約と同時に、求職者には メール + Maira 内通知が 送信され、求職者の ダッシュボードに
            「会議に参加」ボタンが 表示されます。
          </p>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Step 3 — 会議実施 → 録画の自動取り込み</h2>
          <ol className="ml-6 list-decimal space-y-2">
            <li>
              予約された 時間に なったら、エージェント・求職者 双方が それぞれの 「参加」ボタンから
              Zoom 会議に 入ります。
            </li>
            <li>
              Maira から 作成した 会議は デフォルトで{" "}
              <strong>Cloud Recording(クラウド録画)が ON</strong> になっています。
            </li>
            <li>会議終了後、Zoom 側で 録画処理が 完了するまで 数分〜数十分 かかります。</li>
            <li>
              処理完了後、Maira が Webhook 通知を 受け取って 録画ファイルを 自動取り込み → OpenAI
              Whisper で 文字起こし → Anthropic Claude で 構造化 → 履歴書 / 職務経歴書の ドラフトを
              生成します。
            </li>
            <li>クライアント詳細画面の「面談履歴」セクションに 取り込み結果が 表示されます。</li>
          </ol>
          <p className="text-muted-foreground text-xs">
            ※ Cloud Recording が ON で 録画されている 必要が あります。ローカル 録画は
            取り込めません。
            <br />※ 自動取り込み は 「会議録音 自動連携」アドオン契約が 必要です。アドオン契約は
            連携 / アドオンページから 申し込めます。
          </p>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Step 4 — 再スケジュール / キャンセル</h2>
          <p>クライアント詳細画面の 面談履歴の 行末「⋯」メニューから 操作できます。</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>
              <strong>再スケジュール</strong>:Zoom 側の 会議も 更新され、求職者には 更新通知が
              送られます。 新しい .ics ファイルが 添付されます。
            </li>
            <li>
              <strong>キャンセル</strong>:Zoom 側の 会議も 削除され、求職者には キャンセル通知が
              送られます。
            </li>
          </ul>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Step 5 — Zoom 連携を 解除する</h2>
          <ol className="ml-6 list-decimal space-y-2">
            <li>
              Maira → <code className="bg-muted rounded px-1">設定 → 連携・アドオン</code> ページを
              開きます。
            </li>
            <li>
              「Zoom 連携」カードの 「<strong>Zoom 連携を解除</strong>」 を 押します。
            </li>
            <li>
              Maira 側に 保管されている アクセストークン / リフレッシュトークンが
              <strong>即座に 破棄</strong> されます。
            </li>
            <li>
              さらに Zoom 側でも アプリの 認可を 取り消したい場合は{" "}
              <a
                href="https://marketplace.zoom.us/user/installed"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Zoom Marketplace の Installed Apps ページ
              </a>{" "}
              で 「Maira」を Remove してください。
            </li>
          </ol>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">要求する スコープ と その理由</h2>
          <table className="w-full border text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="border p-2 text-left">Scope</th>
                <th className="border p-2 text-left">用途</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border p-2 font-mono">user:read:user</td>
                <td className="border p-2">接続ユーザの Zoom アカウントを Maira と 紐づける</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">meeting:read:meeting</td>
                <td className="border p-2">予約済み会議の詳細(時刻 / 参加 URL)表示</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">meeting:read:list_meetings</td>
                <td className="border p-2">予定一覧の表示 / 重複予約の検知</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">meeting:write:meeting</td>
                <td className="border p-2">Maira から 1on1 面談を 新規予約</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">meeting:update:meeting</td>
                <td className="border p-2">面談の再スケジュール</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">meeting:delete:meeting</td>
                <td className="border p-2">面談のキャンセル</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">cloud_recording:read:list_user_recordings</td>
                <td className="border p-2">終了直後の 録画存在検知(自動取り込み)</td>
              </tr>
              <tr>
                <td className="border p-2 font-mono">cloud_recording:read:recording</td>
                <td className="border p-2">録画ファイルの ダウンロード → 文字起こし</td>
              </tr>
            </tbody>
          </table>
          <p className="text-muted-foreground text-xs">
            個々のスコープの 詳細な 用途と データ取り扱い 方針は{" "}
            <Link href="/privacy" className="underline">
              プライバシーポリシー 第 7-1 条
            </Link>{" "}
            を ご覧ください。
          </p>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">トラブルシューティング</h2>

          <div className="space-y-4">
            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                「Zoom に接続する」を 押すと エラー画面に 飛ぶ
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>多くは 以下のいずれかが 原因です:</p>
                <ul className="ml-4 list-disc">
                  <li>Zoom にログインしていない / 別アカウントに ログイン中</li>
                  <li>Zoom 側で アプリ「Maira」の 認可を 取り消している</li>
                  <li>ブラウザの拡張機能(広告ブロッカー等)が OAuth フローを 妨害している</li>
                </ul>
                <p>
                  <strong>解決策:</strong> シークレットウィンドウで Zoom にログインし直してから
                  再試行してください。それでも 解決しない場合は{" "}
                  <Link href="/support" className="text-foreground underline">
                    サポート
                  </Link>{" "}
                  までご連絡ください。
                </p>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                会議は 作成されたが、録画が 取り込まれない
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <ul className="ml-4 list-disc">
                  <li>会議が Cloud Recording で 録画されたか 確認 → ローカル録画は 対象外です</li>
                  <li>Zoom 側で 録画処理が 完了しているか(終了直後は 数分〜数十分 かかる)</li>
                  <li>「会議録音 自動連携」アドオン契約が 有効か</li>
                  <li>
                    連携時に <code>cloud_recording:read:*</code> 2 つの スコープが 承認 済みか
                  </li>
                </ul>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                予約した 面談が 求職者の 画面に 表示されない
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <p>
                  求職者が 招待を 受諾して Maira アカウントを 作成し終わっているか
                  確認してください。 招待状態(invited)では まだ 表示されません(linked 状態に
                  なる必要が あります)。
                </p>
              </div>
            </details>

            <details className="border-foreground/10 rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                エラーコード が 表示された(例:4700 / 4702)
              </summary>
              <div className="text-muted-foreground mt-3 space-y-2 text-xs">
                <ul className="ml-4 list-disc">
                  <li>
                    <strong>4700 / Invalid Redirect:</strong> Maira 側設定の問題。 画面の URL と
                    エラー内容を 添えて サポートまでご連絡ください。
                  </li>
                  <li>
                    <strong>4702 / Invalid Client ID:</strong> Maira 側設定の問題。同上。
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </section>

        {/* ───────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xl font-bold">サポート</h2>
          <p>
            上記で 解決しない場合は{" "}
            <Link href="/support" className="underline">
              サポートページ
            </Link>{" "}
            から お問い合わせください(メール:
            <a href="mailto:support@maira.pro" className="underline">
              support@maira.pro
            </a>
            )。
          </p>
          <p className="text-muted-foreground text-xs">
            画面の スクリーンショット と 「Zoom に接続する」を 押した直後の URL を 添付すると
            原因特定が 早くなります。
          </p>
        </section>

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">
            関連:
            <Link href="/privacy" className="ml-2 underline">
              プライバシーポリシー
            </Link>
            <Link href="/terms" className="ml-2 underline">
              利用規約
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
