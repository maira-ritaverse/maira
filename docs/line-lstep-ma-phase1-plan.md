# LINE Lステップ MA:Phase 1 実装計画(Lstep-Core)

- ステータス:実装着手待ち
- 最終更新:2026-07-11
- 関連:[全体設計](./line-lstep-ma-design.md) / [ADR 0007](./adr/0007-line-lstep-ma-flow.md) / [Phase 0 計画](./line-lstep-ma-phase0-plan.md)
- 前提:Phase 0(`ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions` + 旧凍結)完了済

Phase 1 は **Lstep-Core**、Maira を「1 通配信の MA」から「多段ステップ配信のマーケティングオートメーション」に変える中核実装フェーズ。

---

## 1. 目的 / スコープ

### 目的

- 多段ステップ + 分岐対応の **新 dispatcher**(`/api/internal/ma/flow-dispatch`)を稼働させ、`ma_flow_subscriptions.next_action_at` を 1 分粒度で走査してアクションを実行できる状態にする
- **動的セグメント**(`line_segments`)を導入し、Flow の対象 / broadcast の絞込 / 手動 enroll から共通で使えるようにする
- Flow ビルダー UI・セグメント編集 UI を実装し、Phase 0 で凍結した旧 `ma_scenarios` の代替導線を提供する
- 旧 `/api/internal/ma/line-dispatch` cron を安全に撤去する

### スコープに含む

1. `line_segments` テーブル追加 + FK 補完
2. filter_dsl_json / branch_condition_json の評価エンジン(SQL 翻訳 + サブスクリプション判定)
3. 新 dispatcher `flow-dispatch`(action_type 8 種すべて実装)
4. Trigger hooks(`friend_added` / `tag_assigned` / `conversion_event` / `segment_matched` / `postback_received` / `manual`)
5. Flow ビルダー UI(一覧・編集ビジュアライザ・テストシミュレーター)
6. セグメント編集 UI(条件ビルダー + プレビュー)
7. Broadcast 対象選択に `line_segments` を追加
8. 旧 `line-dispatch` cron 撤去 + 旧 UI からの導線置き換え

### スコープに含まない(Phase 2 以降)

- `ma_conversion_events`(Phase 2) — Phase 1 では `goal_event_key` の照合はスタブ実装 or 遅延
- 行動スコアリング(Phase 2)
- キーワード自動応答(Phase 2)
- ROI ダッシュボード(Phase 2)
- LIFF フォーム / entry_sources / user 単位配信ログ(Phase 3)
- リッチメニュー / narrowcast(Phase 4)

---

## 2. Phase 0 との連続性 と 前提

- Phase 0 で 3 テーブル + 列追加まで完了、既存プリセットも Backfill 実装済(dev では対象 0 のため未実行)
- 旧 `ma_scenarios` は INSERT 凍結、UPDATE/DELETE は Phase 1 で撤去まで可
- Phase 1 完了時点で:
  - 新 dispatcher が本稼働(1 分毎)
  - 旧 line-dispatch を停止、コードも削除
  - 旧 `/agency/marketing` 画面は Flow ビルダーへリダイレクト or 完全置換
  - `ma_scenarios` は最終的に read-only 化(別 migration)

---

## 3. サブステップ全体像(8 ステップ)

| #    | ステップ                   | 主要成果物                                                                | 目安    | 依存        |
| ---- | -------------------------- | ------------------------------------------------------------------------- | ------- | ----------- |
| P1-A | Segments 基盤              | migration + DSL 型 + SQL 翻訳器 + テスト                                  | 3〜4 日 | Phase 0     |
| P1-B | Dispatcher コア            | flow-dispatch route + 実行エンジン + 分岐評価 + テスト                    | 4〜5 日 | P1-A        |
| P1-C | Trigger hooks              | webhook / タグ / 手動 enroll のフック実装                                 | 2〜3 日 | P1-B        |
| P1-D | Cron 起動 + カットオーバー | vercel.json + 段階切替フラグ + 監視                                       | 1〜2 日 | P1-C        |
| P1-E | Flow 一覧 UI               | list page + 新規作成 + プリセット選択                                     | 2〜3 日 | P1-B        |
| P1-F | Flow ビルダー UI           | edit page + ノードエディタ + テストシミュレーター                         | 5〜7 日 | P1-E        |
| P1-G | Segment 編集 UI            | list + edit + 条件ビルダー + プレビュー                                   | 3〜4 日 | P1-A        |
| P1-H | 旧撤去 + broadcast 連携    | 旧 line-dispatch 削除 + `line-ma-screen.tsx` 置換 + broadcast target 拡張 | 2〜3 日 | P1-D 完了後 |

**合計目安:22〜31 営業日**(≒ 4〜6 週)、実装者 1 名想定

各ステップは **最大 5 ファイル** の変更に収まるよう設計。ステップ間で `git commit` を切ることを想定。

---

## 4. サブステップ詳細

### 4.1 P1-A:Segments 基盤

**目的**:動的セグメントの表現と評価を先に固める。Flow の trigger / target で共有する土台。

**成果物**(最大 5 ファイル):

1. `supabase/migrations/20260712000001_add_line_segments.sql` — テーブル + RLS + `ma_flows.target_segment_id` に FK 制約追加
2. `lib/ma/segment-dsl.ts` — `SegmentFilter` 型 + validate 関数
3. `lib/ma/segment-sql.ts` — `filter_dsl_json` → SQL WHERE 節への翻訳 + パラメータ生成
4. `lib/ma/segment-sql.test.ts` — SQL 翻訳の単体テスト(kind ごと)
5. `lib/ma/segment-eval.ts` — 単一 friend について in-memory 判定(dispatcher で使う)

**DDL 概要**:

```sql
create table if not exists public.line_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  filter_dsl_json jsonb not null,
  friend_count_cache integer,
  last_computed_at timestamptz,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.ma_flows
  add constraint ma_flows_target_segment_fk
  foreign key (target_segment_id) references public.line_segments(id) on delete set null;
```

**受入基準**:

- `select_friends_by_filter(org, filter_json)` で対象 line_user_id[] が返る
- ネストされた and/or/not を含む DSL を SQL WHERE に変換できる
- `friend_count_cache` を再計算する service_role RPC が動作
- 単体テストで 12 種の kind すべてカバー(design doc §6.1)

---

### 4.2 P1-B:Dispatcher コア

**目的**:cron が呼ぶ実行エンジン。Phase 1 の中核。

**成果物**(5 ファイル):

1. `app/api/internal/ma/flow-dispatch/route.ts` — cron エンドポイント(既存 line-dispatch の骨格を流用、logic は差し替え)
2. `lib/ma/flow-executor.ts` — 1 subscription を 1 ステップ進める `executeSubscriptionTick(sub)` 関数(action_type 8 種のディスパッチ)
3. `lib/ma/flow-branch-evaluator.ts` — `branch_condition_json` を評価(segment DSL + Flow 固有条件)
4. `lib/ma/flow-executor.test.ts` — 全 action_type × 分岐パターンの単体テスト
5. `lib/ma/flow-scheduler.ts` — `next_action_at` 計算 + send_time_window 判定 + max_send_per_day 判定

**実行フロー**(疑似コード):

```ts
async function runFlowDispatchTick() {
  const subs = await sb
    .from("ma_flow_subscriptions")
    .select("id, flow_id, line_user_id, current_step_order, ...")
    .eq("status", "active")
    .lte("next_action_at", now)
    .order("next_action_at")
    .limit(200);

  for (const sub of subs) {
    try {
      await executeSubscriptionTick(sub);
    } catch (err) {
      await markSubscriptionFailure(sub.id, err);
    }
  }
}
```

`executeSubscriptionTick(sub)`:

1. `ma_flow_steps` から現在ステップを取得
2. `goal_check_on_entry=true` かつ goal_event_key ありなら CV 判定(Phase 2 実装まではスタブ)
3. `send_time_window_json` 判定 → 範囲外なら遅延
4. `max_send_per_day` 判定 → 超過なら遅延
5. action_type ディスパッチ:
   - `send_message`:template 復号 → 変数展開 → `wrapBodyUrls` → push、`ma_send_logs` 記録(`ma_flow_step_id` 付き)
   - `assign_tag` / `remove_tag`:既存 `line_conversation_tag_assignments` を操作
   - `add_score`:Phase 2 実装まで no-op + ログ
   - `set_field`:`friend_fields` を UPSERT
   - `wait`:no-op
   - `branch`:`branch_condition_json` を評価 → next_step_on_true/false を決定
   - `stop`:status='completed' に更新
6. 次ステップ決定 + `next_action_at` 更新
7. subscription を UPDATE

**受入基準**:

- 8 種の action_type すべて単体テスト通過
- branch 分岐が 3 段ネストでも正しく動く
- send_message 実行時、既存 `ma_send_logs` に `ma_flow_step_id` を含む行が入る
- 送信失敗時に `last_error_at` / `last_error_message` が記録される
- 200 件/tick の処理が 30 秒以内に完了(dev で計測)

---

### 4.3 P1-C:Trigger hooks

**目的**:イベントから `ma_flow_subscriptions` を作る(enroll)。

**成果物**(5 ファイル):

1. `lib/ma/flow-enroller.ts` — `enrollFriendToFlow(flowId, lineUserId, options)` + `findMatchingFlowsForEvent(orgId, event)` 中核関数
2. `lib/line/event-handler.ts` の修正 — `handleFollow` に `friend_added` trigger 発火を追加、`handlePostback` に `postback_received` trigger 発火を追加
3. `lib/line/conversation-tags.ts` の修正 — タグ付与時に `tag_assigned` trigger を発火
4. `app/api/internal/ma/segment-scan/route.ts` — 15 分毎 cron、`segment_matched` trigger の新規マッチを検出
5. `lib/ma/flow-enroller.test.ts` — allow_reentry、target_segment 判定、重複 enroll 防止のテスト

**enroll ロジック**:

```ts
async function enrollFriendToFlow(flowId, lineUserId, options) {
  const flow = await getFlow(flowId);
  if (!flow.is_active) return { skipped: "flow_inactive" };

  // target_segment 判定
  if (flow.target_segment_id) {
    const matches = await evalSegmentForFriend(flow.target_segment_id, lineUserId);
    if (!matches) return { skipped: "segment_mismatch" };
  }

  // allow_reentry 判定
  if (!flow.allow_reentry) {
    const past = await sb
      .from("ma_flow_subscriptions")
      .select("id")
      .eq("flow_id", flowId)
      .eq("line_user_id", lineUserId)
      .limit(1);
    if (past.data?.length) return { skipped: "already_enrolled" };
  }

  const step1 = await getStep(flowId, 1);
  const nextAt = computeNextActionAt(flow, step1, options.baseTime ?? now);

  return await sb
    .from("ma_flow_subscriptions")
    .insert({
      organization_id: flow.organization_id,
      flow_id: flowId,
      line_user_id: lineUserId,
      client_record_id: options.clientRecordId ?? null,
      current_step_order: 1,
      next_action_at: nextAt,
      status: "active",
      entered_via: options.enteredVia ?? "trigger_auto",
    })
    .select()
    .single();
}
```

**受入基準**:

- 友だち追加時、`friend_added` トリガーの Flow がすべて enroll される
- タグ付与時、対応する `tag_assigned` Flow が enroll される
- `allow_reentry=false` の重複 enroll がユニーク index で拒否される
- `segment_matched` scan cron が 15 分毎に走り、新規マッチのみを enroll する

---

### 4.4 P1-D:Cron 起動 + カットオーバー

**目的**:新 dispatcher を実運用に載せ、旧 line-dispatch と並走できる状態に。

**成果物**(3〜4 ファイル):

1. `vercel.json` — 新 cron 追加:`/api/internal/ma/flow-dispatch`(1 分)、`/api/internal/ma/segment-scan`(15 分)
2. `lib/ma/dispatch-flag.ts` — org 単位の `dispatch_engine` 判定(env var or DB フラグ)
3. `app/api/internal/ma/line-dispatch/route.ts` の修正 — フラグで新体系に移行済 org を skip
4. `docs/line-lstep-ma-phase1-plan.md`(本書)にカットオーバー実績記録

**カットオーバー段階**:

- Stage 0(現在):旧のみ稼働、新 dispatcher コードは書かれているが cron 未登録
- Stage 1:新 cron を追加、両方稼働。`dispatch_engine='new'` フラグ立てた org のみ新側で処理、旧は skip
- Stage 2:全 org で新側稼働、旧 line-dispatch は空回り
- Stage 3(P1-H):旧 line-dispatch cron を vercel.json から削除、コード削除

**受入基準**:

- Stage 1 で dev 1 org を新側に切替 → 数時間観測、重複送信なし
- Stage 2 で dev 全 org 切替 → 24h 観測
- ロールバックはフラグを戻すだけで即応可能

---

### 4.5 P1-E:Flow 一覧 UI

**目的**:管理画面からの Flow 参照と新規作成の入り口。

**成果物**(5 ファイル):

1. `app/(agency)/agency/marketing/flows/page.tsx` — 一覧(name / trigger / 有効化 / origin_preset_key バッジ)
2. `app/(agency)/agency/marketing/flows/flow-list.tsx` — Client component、フィルタ / ソート
3. `app/api/agency/ma/flows/route.ts` — GET(一覧)/ POST(新規作成、プリセットから or 手動)
4. `app/(agency)/agency/marketing/flows/new-flow-modal.tsx` — プリセット選択モーダル(7 種 + 空白)
5. `lib/ma/flow-queries.ts` — Flow 取得の共通クエリ(list + detail + steps)

**受入基準**:

- Flow 一覧が正しく org スコープで表示される
- 「新規 Flow 作成」→ プリセット選択 → 空の編集画面 or プリセット反映済編集画面へ遷移
- 一覧から Flow の有効化トグルが変更できる(admin のみ)

---

### 4.6 P1-F:Flow ビルダー UI(最大サブステップ)

**目的**:ノード編集で多段ステップを組み立てられるようにする。Phase 1 の顔となる UI。

**成果物**(5 ファイル):

1. `app/(agency)/agency/marketing/flows/[id]/edit/page.tsx` — サーバーコンポーネント(Flow + Steps 取得)
2. `app/(agency)/agency/marketing/flows/[id]/edit/flow-editor.tsx` — Client、ノードエディタ本体
3. `app/(agency)/agency/marketing/flows/[id]/edit/step-config-panel.tsx` — 選択中ステップの詳細編集(action_type 別のフォーム)
4. `app/api/agency/ma/flows/[id]/steps/route.ts` — Steps 一括 UPSERT(トランザクション)
5. `app/(agency)/agency/marketing/flows/[id]/edit/test-simulator.tsx` — 仮想 friend で分岐評価をシミュレート

**未決事項**:

- ノードエディタは **React Flow**(`@xyflow/react`、新規依存)vs **カスタム SVG エディタ** — 推奨:React Flow(実装コスト 1/3、既に業界標準、a11y も担保)
- ただし新規依存追加は CLAUDE.md 「勝手に技術選定を変えない」に該当するため、着手前にユーザー承認必須

**受入基準**:

- ステップ追加・削除・並替えができる
- action_type 変更で config パネルが動的に切り替わる
- テストシミュレーターで「タグ A あり / スコア 30 / 前ステップでクリック済」等の仮定を入れて評価結果が見える
- 保存時、全ステップが 1 トランザクションで INSERT/UPDATE/DELETE される
- バリデーション:`branch` action は branch_condition_json 必須、`send_message` は template_id 必須(既存 CHECK 制約に対応)

---

### 4.7 P1-G:Segment 編集 UI

**目的**:動的セグメントを非エンジニアが組めるようにする。

**成果物**(5 ファイル):

1. `app/(agency)/agency/marketing/segments/page.tsx` — 一覧
2. `app/(agency)/agency/marketing/segments/[id]/edit/page.tsx` — 編集
3. `app/(agency)/agency/marketing/segments/[id]/edit/condition-builder.tsx` — 条件ビルダー(ネスト and/or)
4. `app/(agency)/agency/marketing/segments/[id]/edit/preview-panel.tsx` — 「現時点 N 人がマッチ」+ 直近 10 件サンプル
5. `app/api/agency/ma/segments/[id]/preview/route.ts` — POST(filter_dsl_json を受けてマッチ数 + サンプル返却)

**条件ビルダー UX 案**:

- ツリー型:AND / OR / NOT グループ + 条件行(kind 選択 → kind 別のフィールド)
- 12 種の kind(design doc §6.1)にそれぞれ入力コンポーネント
- プレビューは編集中に自動更新(debounce 500ms)

**受入基準**:

- 12 種の kind すべてで条件行を追加できる
- ネスト 3 段まで表示できる
- プレビュー数と Flow 起動時の実対象数が一致する
- friend_count_cache が編集後に更新される

---

### 4.8 P1-H:旧撤去 + broadcast 連携

**目的**:旧体系を完全撤去し、新体系だけを残す。broadcast にセグメント絞込を追加。

**成果物**(5 ファイル):

1. `vercel.json` — 旧 `/api/internal/ma/line-dispatch` cron 削除
2. `app/api/internal/ma/line-dispatch/route.ts` — 削除(または 410 レスポンスのみに縮小)
3. `app/(agency)/agency/marketing/line-ma-screen.tsx` の修正 — 「Phase 0/1 で新 Flow 体系へ移行済」バナー + Flow ビルダーへの導線
4. `lib/line/broadcast-targets.ts` の修正 — target 引数に `{ kind: 'segment', segment_id }` を追加
5. `supabase/migrations/20260712NNNNNN_readonly_ma_scenarios.sql` — `ma_scenarios` を read-only 化(INSERT/UPDATE/DELETE すべて拒否)

**カットオーバー チェックリスト**:

- 全 org が Stage 2(新側)で 1 週間安定稼働
- 旧 `ma_scenarios` に新規 UPDATE が入っていないことを確認(SELECT で updated_at を監視)
- 旧 dispatcher の削除は 1 リリース残してから最終削除

**受入基準**:

- 旧 UI から新 UI への遷移がスムーズ(ユーザーが迷子にならない)
- broadcast の対象選択にセグメントが選べる
- `ma_scenarios` への UPDATE がトリガーで拒否される

---

## 5. DSL 仕様の formalize

Phase 1 で確定するため、design doc §6 の DSL を厳密化する。

### 5.1 SegmentFilter の TypeScript 型

```ts
export type SegmentCondition =
  | { kind: "has_tag"; tag_id: string }
  | { kind: "not_has_tag"; tag_id: string }
  | { kind: "score_gte"; value: number }
  | { kind: "score_lte"; value: number }
  | { kind: "field_equals"; key: string; value: string }
  | { kind: "field_exists"; key: string }
  | { kind: "days_since_last_activity_gte"; days: number }
  | { kind: "days_since_added_lte"; days: number }
  | { kind: "days_since_added_gte"; days: number }
  | { kind: "entry_source_in"; codes: string[] }
  | { kind: "conversion_event_present"; event_key: string; within_days: number }
  | { kind: "conversion_event_absent"; event_key: string; within_days: number }
  | { kind: "clicked_link_in_flow"; flow_id: string }
  | { kind: "and"; conditions: SegmentCondition[] }
  | { kind: "or"; conditions: SegmentCondition[] }
  | { kind: "not"; condition: SegmentCondition };

export type SegmentFilter = {
  root: SegmentCondition;
};
```

### 5.2 BranchCondition(Flow ステップ内の分岐)

SegmentCondition の全 kind を継承 + 以下を追加:

```ts
export type BranchCondition =
  | SegmentCondition
  | { kind: "postback_data_equals"; data: string }
  | { kind: "postback_data_prefix"; prefix: string }
  | { kind: "replied_since_previous_step" }
  | { kind: "clicked_link_in_previous_step" };
```

### 5.3 SQL 翻訳の原則

- 全 kind は `WHERE ... IN (SELECT line_user_id FROM ...)` 相当のサブクエリに変換
- ネスト and/or は `AND` / `OR` に、not は `NOT` にマップ
- `line_user_links` を主軸に、tag / event / send_logs / click_links を LEFT JOIN
- パラメータインジェクションは Supabase RPC 経由で完全に防ぐ

**Phase 2 未実装 kind**:

- `conversion_event_present` / `conversion_event_absent`:`ma_conversion_events` テーブルが Phase 2 実装なので、Phase 1 では空判定(常に false)としてスタブ実装
- `score_gte` / `score_lte`:`line_user_links.engagement_score` は Phase 2 で列追加、Phase 1 では常に 0 と仮定

---

## 6. 新規依存の検討

Phase 1 で追加が推奨されるパッケージ(**着手前にユーザー承認必須**):

| パッケージ      | 用途                     | 代替案            | 推奨                        |
| --------------- | ------------------------ | ----------------- | --------------------------- |
| `@xyflow/react` | Flow ノードエディタ      | カスタム SVG 実装 | 追加推奨(工数 1/3、UX 標準) |
| `@dnd-kit/core` | ステップ並替えのドラッグ | HTML5 Native DnD  | 追加推奨(a11y 対応)         |

追加する場合は `pnpm-workspace.yaml` の `allowBuilds` に必要なら追加、CLAUDE.md 更新も検討。

---

## 7. テスト戦略

- **単体テスト**(vitest):segment-sql / segment-eval / flow-executor / flow-branch-evaluator / flow-enroller すべてに `.test.ts` を用意
- **統合テスト**:P1-B 完了時点で「dev で 1 org 1 Flow を手動作成 → 手動 enroll → 1 分後に送信される」を確認
- **回帰テスト**:P1-D の Stage 1 で「1 org のみ新側」で 24h 稼働 → 送信通数・失敗率・順序が旧と同水準か確認
- **UI E2E**(手動):Flow ビルダーで「3 ステップ + 1 分岐」を組み、テストシミュレーターで期待通り評価されるか確認

---

## 8. カットオーバー・ロールバック

各ステップは独立してロールバック可能:

| ステップ | ロールバック方法                                          |
| -------- | --------------------------------------------------------- |
| P1-A     | `drop table line_segments cascade`                        |
| P1-B     | 新 route を削除、cron 未登録なら影響なし                  |
| P1-C     | webhook / タグハンドラの変更を revert                     |
| P1-D     | vercel.json から新 cron 削除、フラグを old に戻す         |
| P1-E     | 新 UI ルートを削除、既存 UI は無変更                      |
| P1-F     | 同上                                                      |
| P1-G     | 同上                                                      |
| P1-H     | 旧 line-dispatch を復活、read-only 化 migration を revert |

**最重要**:P1-D の Stage 1 段階で 24h 観察し、重複送信・欠落送信が検出されたら即フラグを old に戻す。

---

## 9. 未決事項

| #   | 論点                                                 | 現時点の提案                                                                            |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | ノードエディタ:React Flow を新規依存として追加するか | 推奨:追加。工数見合いが良い。着手前にユーザー承認                                       |
| 2   | segment_matched の scan 間隔                         | 15 分。Phase 2 で `line_engagement_events` の頻度と合わせて調整                         |
| 3   | Phase 1 の `goal_event_key` チェックはスタブか実装か | スタブ(常に未達成扱い)。Phase 2 で本格実装                                              |
| 4   | 旧 `line-ma-screen.tsx` を残すか                     | 完全撤去(P1-H)。ユーザーには移行案内バナーを出す                                        |
| 5   | `dispatch_engine` フラグは env var か DB 列か        | DB 列(`organizations.ma_dispatch_engine text default 'old'`)を推奨、監視が楽            |
| 6   | Attribution モデル(送信 → CV 紐付け)                 | Phase 2 で本格実装、Phase 1 では `ma_flow_step_id` を `ma_send_logs` に記録するに留める |
| 7   | Flow ビルダーの保存モデル(下書き / 公開)             | Phase 1 は `is_active` の on/off のみ、下書き機能は Phase 2 以降                        |

---

## 10. 実装順序と着手可能性

**着手順序は P1-A → P1-B → P1-C → P1-D → P1-E → P1-G(並行可)→ P1-F → P1-H**

- P1-A(Segment 基盤)は独立、他ステップの基礎になる → 最初に着手
- P1-B〜D は「バックエンドの動作」で完結、UI なしでも運用可能(手動 SQL で Flow を作れば)
- P1-E〜G は UI、UX の反復が必要
- P1-H はすべての最終段階

**次のアクション(このセッション内で選択可)**:

- **A**. P1-A(Segment 基盤)から実装着手(migration + 型 + SQL 翻訳器 + テスト)
- **B**. React Flow など新規依存の可否をまず決めてから、P1-A に入る
- **C**. 本プランを一晩置いて、明日以降にステップ単位で開始
- **D**. P1-B(Dispatcher コア)を先に着手し、UI を後回しにする(バックエンド優先)
