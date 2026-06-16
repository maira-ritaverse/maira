/**
 * 公開フォーム /f/[token] の 404 ページ。
 * 認証不要。トークンが invalid な uuid 形式、または DB 上に存在しないときに表示。
 */
export default function PublicIntakeNotFound() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-2xl font-bold">フォームが見つかりません</h1>
        <p className="text-muted-foreground text-sm">
          このフォーム URL は無効か、現在利用できません。
          <br />
          ご担当者に正しい URL をお問い合わせください。
        </p>
      </div>
    </div>
  );
}
