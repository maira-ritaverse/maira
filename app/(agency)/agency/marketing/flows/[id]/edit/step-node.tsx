"use client";

/**
 * ReactFlow の カスタム ノード:action_type ごと に フローチャート 記号 に 近い
 * シェイプ / 色 / アイコン で 表示。
 *
 *   ・send_message / assign_tag / remove_tag / add_score / set_field / wait
 *       → 角丸 長方形 (processing block、 色 分け で 区別)
 *   ・branch → ダイヤモンド (decision、 flowchart 標準)
 *   ・stop   → ピル (terminator)
 *
 * ハンドル :
 *   ・入力 は 常に 上 (Position.Top、 stop 以外 も)
 *   ・出力 は 下 (Position.Bottom)。 branch のみ 「Left = true / Right = false」
 *     で 分岐 が 視覚的 に 見え る よう に する
 *   ・stop は 出力 なし
 */
import { Handle, Position } from "@xyflow/react";
import {
  AlertTriangle,
  CircleStop,
  Clock,
  GitBranch,
  MessageCircle,
  Pencil,
  Tag,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { memo } from "react";

export type StepNodeData = {
  step_order: number;
  name: string | null;
  action_type: string;
  delay_from_previous_seconds: number;
  selected?: boolean;
  /** AI 生成 Flow の未設定ステップ(wait + ai_intent など)ならバッジを出す */
  needsSetup?: boolean;
};

type Shape = "block" | "diamond" | "pill";

type ActionStyle = {
  label: string;
  icon: LucideIcon;
  shape: Shape;
  /** Tailwind クラス:背景 / 枠 / テキスト の 3 点 */
  bg: string;
  border: string;
  text: string;
};

const ACTION_STYLES: Record<string, ActionStyle> = {
  send_message: {
    label: "メッセージ 送信",
    icon: MessageCircle,
    shape: "block",
    bg: "bg-sky-50",
    border: "border-sky-400",
    text: "text-sky-900",
  },
  assign_tag: {
    label: "タグ 付与",
    icon: Tag,
    shape: "block",
    bg: "bg-violet-50",
    border: "border-violet-400",
    text: "text-violet-900",
  },
  remove_tag: {
    label: "タグ 削除",
    icon: X,
    shape: "block",
    bg: "bg-violet-50",
    border: "border-violet-400",
    text: "text-violet-900",
  },
  add_score: {
    label: "スコア 加算",
    icon: TrendingUp,
    shape: "block",
    bg: "bg-teal-50",
    border: "border-teal-400",
    text: "text-teal-900",
  },
  set_field: {
    label: "自由項目 更新",
    icon: Pencil,
    shape: "block",
    bg: "bg-teal-50",
    border: "border-teal-400",
    text: "text-teal-900",
  },
  wait: {
    label: "待機",
    icon: Clock,
    shape: "block",
    bg: "bg-slate-50",
    border: "border-slate-300",
    text: "text-slate-700",
  },
  branch: {
    label: "分岐",
    icon: GitBranch,
    shape: "diamond",
    bg: "bg-amber-50",
    border: "border-amber-500",
    text: "text-amber-900",
  },
  stop: {
    label: "終了",
    icon: CircleStop,
    shape: "pill",
    bg: "bg-rose-50",
    border: "border-rose-400",
    text: "text-rose-900",
  },
};

const FALLBACK_STYLE: ActionStyle = {
  label: "?",
  icon: Clock,
  shape: "block",
  bg: "bg-slate-50",
  border: "border-slate-300",
  text: "text-slate-700",
};

function formatDelay(seconds: number): string {
  if (seconds === 0) return "即時";
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間`;
  return `${Math.floor(seconds / 86400)}日`;
}

function StepNodeInner({ data, selected }: { data: StepNodeData; selected?: boolean }) {
  const style = ACTION_STYLES[data.action_type] ?? FALLBACK_STYLE;
  const Icon = style.icon;
  const isBranch = style.shape === "diamond";
  const isStop = style.shape === "pill";

  const ringClass = selected ? "ring-2 ring-primary ring-offset-1" : "";
  const warningBadge = data.needsSetup ? (
    <div
      className="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 rounded-full border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 shadow-sm"
      title="このステップは未設定です。実行時に何も起きません。"
    >
      <AlertTriangle className="size-3" aria-hidden />
      未設定
    </div>
  ) : null;

  // ── コンテンツ (共通) ──
  const content = (
    <div className="flex flex-col items-center gap-0.5 px-2 text-center">
      <div className={`flex items-center gap-1 text-[10px] ${style.text} opacity-70`}>
        <span>Step {data.step_order}</span>
        <span>·</span>
        <span>{formatDelay(data.delay_from_previous_seconds)}</span>
      </div>
      <div className={`flex items-center gap-1 text-xs font-semibold ${style.text}`}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-[140px] truncate">{data.name ?? style.label}</span>
      </div>
      {data.name && data.name !== style.label && (
        <div className={`text-[10px] ${style.text} opacity-70`}>{style.label}</div>
      )}
    </div>
  );

  // ── シェイプ 別 の 枠 ──
  if (isBranch) {
    // Diamond (decision)。 clip-path で 菱形、 handle は Top / Left / Right。
    return (
      <div className={`relative ${ringClass}`} style={{ width: 180, height: 120 }}>
        {warningBadge}
        <div
          className={`absolute inset-0 ${style.bg} border-2 ${style.border}`}
          style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
        />
        <div className="absolute inset-0 flex items-center justify-center">{content}</div>

        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Left} id="true" />
        <Handle type="source" position={Position.Right} id="false" />

        {/* true / false ラベル */}
        <div className="absolute top-1/2 left-[-24px] -translate-y-1/2 text-[10px] font-semibold text-emerald-700">
          true
        </div>
        <div className="absolute top-1/2 right-[-30px] -translate-y-1/2 text-[10px] font-semibold text-rose-700">
          false
        </div>
      </div>
    );
  }

  if (isStop) {
    // Pill (terminator)
    return (
      <div
        className={`relative flex min-w-[160px] items-center justify-center rounded-full border-2 py-2 ${style.bg} ${style.border} ${ringClass}`}
      >
        {warningBadge}
        <Handle type="target" position={Position.Top} />
        {content}
      </div>
    );
  }

  // Block (processing)
  const warningBorderClass = data.needsSetup ? "border-amber-500 bg-amber-50" : "";
  return (
    <div
      className={`relative min-w-[180px] rounded-md border-2 py-2 ${warningBorderClass || `${style.bg} ${style.border}`} ${ringClass}`}
    >
      {warningBadge}
      <Handle type="target" position={Position.Top} />
      {content}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const StepNode = memo(StepNodeInner);
