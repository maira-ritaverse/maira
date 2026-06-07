-- ============================================
-- 開示フロー Phase 6(P1):二段階解除の状態追加 + 関連列 + 組織設定
--
-- 背景:
--   従来の revoke は「本人が即時 linked → revoked に遷移」する作りだったが、
--   方針転換で「本人が解除を申請(linked → revoke_requested、開示は継続)
--   → エージェント承認 or 猶予期間タイムアウトで revoked に確定」の二段階に
--   する。本マイグレーションは状態と列の追加のみのスキーマ層の土台。
--   申請 RPC(P3)・承認 RPC(P4)・組織設定 UI(P5)・確定 cron(P6)は
--   別 Phase で実装する。
--
-- 撤回権の安全弁:
--   開示経路の RLS / RPC に「期限経過後の revoke_requested を遮断する」
--   時刻条件は別マイグレーション(20260607000011)で組み込む。これにより
--   cron が無くても期限超過で開示が自動で止まる設計とする。
--
-- 列の意味:
--   revoke_requested_at  :本人が解除を申請した時刻
--   revoke_deadline      :猶予期限。申請時に
--                         (now() + organizations.revoke_grace_days) を打刻し、
--                         以後は固定する(後から組織設定の grace_days が
--                         変更されても、進行中の申請には影響させない設計。
--                         実装は P3 の申請 RPC で行う)
--   revoke_confirmed_via :確定経路の監査用
--                         ('agency_approved' / 'timeout')。revoked 確定時に打刻
--                         (実装は P4 の承認 RPC と P6 の確定 cron で行う)
--
-- P2 ではまだこれらの列を打刻する RPC は無く、既存 revoke_client_link は
-- 引き続き linked → revoked へ即時遷移する(本 Phase では挙動を変えない。
-- P3 で申請 RPC に置き換える)。
-- ============================================

-- ============================================
-- 1. client_records.link_status の CHECK 制約を差し替え
--
-- 既存制約名は CREATE TABLE 時に Postgres が自動命名:
--   client_records_link_status_check
-- 既存マイグレーションファイル(20260531000001)は編集禁止ルールのため、
-- 本ファイルで drop → add で制約を差し替える。
-- ============================================
alter table public.client_records
  drop constraint if exists client_records_link_status_check;

alter table public.client_records
  add constraint client_records_link_status_check
    check (link_status in (
      'unlinked', 'invited', 'linked', 'revoke_requested', 'revoked'
    ));

comment on column public.client_records.link_status is
  'unlinked/invited/linked/revoke_requested/revoked';

-- ============================================
-- 2. 二段階解除用の列を追加(全て nullable)
--
-- 既存行は申請履歴を持たないので null のまま。
-- revoke_confirmed_via は CHECK 制約付きで「agency_approved / timeout」のみ。
-- ============================================
alter table public.client_records
  add column if not exists revoke_requested_at timestamptz,
  add column if not exists revoke_deadline timestamptz,
  add column if not exists revoke_confirmed_via text
    check (revoke_confirmed_via in ('agency_approved', 'timeout'));

comment on column public.client_records.revoke_requested_at is
  '二段階解除:本人が解除を申請した時刻(linked → revoke_requested 遷移時に打刻)';
comment on column public.client_records.revoke_deadline is
  '二段階解除:猶予期限。申請時に固定打刻し以後不変。'
  '期限超過後の開示遮断は RLS / RPC 側の時刻条件で実現する(cron 不要の安全弁)';
comment on column public.client_records.revoke_confirmed_via is
  '二段階解除:revoked 確定経路の監査値(agency_approved / timeout)';

-- ============================================
-- 3. organizations に猶予日数の組織設定列を追加
--
-- 範囲 7〜90 日、default 14。組織ごとに異なる値を持てる。
-- 申請時に revoke_deadline = now() + (grace_days * interval '1 day') として
-- 固定打刻するため、後から組織が値を変更しても進行中の申請には影響しない
-- (実装は P3 の申請 RPC で行う)。
-- ============================================
alter table public.organizations
  add column if not exists revoke_grace_days integer not null default 14
    check (revoke_grace_days between 7 and 90);

comment on column public.organizations.revoke_grace_days is
  '二段階解除の猶予日数(7〜90、default 14)。申請時に '
  'client_records.revoke_deadline へ反映され固定される。'
  '後から値を変更しても進行中の申請には影響しない設計';
