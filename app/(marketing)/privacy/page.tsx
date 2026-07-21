import Link from "next/link";

/**
 * プライバシーポリシー
 *
 * ADR 0006 でサーバーサイド暗号化への方針を確定したことに伴い、
 * 保管・AI 処理・運営者アクセスの範囲を明示する。
 * 登録時の明示同意(signup-form の checkbox)で本ページの内容に合意したことになる。
 */
export const metadata = {
  title: "プライバシーポリシー | Myaira",
  description: "Myaira のプライバシーポリシー。データの保管・AI 処理・運営者アクセスの範囲を明記。",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="space-y-6 text-sm leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">プライバシーポリシー</h1>
          <p className="text-muted-foreground mt-1 text-xs">最終更新日:2026 年 6 月 18 日</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 1 条(本ポリシーの目的)</h2>
          <p>
            株式会社Revorise(以下「当社」)は、AI 採用エージェント「Myaira」(以下「本サービス」)
            の提供にあたり、利用者の個人情報および利用データを以下の方針で取り扱います。
            本サービスをご利用いただくにあたっては、本ポリシーへの同意を必須としています。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 2 条(取得する情報)</h2>
          <p>本サービスは以下の情報を取得・保管します。</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>登録情報:メールアドレス・パスワード・表示名</li>
            <li>キャリア情報:履歴書・職務経歴書・志望動機・希望条件・対応履歴</li>
            <li>AI 対話の内容:キャリア棚卸し / 面接シミュレーター / AI 添削のやりとり</li>
            <li>会議録音と文字起こし:本人が明示的にアップロード / 連携した音声・動画ファイル</li>
            <li>エージェント企業の利用情報:顧客名簿・対応履歴・タスク・メールテンプレート 等</li>
            <li>利用状況:アクセスログ・操作ログ・通知の既読履歴</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 3 条(保管方法と暗号化)</h2>
          <p>
            機密性の高いフィールド(履歴書本文・対応履歴・推薦コメント・面接記録など)は、 AES-256-GCM
            方式によりサーバーサイドで暗号化して保管します。
            暗号鍵は当社の本番環境変数で厳格に管理されます。
          </p>
          <p>
            <strong>
              当初公開していた「クライアントサイド暗号化(運営者も復号できない)」方針は、
              会議録音・AI 文字起こし・履歴書自動生成 等のサービス機能と両立しないため、 2026 年 6
              月の方針改定で取り下げました。
            </strong>
            運営者(当社)は技術的に復号可能ですが、後述の範囲でのみアクセスします。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 4 条(運営者によるアクセスの範囲)</h2>
          <p>当社は、以下の目的に限定して保管データへアクセスします。</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>サービスの安定運用(障害対応・バックアップ確認・性能改善のための統計分析)</li>
            <li>
              本人が同意した AI 処理(履歴書 AI
              添削・会議録音からの履歴書自動生成・面接シミュレーター応答 等)
            </li>
            <li>不正利用 / 利用規約違反の調査(本人または第三者の権利・安全の保護に必要な場合)</li>
            <li>法令・行政機関・裁判所からの正当な要請に基づく対応</li>
          </ul>
          <p>
            上記以外の目的で従業員が個別のユーザデータを閲覧することはありません。
            アクセスは監査ログに記録され、定期的にレビューされます。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 5 条(AI 処理について)</h2>
          <p>
            本サービスは Anthropic Claude(Sonnet 4.6)および OpenAI Whisper 等の AI
            処理基盤を利用します。AI 推論時のデータは以下のとおり扱われます。
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>当社サーバから AI 推論基盤へ送信されるのは、機能に必要な最小限のテキストです</li>
            <li>送信先 AI 事業者の利用規約上、AI モデルの学習には利用されません(opt-out 契約)</li>
            <li>会議録音の文字起こし結果は暗号化して保管され、本人と当社のみがアクセスできます</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 6 条(第三者提供)</h2>
          <p>
            本人の明示的な同意がない限り、第三者に個人情報を提供しません。
            エージェント企業との連携機能(履歴書 / 職務経歴書の開示等)については、
            利用者が個別に「連携する」アクションを取った場合に限り、必要な範囲で共有されます。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 7 条(外部サービス連携時のデータ取り扱い)</h2>
          <p>
            本サービスは、ユーザー本人が明示的に接続を承認した外部サービスに対してのみ、
            限定的なアクセスを行います。連携の解除は本サービス内
            <code className="bg-muted mx-1 rounded px-1 text-xs">設定 → 連携・アドオン</code>
            からいつでも可能で、解除後は当社側に保管されているアクセストークンが直ちに破棄されます。
          </p>

          <div className="space-y-2">
            <p className="font-medium">7-1. Zoom 連携</p>
            <p>本サービスは以下の Zoom スコープを使用します。</p>
            <ul className="ml-6 list-disc space-y-1">
              <li>
                <code className="text-xs">user:read:user</code>
                :接続ユーザーの Zoom アカウントを本サービスのプロフィールと紐づけるため
              </li>
              <li>
                <code className="text-xs">meeting:read:meeting</code> /{" "}
                <code className="text-xs">meeting:read:list_meetings</code>
                :本サービス内の予定一覧および「次の面談」表示のため
              </li>
              <li>
                <code className="text-xs">meeting:write:meeting</code> /{" "}
                <code className="text-xs">meeting:update:meeting</code> /{" "}
                <code className="text-xs">meeting:delete:meeting</code>
                :本サービスから 1 on 1 キャリア面談を予約・再スケジュール・キャンセルするため
              </li>
              <li>
                <code className="text-xs">cloud_recording:read:list_user_recordings</code> /{" "}
                <code className="text-xs">cloud_recording:read:recording</code>
                :面談終了後の Cloud Recording を自動取り込みし、文字起こし および AI
                履歴書ドラフト生成に用いるため
              </li>
            </ul>
            <p>取り扱い方針:</p>
            <ul className="ml-6 list-disc space-y-1">
              <li>
                取得した Zoom OAuth アクセス・リフレッシュトークンは AES-256-GCM
                方式で暗号化してサーバーサイドに保管します
              </li>
              <li>
                取得した会議メタデータ(タイトル / 開始時刻 / 参加 URL)および録画ファイルは、
                接続したエージェント担当者と本人のみがアクセスできます
              </li>
              <li>
                取り込んだ録画ファイルは、文字起こしと AI 構造化処理の完了後 90
                日経過時点で自動削除されます(本人が明示的に保持を選択した場合を除く)
              </li>
              <li>
                Zoom から取得したデータは、第三者(広告ネットワーク・データブローカー等)に
                <strong>提供しません</strong>
              </li>
              <li>
                文字起こしには OpenAI Whisper、構造化には Anthropic Claude を 利用しますが、
                いずれも AI 学習への利用は opt-out 契約済みです
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <p className="font-medium">7-2. Google 連携(Calendar / Meet)</p>
            <p>
              Google Calendar への面談予定作成(Google Meet URL 付き)を行うため、本人が明示的に
              承認した以下のスコープのみ使用します。 Restricted スコープは一切使用しません (2026 年
              6 月 19 日に <code className="text-xs">drive.readonly</code> スコープを撤去、 Google
              Meet 録画は Myaira への手動アップロード運用に切替済み)。
            </p>

            <div className="space-y-1">
              <p className="text-sm font-medium">要求スコープ(いずれも Sensitive)</p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  <code className="text-xs">openid</code> / <code className="text-xs">email</code>
                  :本人の Google アカウント識別(google_sub / google_email)のため
                </li>
                <li>
                  <code className="text-xs">https://www.googleapis.com/auth/calendar.events</code>
                  :Myaira 内で作成した面談予定を Google Calendar のイベントとして作成 (Google Meet
                  URL 自動発行)、および同イベントの更新・削除のため
                </li>
              </ul>
            </div>

            {/* Google の OAuth 検証で要求される 5 項目の開示。 見出しを英語も併記して、
                Google 側レビュアーがブラウザ翻訳せずとも該当箇所を追えるようにする。 */}
            <div className="space-y-1">
              <p className="text-sm font-medium">7-2-1. アクセスするデータ(Data Access)</p>
              <p>本サービスが Google API を通じて取得するデータは以下に限定されます。</p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  Google アカウントの識別子(<code className="text-xs">sub</code>)と メールアドレス
                </li>
                <li>
                  本サービスから作成した Google Calendar
                  イベントのメタデータ(タイトル・開始/終了時刻・ 参加者一覧・Meet URL)およびイベント
                  ID
                </li>
              </ul>
              <p>
                取得しないもの:過去に作成された他のカレンダーイベント、他のカレンダーの内容、 Google
                Drive のファイル、Gmail の内容、連絡先、Chat メッセージ。
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">7-2-2. データの利用目的(Data Use)</p>
              <p>取得した Google データは以下の目的にのみ使用します。</p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  ユーザー本人が Myaira 内で作成した面談予定を、本人の Google Calendar に Meet URL
                  付きイベントとして反映するため
                </li>
                <li>反映後の Meet URL を Myaira 上に表示し、参加者に共有するため</li>
                <li>予定の再スケジュール・キャンセルを Google Calendar 側にも反映するため</li>
                <li>
                  接続状態の維持と接続本人の識別 (Google
                  アカウントの誤接続・別アカウントへの切替検知)のため
                </li>
              </ul>
              <p>
                広告配信、行動プロファイリング、金融審査、その他ユーザー向け機能以外の目的には
                <strong>一切利用しません</strong>。
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">7-2-3. データの提供先(Data Transfer)</p>
              <p>
                Google から取得した個人データを、以下のいずれにも
                <strong>提供・販売しません</strong>。
              </p>
              <ul className="ml-6 list-disc space-y-1">
                <li>広告ネットワーク・アドテク企業</li>
                <li>データブローカー・データ販売事業者</li>
                <li>信用スコア・金融審査事業者</li>
                <li>本サービスと無関係な第三者一般</li>
              </ul>
              <p>
                Myaira のインフラベンダー(Vercel、Supabase)は、
                本サービス提供に必要なホスティング・データベース処理のためにのみ Google データを
                取り扱い、独自の分析・目的外利用は行いません(それぞれの Data Processing Agreement
                に基づく)。
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">7-2-4. データの保護(Data Protection)</p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  Google OAuth アクセストークン・リフレッシュトークンは AES-256-GCM
                  方式でサーバーサイド暗号化して保管
                </li>
                <li>すべての Google API 通信は TLS 1.2 以上の暗号化通信で行う</li>
                <li>
                  データベース(Supabase / PostgreSQL)は Row Level Security で
                  本人と接続許諾を受けたエージェント担当者のみアクセス可能
                </li>
                <li>
                  スタッフによる不正アクセスを防ぐため、本番データベースへの直接アクセスは
                  監査ログ対象とし、業務上必要な場合に限定
                </li>
              </ul>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                7-2-5. データの保管期間・削除(Data Retention &amp; Deletion)
              </p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  Google OAuth トークン:本人が「Google 連携解除」を実行した時点で Myaira
                  側から即時削除、および Google 側のトークン失効 API を呼び出して破棄
                </li>
                <li>
                  Myaira 内の面談予定情報:元となった Myaira の面談予定が削除された時点で 対応する
                  Google Calendar イベントも削除。 Myaira アカウントを退会した場合は 30
                  日以内に関連する全データを削除
                </li>
                <li>
                  ユーザーからの明示的な削除要求は Myaira サポート窓口 (
                  <a href="mailto:support@maira.pro" className="text-primary underline">
                    support@maira.pro
                  </a>
                  ) で受付、7 営業日以内に対応
                </li>
              </ul>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                7-2-6. Limited Use 準拠(Google API Services User Data Policy)
              </p>
              <p>
                本サービスによる Google Workspace API から受領したデータの取り扱いは、
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Google API Services User Data Policy
                </a>
                (Limited Use 要件を含む)に準拠します。 具体的には以下を遵守します。
              </p>
              <ul className="ml-6 list-disc space-y-1">
                <li>
                  Google ユーザーデータは、本ポリシー 7-2-2 に記載したユーザー向け機能の
                  提供・改善以外の目的には使用しません
                </li>
                <li>
                  Google ユーザーデータは、AI / 機械学習モデル(Anthropic Claude 等)の
                  学習・改善には使用しません。 個別ユーザーの当該セッション内で回答生成に
                  利用する場合も、当該ユーザーの明示的な操作に基づく場合に限ります
                </li>
                <li>
                  Google ユーザーデータを、AI / 機械学習モデルの学習に使用する第三者サービスに
                  転送することはありません。 本サービスが利用する AI API プロバイダー
                  (Anthropic)とは、モデル学習に本サービスの入出力を使用しない旨の 契約(zero data
                  retention / no training)を結んでいます
                </li>
                <li>
                  Google ユーザーデータを、人間のレビュアーが読める形で扱うことは、
                  法令遵守、セキュリティ調査、ユーザー同意に基づくサポート対応のいずれかに
                  限定します
                </li>
              </ul>
              <p className="mt-1 rounded bg-slate-50 p-2 text-xs italic dark:bg-slate-900">
                Compliance statement (English): The use of raw or derived user data received from
                Google Workspace APIs by Myaira will adhere to the Google API Services User Data
                Policy, including the Limited Use requirements.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 8 条(利用者の権利)</h2>
          <p>利用者は以下の権利を有します。</p>
          <ul className="ml-6 list-disc space-y-1">
            <li>登録情報・保管データの閲覧・修正・削除</li>
            <li>会議録音 / 文字起こしデータの個別削除</li>
            <li>アカウントの退会(全データの削除を伴う)</li>
            <li>本ポリシーの改定通知の受領</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 9 条(ポリシーの改定)</h2>
          <p>
            当社は本ポリシーを必要に応じて改定することがあります。重要な変更がある場合は、
            本サービス内またはメールで事前に通知し、利用継続をもって新ポリシーへの同意とみなします。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">第 10 条(お問い合わせ)</h2>
          <p>
            本ポリシーに関するお問い合わせは、本サービス内のお問い合わせフォームまたは
            株式会社Revorise の公式サイト経由でお願いします。
          </p>
        </section>

        <footer className="text-muted-foreground border-t pt-4 text-xs">
          <p>© 2026 Revorise Inc.</p>
          <p className="mt-1">
            関連:
            <Link href="/terms" className="ml-2 underline">
              利用規約
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
