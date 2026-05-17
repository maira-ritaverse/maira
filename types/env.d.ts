// 環境変数の型定義
// process.env.XXX を使う時に型補完が効くようにする
// `declare global` でグローバルの NodeJS.ProcessEnv に合流させる
// (`export {}` でこのファイル自体は module 扱いにする)

export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Supabase
      NEXT_PUBLIC_SUPABASE_URL: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
      SUPABASE_SERVICE_ROLE_KEY: string;

      // Anthropic(後続)
      ANTHROPIC_API_KEY?: string;
    }
  }
}
