/**
 * Google Cloud OAuth 検証の 審査 員 用 reviewer アカウント を 本番 Supabase
 * (maira-prod) に 作成 する スクリプト。
 *
 * Zoom reviewer と 目的 は 同じ (レビュアー が ログイン して Google 連携 +
 * 面談 作成 を 試せる 環境 を 用意 する) が、 Zoom 関連 の 事前 seed は 不要 な ため
 * 別 スクリプト に する。
 *
 * 実行 例:
 *   FIELD_ENCRYPTION_KEYS='{"v1":"<base64>"}' \
 *   FIELD_ENCRYPTION_CURRENT_VERSION="v1" \
 *   SUPABASE_URL="https://xxatkimjfiaidxfuglae.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   REVIEWER_EMAIL="google-cloud-reviewer@maira.pro" \
 *   REVIEWER_PASSWORD="<strong-random-password>" \
 *   pnpm exec tsx scripts/create-google-reviewer.ts
 *
 * 動作:
 *   1. auth.admin.createUser でメール確認スキップで作成 (冪等: 既存なら 削除 → 作り直し)
 *   2. organizations に "Google Cloud OAuth Reviewer" 組織を作成
 *   3. organization_members に admin として紐付け
 *   4. profiles の display_name を "Google Cloud Reviewer" にセット
 *   5. ダミークライアント 3 件 + ダミー求人 2 件 をシード
 *      (レビュアー が Google 連携後 に 「面談を予約」 で 相手 に する ため)
 *
 * Zoom reviewer script と の 違い:
 *   ・LINE 関連 seed は 省略 (Google 検証 に は 不要)
 *   ・meeting_schedules seed も 省略 (レビュアー が 自分 の Google アカウント で 作る)
 *   ・referrals / interviews seed は 省略 (Google 連携 の 検証 と は 無関係)
 *
 * CLAUDE.md ルール:.env や 本番 シークレット を コード に 含めない。
 * REVIEWER_EMAIL / REVIEWER_PASSWORD は env 必須。 既定値 は 持たせない。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL;
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD;
const ORG_NAME = process.env.REVIEWER_ORG_NAME ?? "Google Cloud OAuth Reviewer";
const DISPLAY_NAME = process.env.REVIEWER_DISPLAY_NAME ?? "Google Cloud Reviewer";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("SUPABASE_URL is required");
if (!SERVICE_ROLE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY is required");
if (!REVIEWER_EMAIL) fail("REVIEWER_EMAIL is required");
if (!REVIEWER_PASSWORD) fail("REVIEWER_PASSWORD is required");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExistingUserId(email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  type AuthUser = { id: string; email?: string | null };
  const users = (data?.users ?? []) as AuthUser[];
  const found = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}

async function deleteExistingReviewer(userId: string): Promise<void> {
  // organization_members / organizations / client_records / job_postings は
  // organization.id の on delete cascade で 一緒 に 消える 構成。
  // 最後 に auth ユーザー を 消す。
  const { data: memberRows } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId);
  const orgIds = ((memberRows ?? []) as Array<{ organization_id: string }>).map(
    (r) => r.organization_id,
  );
  for (const orgId of orgIds) {
    await admin.from("organizations").delete().eq("id", orgId);
  }
  await admin.auth.admin.deleteUser(userId);
}

async function seedDummyContent(supabase: SupabaseClient, orgId: string): Promise<void> {
  // ダミー クライアント 3 件。 レビュアー が 「面談を予約」 する 相手 に する。
  const clients = [
    {
      organization_id: orgId,
      name: "テスト 太郎",
      name_kana: "テスト タロウ",
      status: "initial_meeting" as const,
      email: "test-taro@example.com",
    },
    {
      organization_id: orgId,
      name: "サンプル 花子",
      name_kana: "サンプル ハナコ",
      status: "job_matching" as const,
      email: "sample-hanako@example.com",
    },
    {
      organization_id: orgId,
      name: "デモ 一郎",
      name_kana: "デモ イチロウ",
      status: "in_screening" as const,
      email: "demo-ichiro@example.com",
    },
  ];
  const { error: cErr } = await supabase.from("client_records").insert(clients);
  if (cErr) console.warn(`! client_records seed failed: ${cErr.message}`);
  else console.log(`✓ client_records seeded (${clients.length})`);

  // ダミー 求人 2 件。 面談 と の 紐付け 検証 に 使う。
  const jobs = [
    {
      organization_id: orgId,
      company_name: "テスト 株式会社",
      position: "バックエンド エンジニア",
      employment_type: "正社員",
      location: "東京都渋谷区",
      status: "open" as const,
    },
    {
      organization_id: orgId,
      company_name: "サンプル 商事",
      position: "営業マネージャー",
      employment_type: "正社員",
      location: "大阪府大阪市",
      status: "open" as const,
    },
  ];
  const { error: jErr } = await supabase.from("job_postings").insert(jobs);
  if (jErr) console.warn(`! job_postings seed failed: ${jErr.message}`);
  else console.log(`✓ job_postings seeded (${jobs.length})`);
}

async function main() {
  console.log(`Setting up Google OAuth reviewer account: ${REVIEWER_EMAIL}`);

  // 1. 既存 ユーザー が 居 たら 削除 (冪等 実行 の ため)
  const existingId = await findExistingUserId(REVIEWER_EMAIL!);
  if (existingId) {
    console.log(`! Existing reviewer found (${existingId}), deleting first...`);
    await deleteExistingReviewer(existingId);
  }

  // 2. auth ユーザー 作成 (メール 確認 スキップ)
  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email: REVIEWER_EMAIL!,
    password: REVIEWER_PASSWORD!,
    email_confirm: true,
    user_metadata: { display_name: DISPLAY_NAME, account_type: "organization_member" },
  });
  if (userErr || !userRes?.user) {
    fail(`createUser failed: ${userErr?.message ?? "unknown"}`);
  }
  const userId = userRes.user.id;
  console.log(`✓ auth user created (${userId})`);

  // 3. 組織 作成
  const { data: orgRes, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: ORG_NAME })
    .select("id")
    .single();
  if (orgErr || !orgRes) fail(`org create failed: ${orgErr?.message ?? "unknown"}`);
  const orgId = orgRes.id;
  console.log(`✓ organization created (${orgId})`);

  // 4. organization_members に admin として紐付け
  const { error: memErr } = await admin.from("organization_members").insert({
    user_id: userId,
    organization_id: orgId,
    role: "admin",
  });
  if (memErr) fail(`member insert failed: ${memErr.message}`);
  console.log(`✓ member linked as admin`);

  // 5. profiles.display_name / account_type を セット
  //    trigger で profile 行 は 作成 済み の 想定。 update で 名前 を 上書き。
  const { error: profErr } = await admin
    .from("profiles")
    .update({ display_name: DISPLAY_NAME, account_type: "organization_member" })
    .eq("id", userId);
  if (profErr) console.warn(`! profile update failed: ${profErr.message}`);
  else console.log(`✓ profile display_name set to "${DISPLAY_NAME}"`);

  // 6. ダミー クライアント / 求人 を シード
  await seedDummyContent(admin, orgId);

  console.log("");
  console.log("════════════════════════════════════════════════");
  console.log("  Google OAuth Reviewer Account Ready");
  console.log("════════════════════════════════════════════════");
  console.log(`  Login URL: https://www.maira.pro/login`);
  console.log(`  Email:     ${REVIEWER_EMAIL}`);
  console.log(`  Password:  (env REVIEWER_PASSWORD の値がそのまま設定されました)`);
  console.log(`  Org:       ${ORG_NAME} (${orgId})`);
  console.log(`  Role:      admin`);
  console.log("");
  console.log("  次にレビュアーに共有する手順:");
  console.log("  1. 上記 URL でログイン");
  console.log("  2. 設定 → 連携・アドオン に移動");
  console.log("  3. 「Google Calendar / Meet を接続」をクリック");
  console.log("  4. 自分の Google アカウントで OAuth 認可 (Consent Screen 表示)");
  console.log("  5. Maira に戻り「求職者管理」→ シード済みクライアントを選択");
  console.log("  6. 「面談を予約」→ Provider = Google Meet を選択 → 日時入力 → 保存");
  console.log("  7. Google Meet URL が自動発行され、 レビュアーの Google Calendar に反映");
  console.log("════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
