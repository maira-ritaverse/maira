# Zoom Marketplace 返信文 (2026-07-17)

## 目的

Jul 16 の "App Beta - Insufficient Evidence" 判定 を 受けて、 Beta を 諦めて
Published (公開) 認定 で 進めて もらう。 同時に、 domain 移行 に 伴い 過去 の
credentials で 案内 して いた `www.maira.pro/*` URL が LP に 変わって 到達
不能 に なった ため、 全 URL を `app.maira.pro/*` に 更新 して 伝える。

## 送信 メモ

- 送信 先: Zoom Marketplace の 現行 レビュー スレッド (Reply, not new thread)
- 差出人: `support@maira.pro` (もしくは Zoom アカウント の登録メール)
- 添付: 特に なし
- 送信 前 確認:
  - [ ] app.maira.pro/login で reviewer credentials で 実際 に ログイン できる
  - [ ] app.maira.pro/zoom-review が 200 で 表示 される
  - [ ] Zoom Marketplace 側 の OAuth Redirect URL / Event Notification URL が
        `app.maira.pro/api/integrations/zoom/callback` /
        `app.maira.pro/api/webhooks/zoom/recording` に なって いる
  - [ ] ZOOM_WEBHOOK_SECRET が Vercel 本番 に 登録 済 (完了)

---

## 返信 本文 (英語、 コピペ 用)

```
Hello,

Thank you for the Beta review feedback dated July 16.

At this time we would like to opt out of Beta and proceed with Published
(public marketplace listing) status instead, as noted in your reply
("your app can still qualify for publication in our Marketplace without
supporting evidence"). We understand the feature set is identical for
Published apps and will pursue the additional Beta evidence (SAST/DAST,
pentest, etc.) later.

While preparing this response we also completed a domain restructure on
our side: the marketing site now lives at maira.pro (WordPress), and the
application itself has been moved to a dedicated subdomain,
https://app.maira.pro. Please use the URLs below for all further
testing. The credentials and reviewer content are unchanged; only the
host has moved.

━━━ Updated Reviewer Credentials ━━━
    Login URL:    https://app.maira.pro/login
    Email:        maira-zoom-reviewer@maira.pro
    Password:     ti5CINOq1bH66q13STXK
    Reviewer guide (EN/JP): https://app.maira.pro/zoom-review

━━━ Updated Marketplace URLs ━━━
    OAuth Redirect URL:
      https://app.maira.pro/api/integrations/zoom/callback
    Event Notification Endpoint URL:
      https://app.maira.pro/api/webhooks/zoom/recording

Both URLs are already configured on the Marketplace listing on our
side. The endpoint responds to Zoom's URL validation challenge
correctly (returns plainToken / encryptedToken as specified in the
Zoom docs) and rejects unsigned requests with 401 bad_signature.

━━━ Test Flow (unchanged) ━━━
    1. Sign in at https://app.maira.pro/login with the credentials
       above.
    2. Go to Settings → Integrations
       (https://app.maira.pro/agency/settings/integrations)
    3. Click "Zoom アカウントを連携する" (Connect Zoom Account) and
       complete OAuth.
    4. Go to https://app.maira.pro/agency/clients and click any
       pre-seeded client row (Test Taro / Sample Hanako / Demo Ichiro)
       to open the client detail page.
    5. On the detail page, click the top-right "面談を予約" (Schedule
       Meeting) button, choose "Zoom" as location, fill title and
       date/time, click Save. Maira calls POST /users/me/meetings and
       stores the meeting URL in the client's meeting history.

The reviewer organization is pre-seeded with 3 clients, 2 jobs, 3 Zoom
meeting schedules, 2 referrals, and 1 interview log.

━━━ Regarding the earlier "no 'Schedule Meeting' visible" comment ━━━
The button lives on the client DETAIL page (step 4/5 above), not on
the client list or calendar page. This is intentional because every
Zoom meeting created via Maira is linked to a specific candidate for
later transcript ingestion. The public reviewer guide at
https://app.maira.pro/zoom-review documents this explicitly.

TLS 1.2+ is enforced for all app.maira.pro traffic (via Vercel).

Please retry the OAuth and meeting-creation flow with the updated URL.
Any issue, contact us at support@maira.pro (24-hour response, JST
business days).

Best regards,
Maira Team (Revorise Inc.)
```

---

## 日本語 メモ (社内 用)

- Beta 認定 の 要件 (SAST/DAST/pentest 要約) は 現時点 の 体制 で は 用意
  コスト が 高い ため、 Published (公開) 認定 に 切り替える 方針。 機能面
  で の 制限 は 無い。 将来 セキュリティ 監査 の 予算 が 取れ たら Beta
  再挑戦 する 選択肢 は 残る。
- 返信 スレッド に は 「Beta を opt out して Published に 進める」 旨 を
  明示 的 に 書く (Zoom 側 が 「Beta 参加 は 任意」 と 書いて くれた 通り)。
- 過去 に 送った www.maira.pro の URL は 全 て app.maira.pro に 差し替え。
  レビュアー が 過去 の URL を 保存 して いた 場合 に 備え、 「domain 移行
  した」 旨 を 冒頭 で 説明。
- credentials 自体 は 変更 なし (email/password は 同じ)。
