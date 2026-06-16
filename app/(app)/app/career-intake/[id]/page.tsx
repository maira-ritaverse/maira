import { redirect } from "next/navigation";

/**
 * 求職者向けの AI ヒアリング詳細ページは廃止。エージェント側で管理する。
 * 旧 URL は /app にリダイレクト。
 */
export default function CareerIntakeDetailRedirectPage() {
  redirect("/app");
}
