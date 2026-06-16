import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getApplication } from "@/lib/applications/queries";
import { getCareerProfile } from "@/lib/career/conversations";
import { listCvs } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { listTasksByApplication } from "@/lib/tasks/queries";
import { ApplicationForm } from "../application-form";
import { AdvisorButton } from "./advisor-button";
import { ApplicationDocumentDownload } from "./application-document-download";
import { DeleteButton } from "./delete-button";
import { PrCustomizationSection } from "./pr-customization-section";
import { SetPopupApplication } from "./set-popup-application";
import { TaskList } from "./task-list";

/**
 * 応募詳細・編集ページ
 *
 * Server Component で application 本体・タスク・career_profile の有無を並列取得し、
 * - AdvisorButton: 「Mairaに相談」セッション開始
 * - TaskList: 「次にやること」セクション
 * - ApplicationForm: 編集フォーム
 * - DeleteButton: 削除ボタン
 * の順で並べる。他人の応募 / 存在しない id の場合は notFound()。
 *
 * profile 有無は AdvisorButton のガード(キャリア棚卸し未完なら相談不可)用に使う。
 */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [application, tasks, profileData, resumes, cvs] = await Promise.all([
    getApplication(id, user.id),
    listTasksByApplication(id, user.id),
    getCareerProfile(user.id),
    listResumes(user.id),
    listCvs(user.id),
  ]);

  if (!application) notFound();

  const hasProfile = profileData !== null;

  // ダウンロード UI 用に id / title だけ抜き出して渡す(機密のあるフィールドはクライアントに渡さない)
  const resumeOptions = resumes.map((r) => ({ id: r.id, title: r.title }));
  const cvOptions = cvs.map((c) => ({ id: c.id, title: c.title }));

  return (
    // 応募詳細は情報量が多い(相談 / タスク / PRカスタマイズ / 書類DL / 編集フォーム / 削除)。
    // モバイルでは縦並びのまま、lg(>=1024px)以上で 2 カラムに分けて画面を有効活用する。
    // 左カラム=主アクション系(相談、タスク、編集フォーム)、右カラム=書類系(PRカスタマイズ、書類DL)。
    <div className="mx-auto max-w-6xl space-y-6">
      {/* PopupChatContext に「現在見ている応募ID」を伝える(Launcher 表示用) */}
      <SetPopupApplication applicationId={application.id} />

      {/* ヘッダー(全幅) */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{application.details.company}</h1>
          <p className="text-muted-foreground truncate text-sm">{application.details.position}</p>
        </div>
        <Button render={<Link href="/app/applications" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      {/* 2 カラム本体:items-start で左右の高さ差を吸収(短い側が縦に伸びない) */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* === 左カラム:主アクション === */}
        <div className="space-y-6">
          {/* Mairaに相談:キャリア棚卸し未完の場合は誘導文を出してボタンを非活性に */}
          <Card className="border-primary/40 bg-primary/5 p-6">
            {hasProfile ? (
              <p className="mb-3 text-sm">
                この応募について、Mairaに相談できます。面接対策、次のアクション、不安なことなど、何でも聞いてください。
              </p>
            ) : (
              <p className="mb-3 text-sm">
                Mairaに相談するには、先に
                <Link href="/app/career" className="font-medium underline">
                  キャリア棚卸し
                </Link>
                を完了させてください。
              </p>
            )}
            <AdvisorButton applicationId={application.id} hasProfile={hasProfile} />
          </Card>

          <TaskList applicationId={application.id} initialTasks={tasks} />

          <ApplicationForm mode="edit" existing={application} />
        </div>

        {/* === 右カラム:書類関連 === */}
        <div className="space-y-6">
          {/* この応募ごとの PR(志望動機 / 自己 PR)カスタマイズ */}
          <PrCustomizationSection applicationId={application.id} />

          {/* カスタマイズを反映した履歴書 / 職務経歴書のダウンロード入口 */}
          <ApplicationDocumentDownload
            applicationId={application.id}
            resumes={resumeOptions}
            cvs={cvOptions}
          />
        </div>
      </div>

      {/* 削除(全幅、最下部に置いて誤操作を防ぐ) */}
      <DeleteButton applicationId={application.id} />
    </div>
  );
}
