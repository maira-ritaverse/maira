"use client";

/**
 * ReactFlow の カスタム ノード:1 ステップ を 表す ボックス。
 *
 * ノード に は step_order / name / action_type / delay を 表示。
 * 上 (target) と 下 (source) に ハンドル を 持ち、 直列 接続 用。
 * branch の 場合 は 追加 で 「false」 側 ハンドル を 右下 に 持つ。
 */
import { Handle, Position } from "@xyflow/react";
import { memo } from "react";

export type StepNodeData = {
  step_order: number;
  name: string | null;
  action_type: string;
  delay_from_previous_seconds: number;
  selected?: boolean;
};

const ACTION_LABELS: Record<string, string> = {
  send_message: "送信",
  assign_tag: "タグ 付与",
  remove_tag: "タグ 削除",
  add_score: "スコア 加算",
  set_field: "自由項目 更新",
  wait: "待機",
  branch: "分岐",
  stop: "終了",
};

function formatDelay(seconds: number): string {
  if (seconds === 0) return "即時";
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間`;
  return `${Math.floor(seconds / 86400)}日`;
}

function StepNodeInner({ data, selected }: { data: StepNodeData; selected?: boolean }) {
  const isBranch = data.action_type === "branch";
  const isStop = data.action_type === "stop";

  return (
    <div
      className={`bg-background min-w-[180px] rounded-md border px-3 py-2 shadow-sm ${
        selected ? "border-primary ring-primary/30 ring-2" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} />

      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span>Step {data.step_order}</span>
        <span>{formatDelay(data.delay_from_previous_seconds)}</span>
      </div>
      <div className="mt-1 text-sm font-medium">
        {data.name ?? `(${ACTION_LABELS[data.action_type] ?? data.action_type})`}
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs">
        {ACTION_LABELS[data.action_type] ?? data.action_type}
      </div>

      {isBranch ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: "70%" }} />
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>true</span>
            <span>false</span>
          </div>
        </>
      ) : !isStop ? (
        <Handle type="source" position={Position.Bottom} />
      ) : null}
    </div>
  );
}

export const StepNode = memo(StepNodeInner);
