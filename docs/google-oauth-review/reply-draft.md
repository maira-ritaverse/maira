# Google OAuth Verification — Reply Draft

Purpose: Reply to Google's compliance checklist email for Maira's OAuth verification of
Cloud Project `maira-prod` (Project Number: 765106046848).

**Before sending, fill in the placeholders marked `[FILL_IN: ...]`.**

---

## How to send

1. Open the original email in Gmail.
2. Click **Reply** (not Reply All — the sender is an automated address).
3. Paste the body below.
4. Verify all `[FILL_IN: ...]` placeholders are filled.
5. Double-check the YouTube link (unlisted, plays without sign-in).
6. Double-check the reviewer credentials work (Zoom cred hint: do a quick manual login).
7. Send.

---

## Reply body (paste this into Gmail)

```
Hello Google Third Party Data Safety Team,

Thank you for the detailed compliance checklist. Below is our response addressing each
criterion for the maira-prod project (Project Number: 765106046848).

---
1. SCOPE CONFIGURATION & JUSTIFICATION
---

- Least Privilege: We request only the minimum scopes required. Restricted scopes are
  NOT used (we removed drive.readonly on 2026-06-19 to avoid CASA requirement and to
  minimize data access).

- Requested scopes (all Sensitive, none Restricted):
    1. openid                                       - identify the user (google_sub)
    2. email                                        - identify the user (google_email)
    3. https://www.googleapis.com/auth/calendar.events
                                                    - create / update / delete calendar
                                                      events with attached Google Meet URLs

- Production-Ready: Yes. The Google Calendar/Meet integration is a live, user-facing
  feature in production, available to all organization members.

- Scope Justification:
    * openid + email: We identify the connected Google account so that (a) we can
      detect if a user accidentally connects a different Google account than intended,
      (b) we can associate created events with the correct source account, and
      (c) we display which Google account is connected in the Maira settings UI.
    * calendar.events: The core feature is scheduling recruitment interviews as
      Google Meet meetings. The recruiter (agent) creates an interview in Maira,
      Maira creates a corresponding Google Calendar event with a Meet URL attached,
      and the URL is shared with the candidate. Narrower scopes are not viable
      because we need to create, update (reschedule), and delete (cancel) events
      programmatically. We do NOT need or request calendar.readonly, calendar,
      calendar.freebusy, calendar.calendars, or calendar.settings.readonly.

- We are NOT an integration platform; the scope set above is fixed for all users.

---
2. DEMO VIDEO
---

- URL: [FILL_IN: YouTube unlisted URL, e.g. https://www.youtube.com/watch?v=XXXXXXXXXXX]
- Duration: [FILL_IN: e.g. 4:12]
- Accessibility: The video is public/unlisted and plays without sign-in.
- Consent Screen Visibility: In the video, "Show all services" is clicked before the
  Allow button is pressed, so every requested scope is fully expanded and readable.
- Scope Matching: The scopes shown in the video match those configured in Cloud Console
  exactly (openid, email, calendar.events).
- Scope Functionality: The video demonstrates every requested scope:
    * openid + email: Sign-in flow shows the reviewer's Google account being identified.
    * calendar.events: Create, update (time change), and delete operations are all
      demonstrated end-to-end.
- Source Account Impact: The video switches to https://calendar.google.com and shows
  the created event appearing, the update reflected in Google Calendar, and the
  deletion removing the event from Google Calendar (per your Source Account Impact
  requirement).
- Live App status: The publishing status remains "In Production." The demonstration
  is recorded against the production environment using a dedicated reviewer account
  that has no interaction with real users' data.

---
3. APP ACCESS & TESTING ENVIRONMENT
---

- Active Test Credentials (please treat as confidential):
    * Login URL: https://app.maira.pro/login
    * Email:     [FILL_IN: e.g. google-cloud-reviewer@maira.pro]
    * Password:  [FILL_IN: strong random password shared out-of-band if you prefer]

  The reviewer organization is pre-seeded with 3 dummy job seekers and 2 dummy job
  postings, so the Google integration can be tested immediately after login.

- Zero Authentication Blockers: We do NOT require phone number verification, credit
  card entry, or any other blocker beyond email/password. The reviewer account has
  been granted admin role in a dedicated organization.

- Clear Integration Access: Step-by-step navigation to the Google integration
  entry point:
    1. Sign in at https://app.maira.pro/login with the reviewer credentials above.
    2. Click the gear icon (top-right) to open Settings.
    3. Click "連携・アドオン" (Integrations). URL: /agency/settings/integrations
    4. Find the "Google Calendar / Meet" card.
    5. Click "Google Calendar / Meet を接続する" (Connect Google Calendar/Meet).
    6. Complete Google's OAuth consent flow with your Google account.
    7. After redirect, navigate to Clients (求職者管理) → pick any pre-seeded client.
    8. Click "面談を予約" (Schedule Meeting) in the top-right.
    9. Choose "Google Meet" as provider, set date/time, click Save.
   10. The event appears in your connected Google Calendar with a Meet URL.
   11. To disconnect: return to Integrations → click "切断" (Disconnect).

---
4. PRIVACY POLICY DISCLOSURES
---

Our privacy policy is at:
    https://app.maira.pro/privacy

Section 7-2 ("Google 連携 (Calendar / Meet)") contains the required disclosures.
For reviewer convenience, English translations of the key statements follow.
Sub-sections 7-2-1 through 7-2-6 map directly to your five disclosure requirements
plus the Limited Use compliance statement.

- Data Access (7-2-1): We access ONLY (a) the connecting user's Google account
  identifier (sub) and primary email address, and (b) metadata of Google Calendar
  events created by Maira on the user's behalf (title, start/end time, attendees,
  Meet URL, event ID). We do NOT access other calendar events, other calendars,
  Google Drive files, Gmail content, contacts, or Chat messages.

- Data Use (7-2-2): Google user data is used ONLY to (a) reflect interviews
  created in Maira as Google Calendar events with Meet URLs, (b) display the
  Meet URL inside Maira for sharing with the candidate, (c) synchronize
  reschedules and cancellations to Google Calendar, and (d) maintain the
  connection and detect if a different Google account is subsequently connected.
  We do NOT use Google data for advertising, behavioral profiling, credit
  scoring, or any purpose other than these user-facing features.

- Data Transfer (7-2-3): We do NOT share or sell Google user data to advertising
  networks, ad-tech, data brokers, credit scoring services, or any unrelated
  third party. Our infrastructure vendors (Vercel for hosting, Supabase for
  managed PostgreSQL) process this data only to provide their contracted
  hosting/database services under their Data Processing Agreements.

- Data Protection (7-2-4): OAuth access and refresh tokens are encrypted at rest
  using AES-256-GCM on the server. All Google API calls use TLS 1.2 or higher.
  Access is scoped to the connecting user and the recruitment agency member(s)
  they explicitly authorized, enforced via PostgreSQL Row Level Security. Direct
  database access is audited and limited to legitimate operational necessity.

- Data Retention & Deletion (7-2-5): OAuth tokens are deleted immediately on
  user-initiated disconnect (and Google's token revocation endpoint is called).
  Calendar event data on our side is deleted when the corresponding Maira
  meeting record is deleted. Full account deletion removes all associated data
  within 30 days. Users may request expedited deletion via support@maira.pro
  (7 business days SLA).

---
5. LIMITED USE COMPLIANCE
---

Prohibited Data Use: We confirm that Google user data is NOT used for
advertising, behavioral profiling, credit scoring, lending, or any other purpose
outside the user-facing features described above.

Prohibited Data Transfer: We confirm that Google user data is NOT sold or
transferred to data brokers, advertisers, or any third party for purposes
outside the user-facing features described above.

---
6. AI / ML MODEL TRAINING RESTRICTIONS
---

Prohibited AI/ML Model Training: We confirm that Google user data received via
the calendar.events scope is NOT used to develop, improve, or train AI/ML
models — neither ours nor any third party's — beyond the specific end user's
in-session personalized output.

Prohibited Transfer to Third-Party AI/ML Services: We do use Anthropic Claude
for other Maira features (career intake dialogue, resume drafting, job matching),
but Google Calendar data received via this integration is NEVER sent to any
LLM. Our contract with Anthropic includes zero data retention and no training
use of Maira's API traffic.

Limited Use Compliance Statement (also published at
https://app.maira.pro/privacy section 7-2-6):

"The use of raw or derived user data received from Google Workspace APIs by
Maira will adhere to the Google API Services User Data Policy, including the
Limited Use requirements."

---
7. PROHIBITED USE CASES
---

Maira's use of the calendar.events scope aligns with allowed use cases and does
NOT involve any prohibited use cases:
- Not used for cold-email or unsolicited commercial email
- Not used as a CDN
- Not used for interaction incentives on any Google surface

---
8. DATA PORTABILITY APIs
---

Not applicable. Maira does not request Data Portability API scopes.

---
9. CLOUD APPLICATION SECURITY ASSESSMENT (CASA)
---

Not applicable. We do NOT request any Restricted scopes. Our previous
drive.readonly scope was removed on 2026-06-19 (documented in the code at
`lib/integrations/google.ts` and in privacy policy 7-2). Only Sensitive
scopes are requested (openid, email, calendar.events).

---

Please let us know if any additional information is needed. We are happy to
provide code excerpts, DPAs with subprocessors, or additional demo footage on
request.

Best regards,
Maira Team (Revorise Inc.)
[FILL_IN: your name / title]
support@maira.pro
```

---

## 日本語 メモ(社内用)

**送信前チェック**:

- [ ] `[FILL_IN: ...]` を すべて 埋めた
- [ ] YouTube URL は unlisted かつ ログイン なしで 再生できる
- [ ] レビュアー credentials は 実際に ログイン できる (`scripts/create-google-reviewer.ts` 実行済)
- [ ] プラポリ の 7-2 セクション更新分 が 本番 (app.maira.pro) に デプロイ 済
- [ ] Cloud Console の scope 設定 が 上記 3 つ と 完全 一致 (drive.readonly 残ってない)
- [ ] 送信者は自動 address なので **Reply All ではなく Reply**

**構造の意図**:

- Google の 18 項目 checklist を すべて 順番 に カバー
- 「Not applicable」 と 断言 できる 項目 は 明確 に そう 書く (曖昧な回答 は 追加 質問 を 招く)
- Privacy Policy は URL + 該当 セクション 番号 を 明記 (レビュアー が 該当箇所 に 直行 できる)
- Limited Use 声明 は Google の 例文 を そのまま 使う (アレンジ 禁止)

**追加 で 問われ得る 質問**:

- Anthropic との DPA / zero data retention の 証拠 → 契約書 PDF or Anthropic の
  Trust Center URL を 送る
- Supabase / Vercel の DPA → 各社 の Trust Center URL
- コード レビュー を 求められる 可能性 → `lib/integrations/google.ts` を 送る
- スクショ で scope 一覧 を 求められる → Cloud Console → OAuth consent screen の
  スクショ 4-5 枚

**次に やる 手動作業**:

1. `scripts/create-google-reviewer.ts` を prod で 実行 (env セットして)
2. 実際に そのアカウントで ログイン してテスト
3. Google OAuth consent screen で 表示される app 名 / logo / privacy policy URL /
   terms URL が Cloud Console に 正しく 登録 されているか 確認
4. デモ動画を demo-script.md に沿って 撮影 → YouTube unlisted で up
5. 上記 返信文の `[FILL_IN: ...]` を 埋めて Gmail で 返信
