// 適性レーダーチャート(5因子)。
//
// なぜ自前 SVG?
// - recharts は ~300KB の追加バンドル。固定 5 角形を 1 個描くだけならネイティブ SVG で十分。
// - Tailwind のテーマカラー(--primary / --muted-foreground 等)を className でそのまま当てられ、
//   ダーク/ライト切替に自然に追従する。
// - 依存ゼロ、サーバーコンポーネントからも安全に描画できる(use client 不要)。
//
// 仕様:
// - 5 軸、各因子の最大スコアは 8(2問×4点)。0-100% に正規化して描画。
// - グリッドは 4 重(25% / 50% / 75% / 100%)で読み取りやすく。
// - ラベルは「強み表現」(発想力・責任感 など)で、学術用語を見せない。
// - 各頂点のドットは因子のスコア(0..1)で半径と不透明度を変化させ、
//   強い因子ほど濃く・大きく表示する(「あなたの強み」を視覚で即把握)。
//   面と外形線はブランド単色のままで、派手にしすぎない。

import {
  aptitudeFactorChartVars,
  aptitudeStrengthLabels,
  type AptitudeFactor,
} from "@/lib/diagnosis/aptitude-questions";

const FACTORS: AptitudeFactor[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "stability",
];

// 適性 1 因子あたりの最大スコア。質問2問 × 4段階の最大値 = 8。
const MAX_SCORE = 8;

type Props = {
  scores: Record<AptitudeFactor, number>;
  // 表示サイズ。デフォルトは 280。ダッシュボード等で小さく出したい場合に調整。
  size?: number;
  // 軸ラベルを描画するかどうか。小サイズ表示(=ダッシュボード)では切る選択肢。
  showLabels?: boolean;
};

export function AptitudeRadar({ scores, size = 280, showLabels = true }: Props) {
  // ラベル描画のための余白を確保する。ラベル無しなら margin を詰める。
  const padding = showLabels ? 56 : 16;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - padding * 2) / 2;

  // viewBox はラベル分の余白を加味して内部座標系より広く取る。
  // チャート本体の座標(cx/cy/radius)は変えず、見える領域だけ上下左右に拡張する。
  // 長いラベル(例「コミュニケーション力・行動力」)が SVG 境界クリップで切れないようにするための措置。
  // ラベル無しモード(ダッシュボード active)は元の viewBox に戻し、本体を最大限に見せる。
  const viewBoxMarginX = showLabels ? 60 : 0;
  const viewBoxMarginY = showLabels ? 40 : 0;
  const viewBoxX = -viewBoxMarginX;
  const viewBoxY = -viewBoxMarginY;
  const viewBoxW = size + viewBoxMarginX * 2;
  const viewBoxH = size + viewBoxMarginY * 2;

  // 5 軸を上から時計回りに配置(0番目を真上にするため -90° スタート)。
  const angles = FACTORS.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / FACTORS.length);

  // グリッド多角形の頂点を返すヘルパー(scale: 0.25 / 0.5 / 0.75 / 1.0)。
  function polygonPoints(scale: number): string {
    return angles
      .map((a) => {
        const x = cx + Math.cos(a) * radius * scale;
        const y = cy + Math.sin(a) * radius * scale;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  // 実データの多角形。各軸でスコアを 0-1 に正規化。
  // norm は頂点座標だけでなく、ドットの濃淡・サイズにも使う。
  const dataPoints = FACTORS.map((f, i) => {
    const norm = Math.max(0, Math.min(1, (scores[f] ?? 0) / MAX_SCORE));
    const x = cx + Math.cos(angles[i]) * radius * norm;
    const y = cy + Math.sin(angles[i]) * radius * norm;
    return { x, y, norm };
  });
  const dataPolygon = dataPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

  return (
    <svg
      viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`}
      width="100%"
      height="100%"
      role="img"
      aria-label="適性レーダーチャート"
      className="max-w-full"
    >
      {/* グリッド(同心多角形)。currentColor + opacity で muted を表現。 */}
      <g className="text-muted-foreground/40">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <polygon
            key={scale}
            points={polygonPoints(scale)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        ))}
        {/* 軸線(中心から各頂点へ) */}
        {angles.map((a, i) => {
          const x = cx + Math.cos(a) * radius;
          const y = cy + Math.sin(a) * radius;
          return (
            <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeWidth={1} />
          );
        })}
      </g>

      {/* データ多角形(主軸の塗り)。primary 色を Tailwind の text- 経由で当てる。
          ドット/ラベルは因子ごとの chart-1〜5 で色分けして、強み発見を視覚で促す。 */}
      <g className="text-primary">
        <polygon
          points={dataPolygon}
          fill="currentColor"
          fillOpacity={0.18}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {dataPoints.map((p, i) => {
          // 強い因子ほど大きく・濃く。
          // 半径: 2.5(弱)→ 5.5(強)、不透明度: 0.35(弱)→ 1.0(強)。
          // 色は因子ごとに固定(chart-1〜5)。バッジ側と同じマップを参照する。
          const r = 2.5 + p.norm * 3;
          const opacity = 0.35 + p.norm * 0.65;
          const color = aptitudeFactorChartVars[FACTORS[i]];
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={r}
              fill={color}
              fillOpacity={opacity}
              stroke={color}
              strokeWidth={1}
            />
          );
        })}
      </g>

      {/* ラベル(強み表現)。中央寄せで配置、各軸の角度に応じて少し外側へ。
          因子色(chart-1〜5)で着色し、ドットと同色にして紐付けを明示する。
          「・」を含む長いラベルは 2 行に折り返してラベル幅を圧縮する
          (例「コミュニケーション力・行動力」→ 1行目「コミュニケーション力」 / 2行目「行動力」)。 */}
      {showLabels && (
        <g className="text-[10px] font-medium">
          {FACTORS.map((f, i) => {
            const a = angles[i];
            // ラベル位置:データ最外周より少し外側へ。横位置は角度の cos 符号で揃える。
            const labelR = radius + 18;
            const x = cx + Math.cos(a) * labelR;
            const y = cy + Math.sin(a) * labelR;
            // テキストアンカー:左半分なら end、右半分なら start、上下は middle。
            const cos = Math.cos(a);
            const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";

            const label = aptitudeStrengthLabels[f];
            const color = aptitudeFactorChartVars[f];
            // 「・」を含むラベルは 2 行に折り返す。1 行目を少し上、2 行目を少し下に
            // 配置して、ラベルの縦中心が (x, y) に来るようにする。
            const sepIdx = label.indexOf("・");
            if (sepIdx >= 0) {
              const line1 = label.slice(0, sepIdx);
              const line2 = label.slice(sepIdx + 1);
              return (
                <text
                  key={f}
                  x={x}
                  y={y}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fill={color}
                >
                  <tspan x={x} dy="-0.55em">
                    {line1}
                  </tspan>
                  <tspan x={x} dy="1.1em">
                    {line2}
                  </tspan>
                </text>
              );
            }

            return (
              <text key={f} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fill={color}>
                {label}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}
