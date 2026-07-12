/**
 * MA シナリオ一覧 / 更新 API
 *
 *   GET   /api/agency/ma/scenarios
 *     → 自組織の有効化状態を含めたシナリオビュー(プリセット + 有効化)を返す
 *
 *   PATCH /api/agency/ma/scenarios
 *     → 2026-07-12 以降 410 Gone を返す(旧 ma_scenarios の read-only 化に伴い)。
 *
 * 認可:
 *   - GET は organization_member であれば誰でも(admin / advisor)
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews } from "@/lib/ma/queries";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const views = await listScenarioViews(role.organization.id);
    return NextResponse.json({ scenarios: views });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to list scenarios", message }, { status: 500 });
  }
}

/**
 * 旧 ma_scenarios は 20260712000004 で完全 read-only 化されている(トリガーで
 * INSERT/UPDATE/DELETE が拒否される)。 このため PATCH は実質不可となり、
 * upsertScenarioActivation を呼ぶと必ず 500 になる。 ユーザー体験を守るため
 * ここで先に 410 Gone を返し、 Flow ビルダーに誘導する。
 */
export async function PATCH(_request: Request) {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "旧シナリオは Flow ビルダーに移行しました。 新しい配信の作成・編集は /agency/marketing/flows から行ってください。",
      migration_url: "/agency/marketing/flows",
    },
    { status: 410 },
  );
}
