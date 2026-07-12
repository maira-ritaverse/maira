"use client";

/**
 * Flow ビルダー UI 本体。 ReactFlow で ステップ を ノード として 表示 し、
 * 右 サイドバー で 選択中 ステップ を 編集。 保存 で /steps API に PUT。
 *
 * 責務 :
 *   ・ステップ 配列 の state 管理 (nodes / edges 由来 で は なく 独立 保持)
 *   ・追加 / 削除 / 属性 変更 の 集約
 *   ・保存 時 に PUT /api/agency/ma/flows/[id]/steps
 *
 * 制約 (Phase 1-F MVP) :
 *   ・レイアウト は 自動 縦 積み (drag 位置 保持 は しない)
 *   ・edge 手動 接続 は 未対応 (default は step_order+1、 branch は 選択 で 決定)
 *   ・テスト シミュレーター は P1-F.2 で 追加
 */
import "@xyflow/react/dist/style.css";

import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FlowDetail } from "@/lib/ma/flow-queries";

import { StepNode, type StepNodeData } from "./step-node";
import { StepConfigPanel, type StepEditable } from "./step-config-panel";

type Props = {
  flow: FlowDetail;
  isAdmin: boolean;
};

// ReactFlow に 渡す nodeTypes は 参照 が 安定 する 必要 が ある
const NODE_TYPES = { step: StepNode };

// step_order → ReactFlow node に 変換
function stepsToNodes(steps: StepEditable[]): Node<StepNodeData>[] {
  return steps.map((s, idx) => ({
    id: String(s.step_order),
    type: "step",
    position: { x: 60, y: 40 + idx * 130 },
    data: {
      step_order: s.step_order,
      name: s.name,
      action_type: s.action_type,
      delay_from_previous_seconds: s.delay_from_previous_seconds,
    },
  }));
}

// steps → edges (default 直列 + branch の 分岐)
function stepsToEdges(steps: StepEditable[]): Edge[] {
  const orderSet = new Set(steps.map((s) => s.step_order));
  const edges: Edge[] = [];
  for (const s of steps) {
    if (s.action_type === "branch") {
      if (s.next_step_on_true != null && orderSet.has(s.next_step_on_true)) {
        edges.push({
          id: `${s.step_order}-true-${s.next_step_on_true}`,
          source: String(s.step_order),
          sourceHandle: "true",
          target: String(s.next_step_on_true),
          label: "true",
        });
      }
      if (s.next_step_on_false != null && orderSet.has(s.next_step_on_false)) {
        edges.push({
          id: `${s.step_order}-false-${s.next_step_on_false}`,
          source: String(s.step_order),
          sourceHandle: "false",
          target: String(s.next_step_on_false),
          label: "false",
        });
      }
    } else if (s.action_type !== "stop") {
      const nextOrder = s.next_step_on_default ?? s.step_order + 1;
      if (orderSet.has(nextOrder)) {
        edges.push({
          id: `${s.step_order}-default-${nextOrder}`,
          source: String(s.step_order),
          target: String(nextOrder),
        });
      }
    }
  }
  return edges;
}

// FlowDetail.steps を 編集 用 型 に 変換
function toEditable(steps: FlowDetail["steps"]): StepEditable[] {
  return steps.map((s) => ({
    step_order: s.step_order,
    name: s.name,
    delay_from_previous_seconds: s.delay_from_previous_seconds,
    action_type: s.action_type,
    action_config: s.action_config ?? {},
    template_id: s.template_id,
    branch_condition_json: s.branch_condition_json,
    next_step_on_true: s.next_step_on_true,
    next_step_on_false: s.next_step_on_false,
    next_step_on_default: s.next_step_on_default,
    goal_check_on_entry: s.goal_check_on_entry,
  }));
}

export function FlowEditor({ flow, isAdmin }: Props) {
  const [steps, setSteps] = useState<StepEditable[]>(toEditable(flow.steps));
  const [selectedOrder, setSelectedOrder] = useState<number | null>(
    flow.steps[0]?.step_order ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const nodes = useMemo(() => stepsToNodes(steps), [steps]);
  const edges = useMemo(() => stepsToEdges(steps), [steps]);

  const selectedStep = steps.find((s) => s.step_order === selectedOrder) ?? null;
  const allStepOrders = steps.map((s) => s.step_order);

  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    setSelectedOrder(Number(node.id));
  }, []);

  const addStep = () => {
    const nextOrder = steps.length === 0 ? 1 : Math.max(...steps.map((s) => s.step_order)) + 1;
    const newStep: StepEditable = {
      step_order: nextOrder,
      name: null,
      delay_from_previous_seconds: 0,
      action_type: "wait",
      action_config: {},
      template_id: null,
      branch_condition_json: null,
      next_step_on_true: null,
      next_step_on_false: null,
      next_step_on_default: null,
      goal_check_on_entry: false,
    };
    setSteps((prev) => [...prev, newStep]);
    setSelectedOrder(nextOrder);
  };

  const patchSelected = (patch: Partial<StepEditable>) => {
    if (selectedOrder == null) return;
    setSteps((prev) => prev.map((s) => (s.step_order === selectedOrder ? { ...s, ...patch } : s)));
  };

  const deleteSelected = () => {
    if (selectedOrder == null) return;
    setSteps((prev) => prev.filter((s) => s.step_order !== selectedOrder));
    setSelectedOrder(null);
  };

  const save = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/agency/ma/flows/${flow.id}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveMsg(`保存 失敗: ${body.error ?? res.status}`);
        return;
      }
      const now = new Date();
      setSaveMsg(`保存 完了 (${now.toLocaleTimeString("ja-JP")})`);
    } catch (err) {
      setSaveMsg(`保存 失敗: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!isAdmin} onClick={addStep}>
            + ステップ 追加
          </Button>
          <span className="text-muted-foreground text-xs">
            トリガー: {flow.trigger_type} / ステップ 数: {steps.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && <span className="text-muted-foreground text-xs">{saveMsg}</span>}
          <Button disabled={!isAdmin || saving} onClick={save}>
            {saving ? "保存 中..." : "保存"}
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[1fr_320px]">
        <div className="border-border rounded border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <div className="border-border overflow-y-auto rounded border p-3">
          <StepConfigPanel
            step={selectedStep}
            allStepOrders={allStepOrders}
            onChange={patchSelected}
            onDelete={deleteSelected}
            disabled={!isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
