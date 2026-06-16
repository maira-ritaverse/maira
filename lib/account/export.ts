/**
 * 本人開示用のアカウントデータエクスポート(個人情報保護法 第33条 対応)
 *
 * 目的:
 *   - 本人が自分の Maira 上のデータを 1 つの JSON として取得できる
 *   - 暗号化対象データは復号後の平文を返す(本人だけが見るためサーバ側で復号 OK)
 *   - 含まれないもの:他人とのやり取りでブラックボックスのもの(エージェント側 CRM 等)
 *     → これらは本人データではないため対象外
 *
 * 注意:
 *   - メモリ展開で全件取り出す(MVP 規模で十分。データ量が爆発したらストリーミング化)
 *   - 取得は最新 100 件ずつ程度に絞る(古いログまで全部出すと過去のサンプル時代のデータも出る)
 *   - 失敗時は途中段階の null を許容して、できる範囲で JSON を返す
 */
import { listApplications } from "@/lib/applications/queries";
import { getCareerProfile } from "@/lib/career/conversations";
import { listCvs } from "@/lib/cvs/queries";
import { listResumes } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";
import { listAllTasks } from "@/lib/tasks/queries";

export type AccountExport = {
  exportedAt: string;
  user: {
    id: string;
    email: string | null;
  };
  profile: unknown;
  careerProfile: unknown;
  resumes: unknown;
  cvs: unknown;
  applications: unknown;
  tasks: unknown;
};

/**
 * 本人のアカウントデータを集約して 1 つのオブジェクトに。
 *
 * 既存の listX / getX 関数は復号済みデータを返すため、ここでは集約のみ行う。
 * RLS 経由で「本人のレコードしか取れない」ことが保証される。
 */
export async function buildAccountExport(params: {
  userId: string;
  email: string | null;
}): Promise<AccountExport> {
  const supabase = await createClient();

  // profile(account_type / onboarded_at / is_maira_admin 等の機微でない属性)
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, account_type, onboarded_at, is_maira_admin, created_at, updated_at")
    .eq("id", params.userId)
    .maybeSingle();

  // 復号済みデータの集約。失敗してもそこだけ null で続行する。
  const [careerProfileResult, resumes, cvs, applications, tasks] = await Promise.allSettled([
    getCareerProfile(params.userId),
    listResumes(params.userId),
    listCvs(params.userId),
    listApplications(params.userId),
    listAllTasks(params.userId),
  ]);

  const settled = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: params.userId,
      email: params.email,
    },
    profile: profileRow,
    careerProfile: settled(careerProfileResult),
    resumes: settled(resumes),
    cvs: settled(cvs),
    applications: settled(applications),
    tasks: settled(tasks),
  };
}
