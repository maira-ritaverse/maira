-- =====================================================================
-- line_broadcasts に リトライ 追跡 用 の 列 を 追加
--
-- 監査 Batch 2 の 「MAX_PER_TICK=5 の 制限 + 一時 障害 で 落ち たら 復旧
-- 手段 が 無い」 問題 の 修正。 tick 内 で 一時 障害 (LINE API の 5xx など)
-- に 当たった 場合 は status='queued' の まま retry_count を 増やし、
-- 指数 バック オフ で 次回 tick に 拾い 直す 運用 に する。
--
-- 追加 列:
--   ・retry_count (int, default 0)         - 現在 まで の 再試行 回数
--   ・next_retry_at (timestamptz null)     - この 時刻 以降 に 拾い 直す
--   ・last_error_at (timestamptz null)     - 最後 に エラー が 発生 した 時刻
--
-- 上限 に 達した 場合 (現状 3 回) は status='failed' に 遷移 して 手動 判断 に。
-- =====================================================================

alter table public.line_broadcasts
  add column if not exists retry_count int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_at timestamptz;

comment on column public.line_broadcasts.retry_count is
  '一時 障害 (LINE API 5xx / ネットワーク) 検知 で status=queued に 戻した 回数。 上限 到達 で failed。';
comment on column public.line_broadcasts.next_retry_at is
  '指数 バック オフ で 次回 tick で 拾い 直す 予定 時刻 (NULL なら 即 拾える)。';
comment on column public.line_broadcasts.last_error_at is
  '最後 に 一時 障害 で status を queued に 戻した 時刻。 監視 で 停滞 検知 に 使う。';

-- 拾い 直し クエリ 用 の index (scheduled_for + next_retry_at の 両方 が now() 以前)。
-- 部分 index で status='queued' の 行 のみ を 対象 に する。
create index if not exists idx_line_broadcasts_queued_next
  on public.line_broadcasts (
    coalesce(next_retry_at, scheduled_for) asc
  )
  where status = 'queued';
