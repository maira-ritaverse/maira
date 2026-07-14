"use client";

/**
 * AI 推薦 プリセット 設定 フォーム (admin 専用)。
 *
 * ・3 プリセット を ラジオ で 選択
 * ・「求職者本人 の 推薦 にも 反映」 トグル
 * ・保存 で /api/agency/ai-recommendation-settings に PUT、 router.refresh() で 反映
 *
 * UI で 各プリセット の 挙動 を 明文化 し、 特に fee_focused 選択時 は 「求職者 の 利益 を
 * 損なう リスク が ある」 と 警告 する。
 */
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Preset = "fit_focused" | "balanced" | "fee_focused";

type Props = {
  initialPreset: Preset;
  initialApplyToSeekerView: boolean;
};

const PRESET_LABELS: Record<Preset, string> = {
  fit_focused: "フィット重視",
  balanced: "バランス",
  fee_focused: "報酬重視",
};

const PRESET_DESCRIPTIONS: Record<Preset, string> = {
  fit_focused:
    "求職者の 強み・診断・希望条件 との マッチ度 だけで 判定します。 成約報酬は 一切 考慮しません(既定)。",
  balanced:
    "フィットを 主軸に、 同程度の 候補が 並んだ ときの タイブレーカー として 成約報酬が 高い 求人を 上位に します。",
  fee_focused:
    "成約報酬が 高い 求人を 強く 上位に 出しつつ、 フィットの 最低ラインは 保ちます。 求職者の 満足度が 下がる リスクがあるので、 慎重に 選んで ください。",
};

export function AiRecommendationSettingsForm({ initialPreset, initialApplyToSeekerView }: Props) {
  const [preset, setPresetState] = useState<Preset>(initialPreset);
  const [applyToSeekerView, setApplyToSeekerViewState] = useState(initialApplyToSeekerView);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  // 変更 が 入ったら 直前 の 「保存 しました」 表示 を 消す。
  // 古い トースト が 残り 続けて、 未保存 の 変更 が 保存済 と 誤認 される の を 防ぐ。
  function setPreset(next: Preset) {
    setPresetState(next);
    setMsg(null);
  }
  function setApplyToSeekerView(next: boolean) {
    setApplyToSeekerViewState(next);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agency/ai-recommendation-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preset,
          apply_to_seeker_view: applyToSeekerView,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setMsg(`保存失敗: ${b.message ?? b.error ?? res.status}`);
        return;
      }
      setMsg("保存しました");
      router.refresh();
    } catch (e) {
      setMsg(`保存失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* プリセット 選択 */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">推薦の 傾き</h2>
        <div className="space-y-2">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((key) => (
            <PresetRadio
              key={key}
              value={key}
              current={preset}
              label={PRESET_LABELS[key]}
              description={PRESET_DESCRIPTIONS[key]}
              onSelect={() => setPreset(key)}
            />
          ))}
        </div>

        {preset === "fee_focused" && (
          <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              報酬重視は 短期的な 売上を 押し上げる 効果が ある 反面、 求職者の 満足度・定着率を
              下げる 恐れが あります。 継続的に モニタリングし、 悪化する ようなら バランス以下に
              戻して ください。
            </p>
          </div>
        )}
      </Card>

      {/* 求職者本人 の 推薦 への 反映 */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">求職者本人の マイページ 推薦 にも 反映</h2>
        <p className="text-muted-foreground text-xs">
          既定は オフ (エージェント 見立て のみ)。 オンに すると、 求職者本人が 自分の マイページで
          見る 推薦順にも この 設定が 適用され ます。 求職者に 成約報酬額 自体は 一切 見えません
          (数値 は 常に 非公開)。
        </p>
        <div className="flex items-center gap-2">
          <input
            id="apply-toggle"
            type="checkbox"
            checked={applyToSeekerView}
            onChange={(e) => setApplyToSeekerView(e.target.checked)}
            className="size-4 cursor-pointer"
          />
          <label htmlFor="apply-toggle" className="cursor-pointer text-sm">
            求職者本人向け 推薦にも 反映する
          </label>
        </div>

        {applyToSeekerView && preset !== "fit_focused" && (
          <div className="flex items-start gap-2 rounded border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              求職者が 単一の 組織とだけ 連携している 場合に 適用されます。 複数の 連携先が ある
              求職者には、 意図しない 組織へ 影響が 及ばないよう、 自動で フィット重視の 推薦に
              切り替わります。
            </p>
          </div>
        )}
      </Card>

      {/* 保存 */}
      <div className="flex items-center justify-end gap-2">
        {msg && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            {msg === "保存しました" && (
              <CheckCircle2 className="size-3 text-emerald-500" aria-hidden />
            )}
            {msg}
          </span>
        )}
        <Button onClick={save} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}

function PresetRadio({
  value,
  current,
  label,
  description,
  onSelect,
}: {
  value: Preset;
  current: Preset;
  label: string;
  description: string;
  onSelect: () => void;
}) {
  const isSelected = current === value;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-accent/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
            isSelected ? "border-primary" : "border-muted-foreground/40"
          }`}
        >
          {isSelected && <div className="bg-primary size-2 rounded-full" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
      </div>
    </button>
  );
}
