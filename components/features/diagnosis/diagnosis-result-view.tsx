// 診断結果の表示ビュー(求職者・エージェント共通)。
//
// - 入力は保存済みの StoredDiagnosis(career_profile.diagnosis)。
// - レーダーチャート、軸、強みバッジ、職種カテゴリ、AI 説明文を 1 つのビューに。
// - Server / Client いずれからもレンダリングできるように pure。

import { Card } from "@/components/ui/card";
import {
  aptitudeFactorChartVars,
  aptitudeStrengthLabels,
} from "@/lib/diagnosis/aptitude-questions";
import { axisTypeLabels } from "@/lib/diagnosis/axis-questions";
import type { StoredDiagnosis } from "@/lib/career/profile-schema";
import { AptitudeRadar } from "./aptitude-radar";

type Props = {
  diagnosis: StoredDiagnosis;
  // エージェント表示時に「向いている職種」「説明文」を切るオプション。
  // 将来、エージェント向けに情報量を絞りたい場合の余地として残す(現状は全表示で OK)。
  compact?: boolean;
};

export function DiagnosisResultView({ diagnosis, compact = false }: Props) {
  const { axis, aptitude, jobs, explanation, createdAt } = diagnosis;

  return (
    <div className="space-y-4">
      <Card className="space-y-6 p-6">
        {/* 軸 */}
        <div>
          <p className="text-muted-foreground text-xs">あなたの軸</p>
          <p className="mt-1 text-xl font-semibold">{axisTypeLabels[axis.primary]}</p>
          {axis.secondary && (
            <p className="text-muted-foreground mt-1 text-sm">
              次いで {axisTypeLabels[axis.secondary]}(僅差)
            </p>
          )}
        </div>

        {/* レーダーチャート + 上位強み */}
        <div className="grid gap-4 sm:grid-cols-[1fr_minmax(0,180px)] sm:items-center">
          <div className="flex justify-center">
            <div className="aspect-square w-full max-w-75">
              <AptitudeRadar scores={aptitude.scores} />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-muted-foreground text-xs">あなたの強み(上位)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {aptitude.topStrengths.length > 0 ? (
                  aptitude.topStrengths.map((f) => {
                    // レーダーのドット/ラベルと同じ chart-N 色を使う。
                    // ダーク/ライト両対応のため color-mix で背景/枠を薄める(opacity を使うと
                    // 文字まで薄くなるため不可)。
                    const c = aptitudeFactorChartVars[f];
                    return (
                      <span
                        key={f}
                        className="rounded-full border px-3 py-1 text-xs font-medium"
                        style={{
                          color: c,
                          backgroundColor: `color-mix(in oklch, ${c} 12%, transparent)`,
                          borderColor: `color-mix(in oklch, ${c} 35%, transparent)`,
                        }}
                      >
                        {aptitudeStrengthLabels[f]}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-muted-foreground text-xs">強みが拮抗しています</span>
                )}
              </div>
            </div>
            {jobs.aptitudeHint && (
              <p className="text-muted-foreground text-xs leading-relaxed">{jobs.aptitudeHint}</p>
            )}
          </div>
        </div>
      </Card>

      {/* 向いている職種 */}
      <Card className="space-y-2 p-6">
        <p className="text-muted-foreground text-xs">向いている職種カテゴリ(候補)</p>
        <ul className="mt-2 space-y-2">
          {jobs.categories.map((j) => (
            <li
              key={j.name}
              className="border-border flex flex-col rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{j.name}</span>
              <span className="text-muted-foreground mt-0.5 text-xs">{j.description}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* AI 説明文 */}
      {!compact && explanation && (
        <Card className="p-6">
          <p className="text-muted-foreground text-xs">あなたへ</p>
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{explanation}</p>
        </Card>
      )}

      <p className="text-muted-foreground text-center text-xs">
        診断日: {new Date(createdAt).toLocaleString("ja-JP")} ・
        提示される職種は「向いている方向の候補」です
      </p>
    </div>
  );
}
