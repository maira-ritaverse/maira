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

Zoom Marketplace の 返信 フォーム は Unicode 罫線 (━) や 長文 で 400 Bad
Request を 返す こと が ある ため、 ASCII のみ + 簡潔 な 形 に した バージョン
を 掲載。

```
Hello,

Thank you for the Beta review feedback dated July 16.

We would like to opt out of Beta and proceed with Published (public
marketplace listing) status instead, as your reply notes that our app
can still qualify for publication without the additional evidence. The
feature set is identical for Published apps. We plan to pursue the
Beta evidence (SAST/DAST, pentest, etc.) at a later date.

While preparing this response we completed a domain restructure. The
marketing site now lives at maira.pro (WordPress), and the application
itself has moved to a dedicated subdomain: https://app.maira.pro.
Please use the URLs below for all further testing. Credentials and the
reviewer content are unchanged; only the host has moved.

Updated Reviewer Credentials
- Login URL: https://app.maira.pro/login
- Email: maira-zoom-reviewer@maira.pro
- Password: same as previously provided in this thread
- Reviewer guide (EN/JP): https://app.maira.pro/zoom-review

Updated Marketplace URLs
- OAuth Redirect URL: https://app.maira.pro/api/integrations/zoom/callback
- Event Notification URL: https://app.maira.pro/api/webhooks/zoom/recording

Both URLs are configured on the Marketplace listing on our side. The
endpoint responds to Zoom's URL validation challenge correctly and
rejects unsigned requests with 401.

Test Flow (unchanged)
1. Sign in at https://app.maira.pro/login with the credentials above.
2. Go to Settings then Integrations
   (https://app.maira.pro/agency/settings/integrations).
3. Click Connect Zoom Account and complete OAuth.
4. Go to https://app.maira.pro/agency/clients and click any pre-seeded
   client row (Test Taro, Sample Hanako, or Demo Ichiro).
5. On the client detail page, click the Schedule Meeting button in the
   top-right toolbar, choose Zoom as location, fill title and date
   time, and Save. Myaira calls POST /users/me/meetings and stores the
   meeting URL in the client's meeting history.

The reviewer organization is pre-seeded with 3 clients, 2 jobs, 3 Zoom
meeting schedules, 2 referrals, and 1 interview log.

Regarding the earlier "no Schedule Meeting visible" comment: the
button lives on the client DETAIL page (steps 4 and 5), not on the
client list or calendar page. This is intentional because every Zoom
meeting created via Myaira is linked to a specific candidate for later
transcript ingestion. The public reviewer guide at
https://app.maira.pro/zoom-review documents this explicitly.

TLS 1.2 or higher is enforced for all app.maira.pro traffic via
Vercel.

Please retry the OAuth and meeting-creation flow with the updated URL.
For any issue, contact us at support@maira.pro.

Best regards,
Myaira Team (Revorise Inc.)
```

## それでも Bad Request になる 場合 の 切り分け

1. **より 短い テスト 返信** を まず 投げて、 フォーム 自体 が 動く か 確認:

   ```
   Hello, opting out of Beta and proceeding with Published status.
   Domain moved from www.maira.pro to app.maira.pro. Full details in a
   follow-up reply. Thanks.
   ```

   → これ が 通れ ば「本文 の 何か」 が 原因。 通ら なけ れば Zoom フォーム 側
   の 問題 (Cookie / セッション 期限切れ / ブラウザ 拡張 で リクエスト が
   壊れて いる 等)。

2. **URL を 減らす**: Zoom の spam filter が URL 数 で 弾く こと が ある。 上記
   本文 に は URL が 8 本 ある。 半分 に 減らして リトライ。

3. **改行 コード**: エディタ から 貼る と CRLF が 混ざり 400 に なる こと が
   ある。 プレーン テキスト エディタ (VS Code, TextEdit プレーン モード) で
   一旦 貼り 直し して から Zoom に 貼る。

4. **ブラウザ を 変える** (Chrome → Safari or Firefox)。 Cookie / セッション
   衝突 の 切り分け。

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
