import { ChatForm } from "./chat-form";

/**
 * AI動作確認用チャットページ
 *
 * 注意:このページは開発確認用。本番リリース前に削除する。
 * 会話履歴は保存されない(完全揮発)。
 */
export default function TestChatPage() {
  return (
    <div className="flex h-[calc(100vh-8rem)] max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">AI動作確認チャット</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          開発確認用のチャット画面です。会話は保存されません。
        </p>
      </div>

      <div className="flex-1">
        <ChatForm />
      </div>
    </div>
  );
}
