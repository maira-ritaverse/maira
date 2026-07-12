"use client";

/**
 * Flow ビルダー UI 本体 (Phase 1-F.2:自由 DAG 版)。
 *
 * ReactFlow で ステップ を ノード として 表示 し、 ドラッグ で 位置 変更、
 * ハンドル 間 ドラッグ で edge 接続、 Delete キー で 削除 でき る。
 * 右 パネル で 選択中 ステップ の 詳細 編集。 保存 で /steps API に PUT。
 *
 * 責務 :
 *   ・steps 配列 と ReactFlow の nodes/edges を 同期
 *   ・onConnect:source ハンドル に 応じて next_step_on_true / false /
 *     default を 更新
 *   ・onNodesChange (position dragging=false):steps.position_x/y に 保存
 *   ・onNodesChange (remove):steps 削除
 *   ・onEdgesChange (remove):edge id から source step を 特定 して
 *     next_step_on_* を null に 戻す
 *   ・保存:全 steps を PUT で 一括 置換 (位置 込み)
 */
import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";
import type { FlowDetail, MaTemplateOption } from "@/lib/ma/flow-queries";
import type { SegmentListItem } from "@/lib/ma/segment-queries";

import { AiImproveModal } from "./ai-improve-modal";
import { StepConfigPanel, type StepEditable } from "./step-config-panel";
import { StepNode, type StepNodeData } from "./step-node";

type Props = {
  flow: FlowDetail;
  isAdmin: boolean;
  tags: LineConversationTag[];
  templates: MaTemplateOption[];
  segments: SegmentListItem[];
};

/** Flow の 編集 可能 メタ (PATCH で 送る フィールド のみ) */
type FlowMeta = {
  name: string;
  description: string;
  goal_event_key: string;
  allow_reentry: boolean;
  max_send_per_day: number | null;
  target_segment_id: string | null;
};

const NODE_TYPES = { step: StepNode };

// ────────────────────────────────────────
// steps → ReactFlow node / edge の 変換
// ────────────────────────────────────────

function defaultPosition(index: number): { x: number; y: number } {
  return { x: 60, y: 40 + index * 130 };
}

function stepsToNodes(steps: StepEditable[]): Node<StepNodeData>[] {
  return steps.map((s, idx) => ({
    id: String(s.step_order),
    type: "step",
    position: {
      x: s.position_x ?? defaultPosition(idx).x,
      y: s.position_y ?? defaultPosition(idx).y,
    },
    data: {
      step_order: s.step_order,
      name: s.name,
      action_type: s.action_type,
      delay_from_previous_seconds: s.delay_from_previous_seconds,
    },
  }));
}

// フローチャート らしい 見た目 の 共通 edge 装飾
const EDGE_BASE = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 2 },
};

function stepsToEdges(steps: StepEditable[]): Edge[] {
  const orderSet = new Set(steps.map((s) => s.step_order));
  const edges: Edge[] = [];
  for (const s of steps) {
    if (s.action_type === "branch") {
      if (s.next_step_on_true != null && orderSet.has(s.next_step_on_true)) {
        edges.push({
          ...EDGE_BASE,
          id: `${s.step_order}-true-${s.next_step_on_true}`,
          source: String(s.step_order),
          sourceHandle: "true",
          target: String(s.next_step_on_true),
          label: "true",
          labelStyle: { fontSize: 11, fontWeight: 600, fill: "#047857" },
          labelBgStyle: { fill: "#ecfdf5" },
          style: { strokeWidth: 2, stroke: "#10b981" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#10b981" },
        });
      }
      if (s.next_step_on_false != null && orderSet.has(s.next_step_on_false)) {
        edges.push({
          ...EDGE_BASE,
          id: `${s.step_order}-false-${s.next_step_on_false}`,
          source: String(s.step_order),
          sourceHandle: "false",
          target: String(s.next_step_on_false),
          label: "false",
          labelStyle: { fontSize: 11, fontWeight: 600, fill: "#be123c" },
          labelBgStyle: { fill: "#fff1f2" },
          style: { strokeWidth: 2, stroke: "#f43f5e" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#f43f5e" },
        });
      }
    } else if (s.action_type !== "stop") {
      const nextOrder = s.next_step_on_default;
      if (nextOrder != null && orderSet.has(nextOrder)) {
        edges.push({
          ...EDGE_BASE,
          id: `${s.step_order}-default-${nextOrder}`,
          source: String(s.step_order),
          target: String(nextOrder),
        });
      }
    }
  }
  return edges;
}

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
    position_x: s.position_x,
    position_y: s.position_y,
  }));
}

// ────────────────────────────────────────
// 本体
// ────────────────────────────────────────

export function FlowEditor({ flow, isAdmin, tags, templates, segments }: Props) {
  const initialSteps = useMemo(() => toEditable(flow.steps), [flow.steps]);
  const [steps, setSteps] = useState<StepEditable[]>(initialSteps);
  const [meta, setMeta] = useState<FlowMeta>({
    name: flow.name,
    description: flow.description ?? "",
    goal_event_key: flow.goal_event_key ?? "",
    allow_reentry: flow.allow_reentry,
    max_send_per_day: flow.max_send_per_day,
    target_segment_id: flow.target_segment_id,
  });
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [aiImproveOpen, setAiImproveOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(
    initialSteps[0]?.step_order ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node<StepNodeData>>(
    stepsToNodes(initialSteps),
  );
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>(stepsToEdges(initialSteps));

  // steps に 追加 / 削除 / データ 更新 が あった とき に nodes / edges を 追随。
  // 位置 は 既存 の React Flow 側 の 値 を 優先 して 保持。
  useEffect(() => {
    setNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]));
      return steps.map((s, idx) => ({
        id: String(s.step_order),
        type: "step",
        position:
          posById.get(String(s.step_order)) ??
          (s.position_x != null && s.position_y != null
            ? { x: s.position_x, y: s.position_y }
            : defaultPosition(idx)),
        data: {
          step_order: s.step_order,
          name: s.name,
          action_type: s.action_type,
          delay_from_previous_seconds: s.delay_from_previous_seconds,
        },
      }));
    });
    setEdges(stepsToEdges(steps));
  }, [steps, setNodes, setEdges]);

  // ── React Flow 側 の 変更 → steps に 同期 ──

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<StepNodeData>>[]) => {
      onNodesChangeRaw(changes);
      if (!isAdmin) return;
      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          const stepOrder = Number(change.id);
          setSteps((prev) =>
            prev.map((s) =>
              s.step_order === stepOrder
                ? {
                    ...s,
                    position_x: change.position!.x,
                    position_y: change.position!.y,
                  }
                : s,
            ),
          );
        }
        if (change.type === "remove") {
          const stepOrder = Number(change.id);
          setSteps((prev) => prev.filter((s) => s.step_order !== stepOrder));
          if (selectedOrder === stepOrder) setSelectedOrder(null);
        }
      }
    },
    [onNodesChangeRaw, isAdmin, selectedOrder],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeRaw(changes);
      if (!isAdmin) return;
      for (const change of changes) {
        if (change.type === "remove") {
          // edge id は "<src>-<kind>-<tgt>" 形式
          const parts = change.id.split("-");
          const src = Number(parts[0]);
          const kind = parts[1];
          setSteps((prev) =>
            prev.map((s) => {
              if (s.step_order !== src) return s;
              if (kind === "true") return { ...s, next_step_on_true: null };
              if (kind === "false") return { ...s, next_step_on_false: null };
              return { ...s, next_step_on_default: null };
            }),
          );
        }
      }
    },
    [onEdgesChangeRaw, isAdmin],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!isAdmin) return;
      if (!params.source || !params.target) return;
      const src = Number(params.source);
      const tgt = Number(params.target);
      if (src === tgt) return; // 自己 ループ 禁止
      setSteps((prev) =>
        prev.map((s) => {
          if (s.step_order !== src) return s;
          if (s.action_type === "branch") {
            if (params.sourceHandle === "true") return { ...s, next_step_on_true: tgt };
            if (params.sourceHandle === "false") return { ...s, next_step_on_false: tgt };
          }
          return { ...s, next_step_on_default: tgt };
        }),
      );
      setEdges((eds) => addEdge(params, eds));
    },
    [isAdmin, setEdges],
  );

  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    setSelectedOrder(Number(node.id));
  }, []);

  // ── ステップ 追加 / 詳細 編集 ──

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
      position_x: null,
      position_y: null,
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

  const resetLayout = () => {
    if (!isAdmin) return;
    setSteps((prev) => prev.map((s) => ({ ...s, position_x: null, position_y: null })));
  };

  // ── 保存 ──

  const save = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // 1. メタ 情報 PATCH
      const metaRes = await fetch("/api/agency/ma/flows", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: flow.id,
          name: meta.name.trim() || flow.name,
          description: meta.description.trim() || null,
          goal_event_key: meta.goal_event_key.trim() || null,
          allow_reentry: meta.allow_reentry,
          max_send_per_day: meta.max_send_per_day,
          target_segment_id: meta.target_segment_id,
        }),
      });
      if (!metaRes.ok) {
        const body = (await metaRes.json().catch(() => ({}))) as { error?: string };
        setSaveMsg(`メタ 保存 失敗: ${body.error ?? metaRes.status}`);
        return;
      }

      // 2. 現在 の React Flow 上 の 位置 を steps に マージ し PUT
      const posById = new Map(nodes.map((n) => [n.id, n.position]));
      const withPositions = steps.map((s) => {
        const p = posById.get(String(s.step_order));
        return p ? { ...s, position_x: p.x, position_y: p.y } : s;
      });
      const res = await fetch(`/api/agency/ma/flows/${flow.id}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: withPositions }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveMsg(`ステップ 保存 失敗: ${body.error ?? res.status}`);
        return;
      }
      setSaveMsg(`保存 完了 (${new Date().toLocaleTimeString("ja-JP")})`);
    } catch (err) {
      setSaveMsg(`保存 失敗: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedStep = steps.find((s) => s.step_order === selectedOrder) ?? null;
  const allStepOrders = steps.map((s) => s.step_order);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!isAdmin} onClick={addStep}>
            + ステップを追加
          </Button>
          <Button variant="outline" size="sm" disabled={!isAdmin} onClick={resetLayout}>
            レイアウトをリセット
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMetaExpanded((v) => !v)}>
            {metaExpanded ? "▼" : "▶"} Flow の詳細設定
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiImproveOpen(true)}
            disabled={steps.length === 0}
            title={steps.length === 0 ? "ステップがない Flow はレビューできません" : ""}
          >
            <Sparkles className="mr-1 size-3" aria-hidden />
            AI に改善してもらう
          </Button>
          <span className="text-muted-foreground text-xs">
            起動タイミング: {flow.trigger_type} / ステップ: {steps.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && <span className="text-muted-foreground text-xs">{saveMsg}</span>}
          <Button disabled={!isAdmin || saving} onClick={save}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>

      {metaExpanded && (
        <div className="border-border bg-muted/30 space-y-3 rounded border p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="flow-meta-name">名前 *</Label>
              <Input
                id="flow-meta-name"
                value={meta.name}
                disabled={!isAdmin}
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="flow-meta-desc">説明</Label>
              <Input
                id="flow-meta-desc"
                value={meta.description}
                disabled={!isAdmin}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                maxLength={2000}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="flow-meta-goal">達成目標(CV イベント)</Label>
              <Input
                id="flow-meta-goal"
                value={meta.goal_event_key}
                disabled={!isAdmin}
                onChange={(e) => setMeta({ ...meta, goal_event_key: e.target.value })}
                placeholder="meeting_confirmed など"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="flow-meta-segment">対象セグメント</Label>
              <select
                id="flow-meta-segment"
                className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                value={meta.target_segment_id ?? ""}
                disabled={!isAdmin}
                onChange={(e) => setMeta({ ...meta, target_segment_id: e.target.value || null })}
              >
                <option value="">(絞り込みなし)</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="flow-meta-max">1日あたりの送信上限</Label>
              <Input
                id="flow-meta-max"
                type="number"
                min={1}
                value={meta.max_send_per_day ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setMeta({
                    ...meta,
                    max_send_per_day: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="無制限"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="flow-meta-reentry"
              type="checkbox"
              checked={meta.allow_reentry}
              disabled={!isAdmin}
              onChange={(e) => setMeta({ ...meta, allow_reentry: e.target.checked })}
            />
            <Label htmlFor="flow-meta-reentry" className="text-sm">
              一度完了または停止した友だちを、再度対象にする
            </Label>
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[1fr_360px]">
        <div className="border-border rounded border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            deleteKeyCode={["Delete", "Backspace"]}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
              style: { strokeWidth: 2 },
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
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
            tags={tags}
            templates={templates}
          />
        </div>
      </div>

      <div className="text-muted-foreground border-border border-t pt-2 text-[11px]">
        操作: ステップをドラッグして移動 / ハンドルからドラッグして接続 / 選択して Delete で削除 /
        「レイアウトをリセット」で自動配置に戻す
      </div>

      <AiImproveModal open={aiImproveOpen} onOpenChange={setAiImproveOpen} flowId={flow.id} />
    </div>
  );
}
