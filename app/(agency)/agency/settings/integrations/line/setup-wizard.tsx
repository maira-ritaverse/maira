"use client";

import { AlertCircle, Check, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 初回 セットアップ ウィザード (channel 未接続 の 時 だけ 表示)
 *
 * 3 ステップ:
 *   1. LINE Developers で Channel を 作成 (案内 + 外部リンク)
 *   2. 3 つ の 値 を コピー (チェックリスト で 確認)
 *   3. 貼り付け → 自動接続
 *
 * 自動セットアップ で Webhook + LIFF 設定 が 完了 する。
 * 残作業 ゼロ で 即 LINE 経由 メッセージ が 動く 状態 に なる。
 */
type StepResult = {
  ok: boolean;
  botName?: string;
  autoSetup?: {
    webhookSet: boolean;
    webhookError?: string;
    liffCreated: boolean;
    liffId?: string;
    liffError?: string;
  };
  error?: string;
};

export function SetupWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 2 チェックリスト
  const [hasChannelId, setHasChannelId] = useState(false);
  const [hasChannelSecret, setHasChannelSecret] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(false);

  // Step 3 入力
  const [lineChannelId, setLineChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StepResult | null>(null);

  const onSubmit = async () => {
    if (!lineChannelId || !channelSecret || !channelAccessToken) {
      setResult({ ok: false, error: "全て 入力 して ください" });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/agency/line/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineChannelId,
          channelSecret,
          channelAccessToken,
        }),
      });
      const body = (await res.json()) as
        | {
            ok: true;
            botInfo: { displayName: string };
            autoSetup: {
              webhookSet: boolean;
              webhookError?: string;
              liffCreated: boolean;
              liffId?: string;
              liffError?: string;
            };
          }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message ? body.message : "error" in body ? body.error : "失敗";
        throw new Error(msg);
      }
      setResult({ ok: true, botName: body.botInfo.displayName, autoSetup: body.autoSetup });
      setTimeout(() => window.location.reload(), 4000);
    } catch (e) {
      setResult({ ok: false, error: getErrorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">LINE 公式アカウント を 接続</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          3 ステップ で 完了。 接続後 は Webhook と LIFF が 自動 設定 されます。
        </p>
      </div>

      <StepTabs step={step} onStepChange={setStep} />

      {step === 1 && <Step1 onNext={() => setStep(2)} />}

      {step === 2 && (
        <Step2
          hasChannelId={hasChannelId}
          hasChannelSecret={hasChannelSecret}
          hasAccessToken={hasAccessToken}
          onChannelId={setHasChannelId}
          onChannelSecret={setHasChannelSecret}
          onAccessToken={setHasAccessToken}
          onNext={() => setStep(3)}
          onPrev={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Step3
          lineChannelId={lineChannelId}
          channelSecret={channelSecret}
          channelAccessToken={channelAccessToken}
          onLineChannelId={setLineChannelId}
          onChannelSecret={setChannelSecret}
          onAccessToken={setChannelAccessToken}
          submitting={submitting}
          result={result}
          onSubmit={onSubmit}
          onPrev={() => setStep(2)}
        />
      )}
    </Card>
  );
}

function StepTabs({
  step,
  onStepChange,
}: {
  step: 1 | 2 | 3;
  onStepChange: (s: 1 | 2 | 3) => void;
}) {
  const labels = ["Channel 作成", "値 を コピー", "貼り付け + 接続"];
  return (
    <div className="flex items-center gap-1">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = step === n;
        const done = step > n;
        return (
          <button
            key={label}
            onClick={() => onStepChange(n)}
            className={`flex flex-1 items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              active
                ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-800"
                : done
                  ? "border-emerald-200 bg-emerald-50/30 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                done
                  ? "bg-emerald-600 text-white"
                  : active
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-200"
              }`}
            >
              {done ? <Check className="size-3" aria-hidden /> : n}
            </span>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Step 1: LINE Developers で Channel を 作成</h3>
      <ol className="ml-5 list-decimal space-y-1.5 text-sm">
        <li>下記 ボタン から LINE Developers コンソール を 開く</li>
        <li>プロバイダ を 選択 (既存 公式LINE があれば その プロバイダ、 なければ 新規作成)</li>
        <li>
          「新規チャネル作成」 → <strong>Messaging API</strong> を 選択
        </li>
        <li>チャネル名 / 説明 / カテゴリ などを 入力 して 作成</li>
        <li>
          作成後、 既存 の 公式LINE アカウントが ある なら「Channel 設定」→「アカウントを連携」で
          紐付け
        </li>
      </ol>

      <div className="flex flex-wrap justify-between gap-2">
        <a
          href="https://developers.line.biz/console/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-semibold underline hover:bg-slate-50"
        >
          LINE Developers コンソール を 開く
          <ChevronRight className="size-3" aria-hidden />
        </a>
        <Button onClick={onNext} size="sm">
          作成しました → Step 2
        </Button>
      </div>
    </div>
  );
}

function Step2({
  hasChannelId,
  hasChannelSecret,
  hasAccessToken,
  onChannelId,
  onChannelSecret,
  onAccessToken,
  onNext,
  onPrev,
}: {
  hasChannelId: boolean;
  hasChannelSecret: boolean;
  hasAccessToken: boolean;
  onChannelId: (v: boolean) => void;
  onChannelSecret: (v: boolean) => void;
  onAccessToken: (v: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const allChecked = hasChannelId && hasChannelSecret && hasAccessToken;
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Step 2: 3 つ の 値 を コピー</h3>
      <div className="space-y-2">
        <CheckboxItem
          checked={hasChannelId}
          onCheckedChange={onChannelId}
          label="Channel ID"
          where="「チャネル基本設定」タブ 下部"
        />
        <CheckboxItem
          checked={hasChannelSecret}
          onCheckedChange={onChannelSecret}
          label="Channel Secret"
          where="「チャネル基本設定」タブ 下部"
        />
        <CheckboxItem
          checked={hasAccessToken}
          onCheckedChange={onAccessToken}
          label="チャネル アクセストークン (長期)"
          where="「Messaging API設定」タブ → 発行 ボタン を 押して 取得"
        />
      </div>

      <div className="flex justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onPrev}>
          ← Step 1
        </Button>
        <Button size="sm" onClick={onNext} disabled={!allChecked}>
          全部 コピーしました → Step 3
        </Button>
      </div>
    </div>
  );
}

function Step3({
  lineChannelId,
  channelSecret,
  channelAccessToken,
  onLineChannelId,
  onChannelSecret,
  onAccessToken,
  submitting,
  result,
  onSubmit,
  onPrev,
}: {
  lineChannelId: string;
  channelSecret: string;
  channelAccessToken: string;
  onLineChannelId: (v: string) => void;
  onChannelSecret: (v: string) => void;
  onAccessToken: (v: string) => void;
  submitting: boolean;
  result: StepResult | null;
  onSubmit: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Step 3: 貼り付け → 接続</h3>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-channel-id" className="text-xs">
            Channel ID
          </Label>
          <Input
            id="wiz-channel-id"
            value={lineChannelId}
            onChange={(e) => onLineChannelId(e.target.value)}
            placeholder="例: 1234567890"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-channel-secret" className="text-xs">
            Channel Secret <span className="text-muted-foreground">(機密)</span>
          </Label>
          <Input
            id="wiz-channel-secret"
            type="password"
            value={channelSecret}
            onChange={(e) => onChannelSecret(e.target.value)}
            placeholder="32 桁の 16 進数"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-access-token" className="text-xs">
            アクセス トークン (長期) <span className="text-muted-foreground">(機密)</span>
          </Label>
          <Input
            id="wiz-access-token"
            type="password"
            value={channelAccessToken}
            onChange={(e) => onAccessToken(e.target.value)}
            placeholder="long-lived access token"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs">
        <p className="font-semibold text-emerald-900">接続 後 自動 で 行われる こと:</p>
        <ul className="mt-1 space-y-0.5">
          <li className="text-emerald-800">・Webhook URL を LINE 側 に 設定</li>
          <li className="text-emerald-800">・LIFF アプリ (求人詳細 / 応募 用) を 作成</li>
          <li className="text-emerald-800">・接続 疎通テスト</li>
        </ul>
      </div>

      {result && !result.ok && (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {result && result.ok && result.autoSetup && (
        <Alert>
          <AlertDescription>
            <p className="font-semibold text-emerald-700">接続 完了! ({result.botName})</p>
            <ul className="mt-2 space-y-1 text-xs">
              <ResultItem
                ok={result.autoSetup.webhookSet}
                label="Webhook 自動設定"
                detail={result.autoSetup.webhookError}
              />
              <ResultItem
                ok={result.autoSetup.liffCreated}
                label={`LIFF 自動作成${result.autoSetup.liffId ? ` (${result.autoSetup.liffId})` : ""}`}
                detail={result.autoSetup.liffError}
              />
            </ul>
            <p className="mt-3 text-xs text-slate-600">4 秒後 に ページを 再読み込み します...</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onPrev} disabled={submitting}>
          ← Step 2
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submitting || !lineChannelId || !channelSecret || !channelAccessToken}
          className="bg-[#06C755] text-white hover:bg-[#05a647]"
        >
          {submitting ? "接続中..." : "接続 + 自動セットアップ"}
        </Button>
      </div>
    </div>
  );
}

function CheckboxItem({
  checked,
  onCheckedChange,
  label,
  where,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  where: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition-colors ${
        checked ? "border-emerald-300 bg-emerald-50" : "hover:border-slate-300"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-[11px]">{where}</p>
      </div>
    </label>
  );
}

function ResultItem({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className={`flex items-start gap-1 ${ok ? "text-emerald-700" : "text-amber-700"}`}>
      {ok ? (
        <Check className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {label}
        {detail && ` — ${detail}`}
      </span>
    </li>
  );
}
