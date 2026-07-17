"use client";

/**
 * AI 推薦プリセット設定フォーム(admin 専用)。
 *
 * ・3 プリセットをラジオで選択
 * ・「求職者本人の推薦にも反映」トグル
 * ・保存で /api/agency/ai-recommendation-settings に PUT、router.refresh() で反映
 *
 * UI で各プリセットの挙動を明文化し、特に fee_focused 選択時は「求職者の利益を
 * 損なうリスクがある」と警告する。
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
    "求職者の強み・診断・希望条件とのマッチ度だけで判定します。成約報酬は一切考慮しません(既定)。",
  balanced:
    "フィットを主軸に、同程度の候補が並んだときのタイブレーカーとして成約報酬が高い求人を上位にします。",
  fee_focused:
    "成約報酬が高い求人を強く上位に出しつつ、フィットの最低ラインは保ちます。求職者の満足度が下がるリスクがあるので、慎重に選んでください。",
};

export function AiRecommendationSettingsForm({ initialPreset, initialApplyToSeekerView }: Props) {
  const [preset, setPresetState] = useState<Preset>(initialPreset);
  const [applyToSeekerView, setApplyToSeekerViewState] = useState(initialApplyToSeekerView);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  // 変更が入ったら直前の「保存しました」表示を消す。
  // 古いトーストが残り続けて、未保存の変更が保存済と誤認されるのを防ぐ。
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
      {/* プリセット選択 */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">推薦の傾き</h2>
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
              報酬重視は短期的な売上を押し上げる効果がある反面、求職者の満足度・定着率を
              下げる恐れがあります。継続的にモニタリングし、悪化するようならバランス以下に
              戻してください。
            </p>
          </div>
        )}
      </Card>

      {/* 求職者本人の推薦への反映 */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">求職者本人のマイページ推薦にも反映</h2>
        <p className="text-muted-foreground text-xs">
          既定はオフ(エージェント見立てのみ)。オンにすると、求職者本人が自分のマイページで
          見る推薦順にもこの設定が適用されます。求職者に成約報酬額自体は一切見えません
          (数値は常に非公開)。
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
            求職者本人向け推薦にも反映する
          </label>
        </div>

        {applyToSeekerView && preset !== "fit_focused" && (
          <div className="flex items-start gap-2 rounded border border-blue-300 bg-blue-50 p-3 text-xs text-blue-900">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              求職者が単一の組織とだけ連携している場合に適用されます。複数の連携先がある
              求職者には、意図しない組織へ影響が及ばないよう、自動でフィット重視の推薦に
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
