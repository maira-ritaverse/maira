import { describe, it, expect } from "vitest";
import {
  aptitudeFactorChartVars,
  aptitudeQuestions,
  aptitudeStrengthLabels,
  type AptitudeFactor,
} from "./aptitude-questions";
import { axisQuestions, axisTypeLabels, type AxisType } from "./axis-questions";
import { aptitudeJobHints, axisToJobs } from "./job-mapping";

/**
 * 診断データ(設問・ラベル・マッピング)の構造テスト。
 *
 * 設問数と factor/type の対応がズレると、scoring の per-type 加算が偏って
 * 「ある因子だけ常に低スコア」になる事故が起きる(過去にあった)。
 *
 * Label / chart-vars / job-mapping は「全 factor / type を網羅する Record」と
 * 型レベルで保証されているが、新キー追加時に追記漏れがあると lib/diagnosis 全体に
 * 影響が広がる。テストで明示的に固定する。
 */

const ALL_AXIS: AxisType[] = [
  "specialist",
  "management",
  "autonomy",
  "security",
  "entrepreneur",
  "service",
  "challenge",
  "lifestyle",
];

const ALL_FACTORS: AptitudeFactor[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "stability",
];

describe("axisQuestions(キャリア軸)", () => {
  it("16 問(8 タイプ × 2 問)", () => {
    expect(axisQuestions).toHaveLength(16);
  });

  it("各タイプの設問数は均等(2 問ずつ)— scoring の加算バランスを担保", () => {
    const countByType = new Map<string, number>();
    for (const q of axisQuestions) {
      countByType.set(q.type, (countByType.get(q.type) ?? 0) + 1);
    }
    for (const t of ALL_AXIS) {
      expect(countByType.get(t), `${t} の設問数が 2 でない`).toBe(2);
    }
  });

  it("id は重複しない", () => {
    const ids = axisQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("text は全部非空(空の質問は UI で空白行になる)", () => {
    for (const q of axisQuestions) {
      expect(q.text.length).toBeGreaterThan(0);
    }
  });

  it("id は ax01〜ax16 の連番(scoring 側 expected の参照と整合)", () => {
    const expected = Array.from({ length: 16 }, (_, i) => `ax${String(i + 1).padStart(2, "0")}`);
    expect(axisQuestions.map((q) => q.id)).toEqual(expected);
  });
});

describe("axisTypeLabels", () => {
  it("全 AxisType にラベルが定義(漏れ検知)", () => {
    for (const t of ALL_AXIS) {
      expect(axisTypeLabels[t]).toBeTruthy();
    }
  });

  it("union と Record キーが一致", () => {
    expect(Object.keys(axisTypeLabels).sort()).toEqual([...ALL_AXIS].sort());
  });

  it("ラベルは行動レベルの日本語(学術用語を出さない)", () => {
    // 「キャリアアンカー」「自律」のような学術用語ではなく、行動表現で固定
    expect(axisTypeLabels.specialist).toBe("専門性を極める");
    expect(axisTypeLabels.lifestyle).toBe("ワークライフバランス");
  });
});

describe("aptitudeQuestions(ビッグファイブ)", () => {
  it("10 問(5 因子 × 2 問)", () => {
    expect(aptitudeQuestions).toHaveLength(10);
  });

  it("各因子の設問数は均等(2 問ずつ)— scoring の加算バランスを担保", () => {
    const countByFactor = new Map<string, number>();
    for (const q of aptitudeQuestions) {
      countByFactor.set(q.factor, (countByFactor.get(q.factor) ?? 0) + 1);
    }
    for (const f of ALL_FACTORS) {
      expect(countByFactor.get(f), `${f} の設問数が 2 でない`).toBe(2);
    }
  });

  it("id は重複しない / ap01〜ap10 の連番", () => {
    const ids = aptitudeQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expected = Array.from({ length: 10 }, (_, i) => `ap${String(i + 1).padStart(2, "0")}`);
    expect(ids).toEqual(expected);
  });
});

describe("aptitudeStrengthLabels / aptitudeFactorChartVars", () => {
  it("strengthLabels が全因子をカバー(union と Record 一致)", () => {
    for (const f of ALL_FACTORS) {
      expect(aptitudeStrengthLabels[f]).toBeTruthy();
    }
    expect(Object.keys(aptitudeStrengthLabels).sort()).toEqual([...ALL_FACTORS].sort());
  });

  it("chart-vars が全因子をカバー(union と Record 一致)", () => {
    for (const f of ALL_FACTORS) {
      expect(aptitudeFactorChartVars[f]).toMatch(/^var\(--chart-\d\)$/);
    }
    expect(Object.keys(aptitudeFactorChartVars).sort()).toEqual([...ALL_FACTORS].sort());
  });

  it("chart-vars は --chart-1〜--chart-5 を使う(順番固定の単一情報源)", () => {
    // 順序を変えると「この色 = この因子」の対応が崩れる(レーダーチャートと強みバッジで不整合)
    expect(aptitudeFactorChartVars.openness).toBe("var(--chart-1)");
    expect(aptitudeFactorChartVars.conscientiousness).toBe("var(--chart-2)");
    expect(aptitudeFactorChartVars.extraversion).toBe("var(--chart-3)");
    expect(aptitudeFactorChartVars.agreeableness).toBe("var(--chart-4)");
    expect(aptitudeFactorChartVars.stability).toBe("var(--chart-5)");
  });

  it("各 chart-var は全部別の色 (1〜5 が重複なく割り当たる)", () => {
    const vars = Object.values(aptitudeFactorChartVars);
    expect(new Set(vars).size).toBe(vars.length);
  });
});

describe("axisToJobs", () => {
  it("全 AxisType に職種マッピングが定義(欠けると suggestJobs で落ちる)", () => {
    for (const t of ALL_AXIS) {
      expect(axisToJobs[t]).toBeDefined();
      expect(axisToJobs[t].length).toBeGreaterThan(0);
    }
  });

  it("union と Record キーが一致(余計なキー混入も検知)", () => {
    expect(Object.keys(axisToJobs).sort()).toEqual([...ALL_AXIS].sort());
  });

  it("各 JobCategory に name と description がある", () => {
    for (const t of ALL_AXIS) {
      for (const job of axisToJobs[t]) {
        expect(job.name.length).toBeGreaterThan(0);
        expect(job.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("aptitudeJobHints", () => {
  it("全因子にヒント文(suggestJobs の aptitudeHint で参照)", () => {
    for (const f of ALL_FACTORS) {
      expect(aptitudeJobHints[f]).toBeTruthy();
      expect(aptitudeJobHints[f].length).toBeGreaterThan(0);
    }
  });

  it("union と Record キーが一致", () => {
    expect(Object.keys(aptitudeJobHints).sort()).toEqual([...ALL_FACTORS].sort());
  });
});
