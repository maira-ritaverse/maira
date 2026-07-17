# Google OAuth Verification — Demo Video Script

Purpose: Demonstrate every requested scope in Maira's Google OAuth flow to Google's OAuth
Verification team, in a single 3–5 minute YouTube video (unlisted).

## Video meta

- **Duration**: 3–5 minutes (target 4 min)
- **Aspect**: 16:9 (screen recording, no camera)
- **Language**: English narration (Google reviewers). Japanese subtitles optional.
- **Upload**: YouTube unlisted, share link in the Google reply
- **Recording tool**: QuickTime / OBS / Loom — anything that captures full desktop screen at 1080p+
- **Environment**: Production (`https://app.maira.pro`) with the reviewer account seeded via
  `scripts/create-google-reviewer.ts`. Do NOT use staging (Google wants Live App demo, but
  new scope on staging is OK if quota risk is a concern — see the reply email).

## Requested scopes (must all be demonstrated)

1. `openid`
2. `email`
3. `https://www.googleapis.com/auth/calendar.events`

## Scene-by-scene script

### Scene 1: Introduction (0:00 – 0:20)

**Screen**: Maira app top (`https://app.maira.pro`)

**Narration (EN)**:

> "This is a demonstration video for Google OAuth verification of Maira,
> a recruitment agency SaaS. Maira is developed by Revorise Inc. and hosted at maira.pro
> (the app itself is served from app.maira.pro).
> The Google Cloud project is `maira-prod`. I will demonstrate all three requested OAuth
> scopes: `openid`, `email`, and `calendar.events`."

**Screen actions**:

- Show the Maira app top page briefly (2 sec)
- Cursor moves to the Login button

### Scene 2: Sign in with the reviewer account (0:20 – 0:40)

**Screen**: `/login` page

**Narration (EN)**:

> "I log in with the reviewer credentials that were provided in the review thread.
> This account has been pre-seeded with three dummy clients and two dummy job postings
> so that the Google integration can be tested end-to-end."

**Screen actions**:

- Enter email, password
- Click login → land on agent dashboard

### Scene 3: Navigate to Integrations (0:40 – 1:00)

**Screen**: Agent dashboard → Settings

**Narration (EN)**:

> "Google integration is configured from Settings → Integrations. The Google Calendar
> and Meet card is here at the top of the Calendar section."

**Screen actions**:

- Click the settings icon
- Click "連携・アドオン" (Integrations)
- URL becomes `/agency/settings/integrations`
- Show the "Google Calendar / Meet" card (not connected)

### Scene 4: Trigger OAuth flow (1:00 – 1:50)

**Screen**: Google connect card → Google OAuth consent screen

**Narration (EN)**:

> "I click 'Connect Google Calendar / Meet'. This redirects to Google's standard OAuth
> consent screen. I can see all three requested scopes. If needed, I click 'Show all
> services' to expand the scope list."

**Screen actions**:

- Click "Connect Google Calendar / Meet" button
- Wait for Google's OAuth screen to load
- **IMPORTANT**: Click "Show all services" if scopes are collapsed
- Highlight/annotate on video:
  - `openid` (via "Associate you with your personal info on Google")
  - `email` ("See your primary Google Account email address")
  - `calendar.events` ("See, edit, share, and permanently delete all the calendars you can access using Google Calendar")

_(Note: The exact wording of consent screen labels is controlled by Google. Verify
before recording that the reviewer sees your Cloud Console app name and logo.)_

### Scene 5: Grant consent (1:50 – 2:15)

**Screen**: Google consent screen → back to Maira

**Narration (EN)**:

> "I select my Google account and grant consent. Google redirects back to Maira,
> where I see a green banner confirming 'Google に接続しました' — Google connected."

**Screen actions**:

- Click "Allow" / "Continue" on Google consent screen
- Land back on `/agency/settings/integrations` with green banner
- Card now shows "接続済 (Connected)" state

### Scene 6: Demonstrate calendar.events — CREATE (2:15 – 3:00)

**Screen**: Client detail → Schedule Meeting dialog → Google Meet

**Narration (EN)**:

> "Now I demonstrate the calendar.events scope. I open a client detail page and click
> 'Schedule Meeting'. In the dialog I select 'Google Meet' as the provider, enter a
> title, date, and time, then click Save."

**Screen actions**:

- Click "求職者管理" (Clients) in sidebar
- Click "テスト 太郎" row → detail page opens
- Click "面談を予約" (Schedule Meeting) in the top-right toolbar
- Dialog opens
- Select "Google Meet" as provider
- Enter title: "OAuth Verification Test Meeting"
- Enter date/time: e.g., 3 days from now, 10:00
- Click "保存" (Save)
- Show the saved meeting with the auto-generated Google Meet URL

### Scene 7: Reflected in Google Calendar (3:00 – 3:30)

**Screen**: Open `https://calendar.google.com` in a NEW browser tab

**Narration (EN)**:

> "I switch to Google Calendar to confirm the event appears in the source account,
> as required by Google's Source Account Impact criterion. The event is here with
> the same title, time, and Google Meet URL."

**Screen actions**:

- Open `https://calendar.google.com` in a new tab
- Navigate to the date of the event
- Click the event to expand it
- Show:
  - The event title matches
  - The Google Meet URL is present
  - Time matches

### Scene 8: Demonstrate UPDATE (3:30 – 4:00)

**Screen**: Back to Maira → change meeting time → Google Calendar refreshes

**Narration (EN)**:

> "Next, I demonstrate an update. I return to Maira, change the meeting time by
> 30 minutes, and save. Refreshing Google Calendar shows the event has moved to the
> new time — the update is fully synchronized."

**Screen actions**:

- Return to Maira meeting view
- Click "編集" or drag the time slot
- Change to 10:30 (or a new value)
- Save
- Return to Google Calendar tab and refresh
- Show the event has moved

### Scene 9: Demonstrate DELETE (4:00 – 4:30)

**Screen**: Maira → delete meeting → Google Calendar refreshes (empty)

**Narration (EN)**:

> "Finally, I demonstrate deletion. From Maira I delete the meeting. Google Calendar,
> when refreshed, no longer shows the event, satisfying Google's Source Account
> Impact criterion for delete operations."

**Screen actions**:

- Click the meeting row in Maira
- Click "削除" (Delete)
- Confirm the ConfirmDialog
- Return to Google Calendar tab, refresh
- Show the event is no longer present

### Scene 10: Disconnect (4:30 – 5:00)

**Screen**: Settings → Integrations → Disconnect

**Narration (EN)**:

> "To close, I demonstrate disconnection. From Settings → Integrations, clicking
> 'Disconnect' revokes and deletes the OAuth tokens on our side, and calls Google's
> token revocation endpoint. This concludes the demonstration."

**Screen actions**:

- Navigate to `/agency/settings/integrations`
- Click "切断 (Disconnect)" on the Google card
- Confirm the disconnect dialog
- Card returns to "not connected" state
- End the video

## Pre-recording checklist

Before you press record:

- [ ] Reviewer account is seeded (`scripts/create-google-reviewer.ts` executed)
- [ ] The reviewer account has NOT already connected Google (else consent screen won't show)
- [ ] Your OAuth Cloud Console app has the correct app name, logo, homepage URL,
      privacy policy URL, and Terms URL — the consent screen will show these
- [ ] The Cloud Console scope list EXACTLY matches: openid, email, calendar.events
      (no leftover `drive.readonly` or other scopes)
- [ ] Test the entire flow end-to-end once WITHOUT recording, to catch errors
- [ ] Close all unrelated browser tabs / apps
- [ ] Increase font size or record at 1080p so annotations are readable
- [ ] Prepare Google Calendar tab BEFORE Scene 7 so it loads instantly on switch

## After recording

- [ ] Trim the intro / outro if needed (aim for < 5 min total)
- [ ] Upload to YouTube as **Unlisted**
- [ ] Copy the URL
- [ ] Paste into the reply email (see `reply-draft.md`)

## Common review reasons for rejection

Avoid these by re-recording if any of them applies:

1. **Consent screen not fully expanded** — Google will reject if scope details are hidden.
   Make sure "Show all services" is expanded before "Allow" is clicked.
2. **Source account impact not shown** — For each of create/update/delete, the video MUST
   show the change in the user's Google Calendar (Scene 7, 8, 9).
3. **Scope wording mismatch** — What you show in the video must match what your Cloud
   Console app requests. If you add or remove a scope after recording, re-record.
4. **Silent scopes** — If a scope is requested but never demonstrated, it will be rejected.
   `openid` and `email` are demonstrated implicitly (the app knows who signed in),
   but if the reviewer is strict, add a "Signed in as: [reviewer email]" annotation.
5. **Wrong environment** — Recording must be against production (`app.maira.pro`) with the
   verified Cloud Console client ID.

---

## 日本語 サマリ(社内用)

デモ動画は 4 分 前後 で 3 つの scope をすべて demonstrate する:

1. Login → Settings → Integrations → Google 接続 ボタン
2. Google OAuth 同意画面(scope 3 つ を 「Show all services」で 全表示 させる)
3. 承認 → Maira に戻る → 「接続済」表示
4. クライアント詳細 → 面談を予約 → Google Meet 選択 → 保存
5. `calendar.google.com` で イベント作成を確認 (create)
6. Maira で時刻編集 → Google Calendar で反映確認 (update)
7. Maira で削除 → Google Calendar で消滅確認 (delete)
8. 切断ボタン → OAuth トークン破棄 (revoke)

**Google が REJECT する典型パターン**:

- 同意画面で scope が展開されていない → 「Show all services」を 必ず クリック
- create / update / delete の 各 操作 で、 Google Calendar 側 の 実際の反映 が 映って ない
- 撮影環境が Cloud Console 設定 と 一致 して いない (app 名、 scope、 redirect URL)

---

## English section header (paste in YouTube description)

```
Maira Google OAuth Verification Demo
- App: Maira (recruitment agency SaaS by Revorise Inc.)
- Project: maira-prod (Project Number: 765106046848)
- Scopes demonstrated: openid, email, https://www.googleapis.com/auth/calendar.events
- Feature: Creating Google Calendar events with Google Meet URLs for candidate interviews
```
