"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isScenarioImplemented,
  type ConsentStatus,
  type MAFeature,
  type ScenarioView,
} from "@/lib/ma/types";
import { ConsentModal } from "./consent-modal";
import { TestSendModal } from "./test-send-modal";

/**
 * マーケティング画面のクライアント側コンポーネント
 *
 * 役割:
 *   1. 利用同意状態のヘッダ表示(同意済みなら有効化ログ、未同意なら「有効化する」ボタン)
 *   2. シナリオカード一覧(現状は求職者向け email のみ)
 *   3. 各カードの ON/OFF トグル
 *   4. 同意モーダルの表示制御
 *
 * 操作可否:
 *   - 未同意 → トグル無効(まず同意してもらう)
 *   - non-admin → トグル無効(閲覧のみ)
 *   - admin かつ同意済み → トグル有効
 *
 * Phase C-2(送信処理)と Phase C-3(テンプレ編集)は次タスク。
 */
export type MarketingScreenProps = {
  scenarios: ScenarioView[];
  consent: ConsentStatus;
  consentVersion: string;
  isAdmin: boolean;
};

export function MarketingScreen({
  scenarios,
  consent,
  consentVersion,
  isAdmin,
}: MarketingScreenProps) {
  const router = useRouter();
  const [showConsent, setShowConsent] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // 求職者向け email シナリオだけを Phase C-1 のスコープとして表示
  const candidateEmailScenarios = scenarios.filter(
    (s) => s.preset.audience === "candidate" && s.preset.channel === "email",
  );

  async function handleRevoke() {
    if (!window.confirm("マーケティング機能の利用を停止します。よろしいですか?")) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch("/api/agency/ma/consent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: "email_ma" satisfies MAFeature }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "撤回に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setRevokeError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      {/* ヘッダ */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Eメール(MA)</h1>
            <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              β版
            </span>
          </div>
          {/* 送信履歴へのナビ。同意状態に関係なく閲覧可(advisor も含む)。 */}
          <Button variant="outline" size="sm" render={<Link href="/agency/marketing/logs" />}>
            送信履歴
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">Eメール自動配信シナリオの管理・設定</p>

        {/* 同意状態の表示 */}
        {consent.isActive ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <span className="text-emerald-900">
              ✓ 有効化済み(特約バージョン {consent.consentVersion}、
              {consent.acceptedAt ? new Date(consent.acceptedAt).toLocaleDateString("ja-JP") : "—"})
            </span>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={revoking}>
                {revoking ? "撤回中..." : "撤回"}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <span className="text-amber-900">利用を開始するには配信特約への同意が必要です。</span>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowConsent(true)}>
                有効化する
              </Button>
            )}
          </div>
        )}
        {revokeError && (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            {revokeError}
          </p>
        )}
      </div>

      {/* シナリオカード一覧 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">求職者シナリオ ({candidateEmailScenarios.length})</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {candidateEmailScenarios.map((view) => (
            <ScenarioCard
              key={view.preset.id}
              view={view}
              disabled={!consent.isActive || !isAdmin}
            />
          ))}
        </div>
      </section>

      <ConsentModal
        open={showConsent}
        feature="email_ma"
        consentVersion={consentVersion}
        onClose={() => setShowConsent(false)}
      />
    </>
  );
}

type ScenarioCardProps = {
  view: ScenarioView;
  disabled: boolean;
};

function ScenarioCard({ view, disabled }: ScenarioCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showTestSend, setShowTestSend] = useState(false);

  // 起点+N日後/前の N を編集中フラグ。値は文字列で持って onBlur で確定する。
  // -365 〜 365 のレンジは API 側 Zod で再検証。
  const [editingDays, setEditingDays] = useState<string | null>(null);

  const isActive = view.activation?.isActive ?? false;
  const days = view.effectiveTriggerDays;
  const daysLabel = days < 0 ? `${Math.abs(days)}日前` : `${days}日後`;
  // プリセットのデフォルトと違うときは「カスタム」表示にする
  const overridden = view.activation?.triggerDaysOverride != null;

  // 送信側(Edge Function)で判定ロジックが実装されているかどうか。
  // 未実装シナリオは ON にしても送られないため、UI で明示的に無効化する。
  const implemented = isScenarioImplemented(view.preset.key);
  // 「未実装」と「親 disabled(未同意/non-admin)」のいずれかで操作不可
  const cardDisabled = disabled || !implemented;

  function handleToggle() {
    if (cardDisabled) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/agency/ma/scenarios", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presetId: view.preset.id,
            isActive: !isActive,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(data?.message ?? "更新に失敗しました");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      }
    });
  }

  // 日数を確定保存(空欄 → null = プリセットのデフォルトに戻す)
  function commitDays() {
    const raw = (editingDays ?? "").trim();
    setEditingDays(null);
    let next: number | null = null;
    if (raw !== "") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        setError("整数を入力してください");
        return;
      }
      if (parsed < -365 || parsed > 365) {
        setError("-365 〜 365 の範囲で入力してください");
        return;
      }
      next = parsed;
    }
    // 同値なら何もしない(無駄なリクエストを避ける)
    if (next === (view.activation?.triggerDaysOverride ?? null)) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/agency/ma/scenarios", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presetId: view.preset.id,
            triggerDaysOverride: next,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(data?.message ?? "日数の更新に失敗しました");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{view.preset.name}</CardTitle>
          {!implemented && (
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              title="送信ロジックが未実装のため、現在は配信できません"
            >
              準備中
            </span>
          )}
        </div>
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span>起点: {view.preset.triggerEvent} → </span>
          {/* 日数編集:有効化後 + 実装済み + 親 disabled でない時のみ編集可。
              編集不可時はラベル表示。 */}
          {view.activation && implemented && !disabled ? (
            editingDays !== null ? (
              <input
                type="number"
                autoFocus
                value={editingDays}
                onChange={(e) => setEditingDays(e.target.value)}
                onBlur={commitDays}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setEditingDays(null);
                  }
                }}
                placeholder={String(view.preset.defaultTriggerDays)}
                className="w-20 rounded border px-1.5 py-0.5 text-xs"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingDays(String(days))}
                className="hover:bg-accent rounded px-1 py-0.5 text-left text-xs"
                title="クリックで日数を編集(空にするとデフォルトに戻る)"
              >
                <span className="font-medium">{daysLabel}</span>
                {overridden && (
                  <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-700">
                    カスタム
                  </span>
                )}
              </button>
            )
          ) : (
            <span>{daysLabel}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{view.preset.description}</p>
        {!implemented && (
          <p className="text-muted-foreground rounded border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-xs">
            このシナリオは送信ロジックが未実装です。必要なデータ(面談・希望条件
            等)の整備後に有効化できるようになります。
          </p>
        )}
        <div className="flex items-center justify-between pt-1">
          <span
            className={`text-xs font-medium ${
              isActive ? "text-emerald-700" : "text-muted-foreground"
            }`}
          >
            {isActive ? "● 配信中" : "○ 停止中"}
          </span>
          <div className="flex items-center gap-2">
            {/* テンプレート編集 + テスト送信は、有効化(scenario行が存在)後のみ可能。
                未有効化時は scenario_id が存在しないためボタンを出さない。 */}
            {view.activation && implemented && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  render={
                    <Link
                      href={`/agency/marketing/${encodeURIComponent(view.activation.id)}/template`}
                    />
                  }
                >
                  テンプレート編集
                </Button>
                {/* テスト送信は admin のみ。disabled は同意状態と関係なく、
                    テスト目的のため open する(API 側で admin チェック)。 */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowTestSend(true)}
                  disabled={disabled}
                  title="1 通だけテストメールを送って動作確認"
                >
                  テスト送信
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant={isActive ? "outline" : "default"}
              onClick={handleToggle}
              disabled={cardDisabled || pending}
            >
              {pending ? "更新中..." : isActive ? "停止する" : "配信開始"}
            </Button>
          </div>
        </div>
        {error && (
          <p className="rounded border border-red-200 bg-red-50 p-1.5 text-xs text-red-800">
            {error}
          </p>
        )}
      </CardContent>
      {/* テスト送信モーダル。activation が無い時は表示する余地が無いのでガード。 */}
      {view.activation && (
        <TestSendModal
          open={showTestSend}
          scenarioId={view.activation.id}
          scenarioName={view.preset.name}
          onClose={() => setShowTestSend(false)}
        />
      )}
    </Card>
  );
}
