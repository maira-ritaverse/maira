import Link from "next/link";

/**
 * プライバシーポリシー
 *
 * ADR 0006 でサーバーサイド暗号化への方針を確定したことに伴い、
 * 保管・AI 処理・運営者アクセスの範囲を明示する。
 * 登録時の明示同意(signup-form の checkbox)で本ページの内容に合意したことになる。
 */
export const metadata = {
  title: "プライバシーポリシー | Maira",
  description: "Maira のプライバシーポリシー。データの保管・AI 処理・運営者アクセスの範囲を明記。",
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
            株式会社Revorise(以下「当社」)は、AI 採用エージェント「Maira」(以下「本サービス」)
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

          <div className="space-y-2">
            <p className="font-medium">7-2. Google 連携(Calendar / Drive)</p>
            <p>
              Google Calendar への面談予定作成、Google Meet 録画(Drive 保存)の取り込みを行うため、
              本人が明示的に承認した <code className="text-xs">calendar.events</code> および{" "}
              <code className="text-xs">drive.readonly</code> スコープのみ使用します。
              トークンの暗号化保管、解除時の即時破棄、第三者提供の禁止、 90 日後の録画自動削除は
              Zoom 連携と同じ方針です。
            </p>
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
