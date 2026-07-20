import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下のパス以外で実行:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化)
     * - favicon.ico
     * - 公開アセット(.svg, .png 等)
     * - monitoring (Sentry tunnel。 全 Sentry beacon で JWT 検証 + cookie churn を
     *   起こさない ため 除外。 セキュリティ 監査 H2)
     */
    "/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
