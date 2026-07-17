/**
 * Zoom Marketplace の 審査 員 用 reviewer アカウント を 本番 Supabase
 * (maira-prod) に 作成 する スクリプト。
 *
 * 実行 例(2026-06-23 に Zoom に共有した認証情報でシードする場合):
 *   FIELD_ENCRYPTION_KEYS='{"v1":"<base64>"}' \
 *   FIELD_ENCRYPTION_CURRENT_VERSION="v1" \
 *   SUPABASE_URL="https://xxatkimjfiaidxfuglae.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   pnpm exec tsx scripts/create-zoom-reviewer.ts
 *
 * REVIEWER_EMAIL / REVIEWER_PASSWORD 未指定時は、 Zoom Marketplace の
 * レビュースレッドに提示した以下の認証情報を既定値として使う。
 * ローカル / dev で試すときだけ env で上書きすること。
 *
 * 動作:
 *   1. auth.admin.createUser でメール確認スキップで作成
 *   2. organizations に "Zoom Marketplace Reviewer" 組織を作成
 *   3. organization_members に admin として紐付け
 *   4. profiles の display_name を "Zoom Reviewer" にセット
 *   5. ダミークライアント 3 件 + ダミー求人 2 件をシード
 *   6. LINE 会話タグ 3 種を作成し、ダミー LINE user と紐付け
 *   7. 過去/未来の Zoom 面談 (meeting_schedules) 3 件をシード
 *   8. 紹介 (referrals) 2 件 + 面接 (interviews) 1 件をシード
 *
 * 既存ユーザーが居ても先に削除して作り直す (= 冪等)。
 * FIELD_ENCRYPTION_KEYS が未設定なら暗号化フィールドは null のままスキップ。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 暗号化ユーティリティ(FIELD_ENCRYPTION_KEYS がセットされていれば使う)
// 動的 import にして、鍵未設定でもスクリプト全体が落ちないようにする
let encryptField: ((v: string) => Promise<string | null>) | null = null;
try {
  if (process.env.FIELD_ENCRYPTION_KEYS && process.env.FIELD_ENCRYPTION_CURRENT_VERSION) {
    const mod = await import("../lib/crypto/field-encryption");
    encryptField = mod.encryptField as (v: string) => Promise<string | null>;
  }
} catch (err) {
  console.warn(
    `! field-encryption import failed, encrypted fields will be null: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// CLAUDE.md ルール:.env や本番シークレットをコードに含めない。
// REVIEWER_EMAIL / REVIEWER_PASSWORD は env 必須。 既定値を持たせない。
// 実行例のメール/パスワードは README / docs 側にも書かない(Zoom Marketplace の
// レビュースレッドで直接共有する)。
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
  //   organizations 削除で client_records / job_postings / referrals /
  //   line_conversation_tags / meeting_schedules / interviews は
  //   ON DELETE CASCADE で全部消える(各テーブル定義でそう宣言済み)。
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
  console.log(`✓ Deleted existing user + org cascade: ${userId}`);
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
  const { data: insertedJobs, error: jobErr } = await admin
    .from("job_postings")
    .insert(dummyJobs.map((j) => ({ organization_id: orgId, ...j })))
    .select("id, company_name");
  if (jobErr) console.warn(`! job seed failed: ${jobErr.message}`);
  else console.log(`✓ dummy jobs seeded (${dummyJobs.length})`);

  // 挿入した client / job の ID を再取得(referrals / meetings で使う)
  const { data: clientRows } = await admin
    .from("client_records")
    .select("id, name")
    .eq("organization_id", orgId);
  const clients = (clientRows ?? []) as Array<{ id: string; name: string }>;
  const jobs = (insertedJobs ?? []) as Array<{ id: string; company_name: string }>;

  // 6. LINE 会話タグ 3 種 + ダミー LINE user + タグ紐付け
  //   Zoom 連携のテストには LINE は必須ではないが、Maira の UI で「タグが
  //   ついた友だち一覧」など複数の画面が確認できるようにする。
  await seedLineTagsAndAssignments(admin, orgId, clients);

  // 7. Zoom 面談 (meeting_schedules) 3 件:過去 done / 今週予定 / 来週予定
  //   Zoom 会議の join URL は placeholder(実際にクリックしても本物のZoom
  //   会議は無いが、UI 表示・履歴の確認が可能)
  await seedMeetingSchedules(admin, orgId, userId, clients);

  // 8. 紹介 (referrals) と 面接 (interviews) をシード
  //    - 求職者を求人に紐付けた進捗管理
  //    - 面接 done ログ 1 件
  await seedReferralsAndInterviews(admin, orgId, userId, clients, jobs);

  console.log("");
  console.log("════════════════════════════════════════════════");
  console.log("  Reviewer Account Ready");
  console.log("════════════════════════════════════════════════");
  console.log(`  Login URL: https://app.maira.pro/login`);
  console.log(`  Email:     ${REVIEWER_EMAIL}`);
  // パスワードは実行者が env で渡した値と同一なので画面上には出さない
  //(スクショ・ターミナル録画から漏れるリスクを下げる)。 実行者は
  // Zoom Marketplace のレビュースレッドや 1Password 等の secure channel で
  // 認証情報を管理する前提。
  console.log(`  Password:  (env REVIEWER_PASSWORD の値がそのまま設定されました)`);
  console.log(`  Org:       ${ORG_NAME} (${orgId})`);
  console.log(`  Role:      admin`);
  console.log("════════════════════════════════════════════════");
}

// ────────────────────────────────────────────────────────────────
// ヘルパー:LINE タグ + ダミー友だちを シードする
// ────────────────────────────────────────────────────────────────

async function seedLineTagsAndAssignments(
  admin: SupabaseClient,
  orgId: string,
  clients: Array<{ id: string; name: string }>,
): Promise<void> {
  const tagDefs = [
    { name: "面談前", color: "#93c5fd" },
    { name: "求人検討中", color: "#fbbf24" },
    { name: "内定", color: "#86efac" },
  ];
  const { data: insertedTags, error: tagErr } = await admin
    .from("line_conversation_tags")
    .insert(tagDefs.map((t) => ({ organization_id: orgId, ...t })))
    .select("id, name");
  if (tagErr) {
    console.warn(`! tag seed failed: ${tagErr.message}`);
    return;
  }
  const tags = (insertedTags ?? []) as Array<{ id: string; name: string }>;
  console.log(`✓ LINE conversation tags seeded (${tags.length})`);

  // ダミー LINE user と client の紐付け(line_user_links)
  //   実際の LINE 連携は不要。 UI で「タグが付いた友だち」を出すために
  //   placeholder の line_user_id (U + 32 hex) を作る。
  const linkRows = clients.slice(0, tags.length).map((c, i) => ({
    organization_id: orgId,
    line_user_id: `U${"0".repeat(31)}${i + 1}`, // placeholder(実 Zoom / LINE には影響しない)
    client_record_id: c.id,
    display_name: c.name,
    link_method: "manual" as const,
    linked_at: new Date().toISOString(),
  }));
  const { error: linkErr } = await admin.from("line_user_links").insert(linkRows);
  if (linkErr) {
    console.warn(`! line_user_links seed failed: ${linkErr.message}`);
    return;
  }
  console.log(`✓ dummy line_user_links seeded (${linkRows.length})`);

  // タグを friend に紐付け(1:1 対応で各友だちに 1 タグ)
  const assignmentRows = linkRows.map((l, i) => ({
    organization_id: orgId,
    line_user_id: l.line_user_id,
    tag_id: tags[i % tags.length].id,
  }));
  const { error: assignErr } = await admin
    .from("line_conversation_tag_assignments")
    .insert(assignmentRows);
  if (assignErr) console.warn(`! tag assignment failed: ${assignErr.message}`);
  else console.log(`✓ tag assignments seeded (${assignmentRows.length})`);
}

// ────────────────────────────────────────────────────────────────
// ヘルパー:Zoom 面談 (meeting_schedules) をシード
// ────────────────────────────────────────────────────────────────

async function seedMeetingSchedules(
  admin: SupabaseClient,
  orgId: string,
  hostUserId: string,
  clients: Array<{ id: string; name: string }>,
): Promise<void> {
  if (clients.length === 0) return;
  const now = new Date();
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400 * 1000);

  const meetings = [
    // 過去(録画取込済み想定):3 日前
    {
      client: clients[0],
      offsetDays: -3,
      status: "completed",
      title: `[初回面談] ${clients[0].name} さん`,
      agenda: "初回キャリア相談。現職の悩みと今後のキャリア方向性をヒアリング。",
    },
    // 今週(あと 2 日後)
    ...(clients.length > 1
      ? [
          {
            client: clients[1],
            offsetDays: 2,
            status: "scheduled",
            title: `[求人紹介] ${clients[1].name} さん`,
            agenda: "サンプル株式会社 / テスト商事 の求人詳細を紹介する予定。",
          },
        ]
      : []),
    // 来週(7 日後)
    ...(clients.length > 2
      ? [
          {
            client: clients[2],
            offsetDays: 7,
            status: "scheduled",
            title: `[面接対策] ${clients[2].name} さん`,
            agenda: "書類選考通過後の 1 次面接に向けた対策セッション。",
          },
        ]
      : []),
  ];

  const rows = await Promise.all(
    meetings.map(async (m) => {
      const starts = daysFromNow(m.offsetDays);
      const ends = new Date(starts.getTime() + 3600 * 1000); // 1 時間枠
      const encryptedAgenda = encryptField ? await encryptField(m.agenda) : null;
      return {
        organization_id: orgId,
        host_user_id: hostUserId,
        client_record_id: m.client.id,
        provider: "zoom" as const,
        // 実 Zoom 会議 ID ではない placeholder(表示用)
        external_meeting_id: `dummy-${Math.floor(Math.random() * 1e9)}`,
        join_url: "https://zoom.us/j/reviewer-placeholder",
        host_url: "https://zoom.us/s/reviewer-placeholder",
        title: m.title,
        encrypted_agenda: encryptedAgenda,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        timezone: "Asia/Tokyo",
        status: m.status,
      };
    }),
  );
  const { error } = await admin.from("meeting_schedules").insert(rows);
  if (error) console.warn(`! meeting_schedules seed failed: ${error.message}`);
  else console.log(`✓ meeting_schedules seeded (${rows.length})`);
}

// ────────────────────────────────────────────────────────────────
// ヘルパー:紹介 (referrals) と 面接 (interviews) をシード
// ────────────────────────────────────────────────────────────────

async function seedReferralsAndInterviews(
  admin: SupabaseClient,
  orgId: string,
  hostUserId: string,
  clients: Array<{ id: string; name: string }>,
  jobs: Array<{ id: string; company_name: string }>,
): Promise<void> {
  if (clients.length === 0 || jobs.length === 0) return;

  // 紹介 2 件:
  //   - clients[0] → jobs[0]:面接 status(進行中)
  //   - clients[1] → jobs[1]:internal_screening(書類選考中)
  const refs = [
    {
      client_record_id: clients[0].id,
      job_posting_id: jobs[0].id,
      status: "interview" as const,
      notes: "初回面談で意欲が高く、スキルセットもマッチ。 一次面接を控える。",
    },
    ...(clients.length > 1 && jobs.length > 1
      ? [
          {
            client_record_id: clients[1].id,
            job_posting_id: jobs[1].id,
            status: "screening" as const,
            notes: "職務経歴書を提出済み。 書類選考結果待ち。",
          },
        ]
      : []),
  ];
  const { data: insertedRefs, error: refErr } = await admin
    .from("referrals")
    .insert(refs.map((r) => ({ organization_id: orgId, ...r })))
    .select("id, client_record_id");
  if (refErr) {
    console.warn(`! referral seed failed: ${refErr.message}`);
    return;
  }
  const referrals = (insertedRefs ?? []) as Array<{ id: string; client_record_id: string }>;
  console.log(`✓ referrals seeded (${referrals.length})`);

  // 面接 1 件:1 件目の referral に対する 1 次面接 (done)
  if (referrals.length > 0) {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 86400 * 1000);
    const { error: intErr } = await admin.from("interviews").insert({
      organization_id: orgId,
      referral_id: referrals[0].id,
      kind: "first",
      scheduled_at: oneWeekAgo.toISOString(),
      result: "done",
      notes: "1次面接完了。 印象は好感触。 2次面接の日程調整中。",
      created_by_user_id: hostUserId,
    });
    if (intErr) console.warn(`! interview seed failed: ${intErr.message}`);
    else console.log(`✓ interviews seeded (1)`);
  }
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
