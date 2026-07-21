# 0007. LINE Lステップ相当のマーケティングオートメーション拡張方針

- ステータス:採用
- 決定日:2026-07-11

## 文脈

Myaira は既に `ma_scenarios` を中心とした Marketing Automation(MA)基盤を持ち、7 つのプリセット(`line_welcome_after_friend` / `line_dormant_outreach` / `line_register_meeting_promotion` / `line_meeting_reminder` / `line_job_introduction` / `line_after_interview_followup` / `line_birthday_greeting`)で LINE 配信を実現している。しかしこの基盤は「求職者への効果的なマーケティング」を実現する上で構造的な制約を抱えている:

- **単発トリガー = 1 通の設計**(N ステップ配信・条件分岐・目標達成による中断が不可)
- **プリセットハードコード**(UI から動的に新規シナリオを作れない、コード変更 + migration が必要)
- **タグ絞込は OR のみ**、AND/NOT/最終活動/スコアの組合せ動的セグメントなし
- **CV(応募・面談確定・入社)を friend 紐付けで追跡できず**、シナリオ ROI が見えない
- **friend 単位の熱量(engagement)可視化なし**、熱い求職者をアドバイザーに即通知できない

「求職者への効果的なマーケティング」= Lステップ相当を実現するには、多段ステップ・条件分岐・目標達成・動的セグメント・CV 追跡・行動スコアが必要。

## 検討した方式

- **(A)** 別スキーマ `lstep_*` を新設 — 二重管理、既存 MA との統合設計が悩ましい
- **(B)** 既存 `ma_scenarios` を multi-step 化(ALTER で列追加) — 単発と多段の意味が同テーブルに混在、複雑化
- **(C)** 既存 `ma_scenarios` は残しつつ、新規テーブル `ma_flows` を追加。既存 7 プリセットは Phase 0 で `ma_flows` に吸収(単一化)

## 決定

**(C) を採用**。以下の方針とする。

1. 多段 + 分岐対応の新テーブル `ma_flows` / `ma_flow_steps` / `ma_flow_subscriptions` を新設
2. 既存 `ma_scenarios` の 7 プリセットは Phase 0 で `ma_flows` の Flow(1〜3 ステップ)として再定義、`ma_scenarios` は新規 INSERT を停止して凍結(データは監査のため保持)
3. `ma_send_logs` は共通ログとして残し、`ma_flow_step_id` 列を追加して両体系を一元記録
4. `ma_templates` / `ma_click_links`(短縮 URL によるクリック計測)は変更なしで流用
5. cron dispatcher(`/api/internal/ma/line-dispatch`)は Phase 0 完了時に `ma_flows` ベースの新実装に差替え(旧 dispatch は 1 リリース残して並走 → 次リリースで撤去)

## 結果

得たもの:

- ノード編集 UI で自由にシナリオが組める(N ステップ + 分岐 + 目標達成中断)
- 動的セグメント / CV 追跡 / 行動スコアの拡張余地を単一系統に集約
- 既存の暗号化テンプレ・クリック計測・送信ログ基盤を流用、実装コスト最小

失うもの / 一時的コスト:

- Phase 0 の既存プリセット移行作業(1 回きり)
- Phase 0 移行中の並走期間中、cron が新旧両方稼働(重複送信防止ロジックが Phase 0 の必須要件)

長期の得を優先し、一度の移行コストを支払う判断とする。
