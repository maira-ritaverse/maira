import Link from "next/link";
import { redirect } from "next/navigation";
import { CareerProfileEditForm } from "@/components/features/career-profile-edit-form";
import { Button } from "@/components/ui/button";
import { getCareerProfile } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し結果の編集ページ
 *
 * - getCareerProfile で現在の career_profile を取得し、編集フォームの初期値として渡す。
 * - profile が無い場合は一覧へ戻す(編集する対象がないため)。
 * - 編集対象は棚卸し本体のみ。diagnosis(キャリア診断結果)はフォームに出さない。
 *   保存経路の /api/career/profile が diagnosis を omit して受け取り、
 *   saveCareerProfile 内のマージで既存値を引き継ぐ。
 */
export default async function CareerProfileEditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    // 編集する対象が無いので一覧へ戻す。新規作成は別フロー(/app/career/new)。
    redirect("/app/career");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">棚卸し結果を編集</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            v{profileData.version} ・ 最終更新:{" "}
            {new Date(profileData.updatedAt).toLocaleString("ja-JP")}
          </p>
        </div>
        <Button render={<Link href="/app/career" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      <CareerProfileEditForm initial={profileData.profile} />
    </div>
  );
}
