# ドメイン 移行 手作業 チェックリスト (2026-07)

`maira.pro` の 運用 が「Xserver 上 の WordPress LP + Vercel 上 の Next.js アプリ」の
二本 立て に なった 際、 コード 側 の URL 統一 (このコミット) だけ で は 完結 しない
運用 タスク を まとめる。 順番 に 消化 する と 招待 メール 不達 が 解消 される 見込み。

## ドメイン / DNS

- [ ] レジストラ (お名前.com など) の maira.pro の ネームサーバー を
      **Xserver の `ns1〜5.xserver.jp` の 5 本 のみ** に 統一 する。
      Vercel の `ns1/ns2.vercel-dns.com` は 削除。
      → `dig NS maira.pro` の 結果 が Xserver だけ に なる まで 反映 待ち (数時間)。
- [ ] Vercel Dashboard → maira プロジェクト → Settings → Domains で
      `maira.pro` と `www.maira.pro` を **Remove**。 `app.maira.pro` のみ 残す。
- [ ] Xserver DNS に 以下 の レコード が 揃って いる か 確認 (すでに 入って いる
      はず の もの):
  - `A maira.pro → Xserver の IP`
  - `A www.maira.pro → Xserver の IP` (301 で maira.pro に redirect)
  - `CNAME app.maira.pro → cname.vercel-dns.com`
  - `MX maira.pro → mx1.improvmx.com (10), mx2.improvmx.com (20)`
  - `TXT maira.pro v=spf1 +a:sv17111.xserver.jp +mx include:spf.sender.xserver.jp include:spf.improvmx.com ~all`
    - **ImprovMX の include が 抜けて いる 場合 は 追加** (受信 転送 が SPF 落ち する 可能性)
  - `TXT resend._domainkey.maira.pro (Resend の DKIM key)` (既存)
  - `MX send.maira.pro → feedback-smtp.ap-northeast-1.amazonses.com`
  - `TXT send.maira.pro v=spf1 include:amazonses.com ~all`
  - `TXT _dmarc.maira.pro v=DMARC1; p=none;` (既存、 p=none で 監視 のみ)

## Supabase Auth (最重要 — verify email 不達 の 直接 原因)

- [ ] Supabase Dashboard (**maira-prod** = `xxatkimjfiaidxfuglae`) →
      Authentication → URL Configuration:
  - **Site URL**: `https://app.maira.pro` に 変更 (旧 `https://www.maira.pro`)
  - **Redirect URLs**: `https://app.maira.pro/**` を 追加。 旧 www / root の
    entry は 削除
- [ ] 変更 後、 `/signup` で 自分 の メール で 新規 登録 して 確認 メール が
      `app.maira.pro/auth/confirm?...` に 飛ぶ こと を 確認

## Vercel 環境変数

- [ ] `NEXT_PUBLIC_SITE_URL=https://app.maira.pro` (現状 の 値 と 一致 する か 再確認)
- [ ] `EMAIL_FROM=noreply@maira.pro` (現状 OK)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` = **現状 空** → Google Cloud
      Console から 取得 して 再登録
- [ ] `CONTACT_NOTIFICATION_FROM=onboarding@resend.dev` → `noreply@maira.pro`
      に 変更 (現状 は Resend サンドボックス で オーナー 宛 のみ に しか 届かない)
- [ ] `ZOOM_WEBHOOK_SECRET` を 追加 (Zoom Cloud Recording を 使う 場合)

## Google Cloud Console / Zoom Marketplace

- [ ] Google OAuth Client の Authorized redirect URIs:
  - `https://app.maira.pro/api/oauth/google/callback` を 追加
  - `https://app.maira.pro/api/integrations/google/callback` を 追加
  - 旧 www.maira.pro / vercel.app の redirect URI を 削除
- [ ] Zoom Marketplace App の Redirect URL / Event Notification URL:
  - `https://app.maira.pro/api/integrations/zoom/callback`
  - `https://app.maira.pro/api/webhooks/zoom/recording`

## 検証 (すべて 完了 後)

1. `dig NS maira.pro` — Xserver だけ が 返る
2. `dig TXT resend._domainkey.maira.pro` — DKIM が 引ける
3. `curl -sI https://app.maira.pro/` — 200
4. `/agency/members` から 自分 の メール で 招待 発行 → Gmail の 迷惑 メール で は なく 通常 の 受信箱 に 届く
5. `/agency/clients` から 求職者 招待 → 同様
6. `/signup` から 新規 登録 → Supabase の 確認 メール の リンク が `app.maira.pro` に 飛ぶ
7. Resend Dashboard の 送信 ログ で `bounced` `soft_bounce` が 減って いる

## トラブル シューティング

- **招待 メール が まだ 迷惑 メール 判定 される**
  - `_dmarc.maira.pro` を `v=DMARC1; p=quarantine; pct=10;` に して 数日 様子 見 →
    問題 なけ れば `p=quarantine` (100%) に 強化。 これ で Gmail の 評価 が 上がる
- **Supabase の 確認 メール が 「maira.pro」 に 飛ぶ**
  - Supabase Dashboard の Site URL 変更 が 未反映。 上記 「Supabase Auth」 の
    セクション を 再度 確認
- **Google OAuth で redirect_uri_mismatch**
  - Google Cloud Console の redirect URI 追加 忘れ。 完全 一致 (末尾 `/` の 有無、
    大文字 小文字 も) が 必要
