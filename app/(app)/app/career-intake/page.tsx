import { redirect } from "next/navigation";

/**
 * 求職者向けの AI ヒアリングは廃止(エージェントが代理アップロード方式に移行)。
 * 旧 URL は /app(ダッシュボード)にリダイレクト。
 */
export default function CareerIntakeRedirectPage() {
  redirect("/app");
}
