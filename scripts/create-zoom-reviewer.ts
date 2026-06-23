/**
 * Zoom Marketplace の 審査 員 用 reviewer アカウント を 本番 Supabase
 * (maira-prod) に 作成 する スクリプト。
 *
 * 実行 例:
 *   SUPABASE_URL="https://xxatkimjfiaidxfuglae.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   REVIEWER_EMAIL="zoom.maira.review@gmail.com" \
 *   REVIEWER_PASSWORD="ti5CINOq1bH66q13STXK" \
 *   pnpm exec tsx scripts/create-zoom-reviewer.ts
 *
 * 動作:
 *   1. auth.admin.createUser でメール確認スキップで作成
 *   2. organizations に "Zoom Marketplace Reviewer" 組織を作成
 *   3. organization_members に admin として紐付け
 *   4. profiles の display_name を "Zoom Reviewer" にセット
 *   5. ダミークライアント 3 件 + ダミー求人 2 件をシード
 *
 * 既存ユーザーが居ても先に削除して作り直す (= 冪等)。
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL;
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD;
const ORG_NAME = process.env.REVIEWER_ORG_NAME ?? "Zoom Marketplace Reviewer";
const DISPLAY_NAME = process.env.REVIEWER_DISPLAY_NAME ?? "Zoom Reviewer";

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
  // listUsers で メアド 検索 (page 1, perPage 1000 で 全件 想定)
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  type AuthUser = { id: string; email?: string | null };
  const users = (data?.users ?? []) as AuthUser[];
  const found = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}

async function deleteExistingReviewer(userId: string): Promise<void> {
  // organization_members を 削除 → organizations が 残った 場合 も 削除
  const { data: members } = await admin
    .from("organization_members")
    .select("id, organization_id")
    .eq("user_id", userId);
  const orgIds = (members ?? []).map((m: { organization_id: string }) => m.organization_id);

  if (members && members.length > 0) {
    await admin.from("organization_members").delete().eq("user_id", userId);
  }
  for (const orgId of orgIds) {
    await admin.from("organizations").delete().eq("id", orgId).eq("name", ORG_NAME);
  }
  // auth.users 削除 (profiles は ON DELETE CASCADE 想定)
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) throw new Error(`deleteUser failed: ${delErr.message}`);
  console.log(`✓ Deleted existing user: ${userId}`);
}

async function main() {
  console.log(`Setting up reviewer account: ${REVIEWER_EMAIL}`);
  console.log(`Target: ${SUPABASE_URL}`);

  // 既存 ユーザー が あれば 削除 (= 冪等)
  const existingId = await findExistingUserId(REVIEWER_EMAIL!);
  if (existingId) {
    console.log(`! Existing user found, deleting for clean re-create...`);
    await deleteExistingReviewer(existingId);
  }

  // 1. auth.users 作成 (メール確認 スキップ)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: REVIEWER_EMAIL!,
    password: REVIEWER_PASSWORD!,
    email_confirm: true,
    user_metadata: { display_name: DISPLAY_NAME, account_type: "organization_member" },
  });
  if (createErr || !created.user) {
    fail(`createUser failed: ${createErr?.message ?? "no user returned"}`);
  }
  const userId = created.user.id;
  console.log(`✓ auth.users created: ${userId}`);

  // 2. profiles を 更新 (signup trigger で 既に 1 行 入って いる 想定 → upsert)
  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      display_name: DISPLAY_NAME,
      account_type: "organization_member",
    },
    { onConflict: "id" },
  );
  if (profErr) fail(`profiles upsert failed: ${profErr.message}`);
  console.log(`✓ profiles updated`);

  // 3. organization 作成
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: ORG_NAME })
    .select("id")
    .single();
  if (orgErr || !org) fail(`organization insert failed: ${orgErr?.message}`);
  const orgId = (org as { id: string }).id;
  console.log(`✓ organization created: ${orgId}`);

  // 4. organization_members に admin として 紐付け
  const { data: member, error: memErr } = await admin
    .from("organization_members")
    .insert({
      organization_id: orgId,
      user_id: userId,
      role: "admin",
    })
    .select("id")
    .single();
  if (memErr || !member) fail(`organization_members insert failed: ${memErr?.message}`);
  console.log(`✓ organization_members admin row created`);

  // 5. ダミー クライアント を 3 件 + 求人 を 2 件 シード
  // status は client_records_status_check CHECK 制約 に 一致 する 値:
  // initial_meeting / job_matching / in_screening / offer / completed / declined
  const dummyClients = [
    { name: "テスト 太郎", email: "test-taro@example.com", status: "initial_meeting" as const },
    { name: "サンプル 花子", email: "sample-hanako@example.com", status: "job_matching" as const },
    { name: "デモ 一郎", email: "demo-ichiro@example.com", status: "initial_meeting" as const },
  ];
  const { error: clientErr } = await admin.from("client_records").insert(
    dummyClients.map((c) => ({
      organization_id: orgId,
      name: c.name,
      email: c.email,
      status: c.status,
      email_distribution_enabled: false, // 誤配信 防止
    })),
  );
  if (clientErr) console.warn(`! client seed failed: ${clientErr.message}`);
  else console.log(`✓ dummy clients seeded (${dummyClients.length})`);

  const dummyJobs = [
    {
      company_name: "サンプル 株式会社",
      position: "ソフトウェア エンジニア",
      status: "open" as const,
    },
    {
      company_name: "テスト 商事",
      position: "営業 マネージャー",
      status: "open" as const,
    },
  ];
  const { error: jobErr } = await admin.from("job_postings").insert(
    dummyJobs.map((j) => ({
      organization_id: orgId,
      ...j,
    })),
  );
  if (jobErr) console.warn(`! job seed failed: ${jobErr.message}`);
  else console.log(`✓ dummy jobs seeded (${dummyJobs.length})`);

  console.log("");
  console.log("════════════════════════════════════════════════");
  console.log("  Reviewer Account Ready");
  console.log("════════════════════════════════════════════════");
  console.log(`  Login URL: https://www.maira.pro/login`);
  console.log(`  Email:     ${REVIEWER_EMAIL}`);
  console.log(`  Password:  ${REVIEWER_PASSWORD}`);
  console.log(`  Org:       ${ORG_NAME} (${orgId})`);
  console.log(`  Role:      admin`);
  console.log("════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
