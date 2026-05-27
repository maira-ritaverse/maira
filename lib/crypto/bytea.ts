/**
 * PostgreSQL bytea カラムと TypeScript 文字列の相互変換ヘルパー
 *
 * このモジュールは applications / tasks / messages など、
 * bytea カラムへ平文 JSON や文字列を書き込む箇所で共通利用する。
 *
 * 重要な経緯(過去のバグ):
 * supabase-js は insert/update の値を JSON.stringify するため、Node の Buffer を
 * 直接渡すと Buffer.toJSON() が呼ばれて `{"type":"Buffer","data":[...]}` という
 * オブジェクトに変換され、PostgREST はその JSON 文字列をそのまま bytea に書き込む。
 * 結果として読み戻したデータが文字化けする。
 *
 * これを避けるため、bytea には PostgreSQL の bytea テキスト入力形式
 * `\x` + hex を文字列で渡す。supabase-js は文字列としてそのまま送り、
 * PostgreSQL 側が bytea にデコードする。
 *
 * Week 3 で AES-256-GCM の本物の暗号化に置き換える際は、暗号文(Uint8Array)を
 * 同じ `\xHEX` 形式でラップして書き込むことになる。
 */

/**
 * テキスト → bytea 書き込み用の文字列(`\xHEX` 形式)
 */
export function textToByteaInput(text: string): string {
  return "\\x" + Buffer.from(text, "utf-8").toString("hex");
}

/**
 * Supabase が返す bytea を文字列に戻す
 *
 * 返却形式は環境依存で以下のいずれか:
 * 1. `\x` プレフィックス付きの hex 文字列(PostgREST デフォルト)
 * 2. Base64 文字列
 * 3. Uint8Array / Buffer
 *
 * 想定外の形式が来た場合は空文字を返す(UI を crash させないため)。
 */
export function byteaToText(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex").toString("utf-8");
    }
    return Buffer.from(value, "base64").toString("utf-8");
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf-8");
  }

  return "";
}
