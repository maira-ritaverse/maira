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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";
import { labelForConversionEvent, type FlowAttributionRow } from "@/lib/ma/flow-attribution";
import { formatUpdatedAtJa, labelForTriggerType } from "@/lib/ma/flow-labels";
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
  attribution: FlowAttributionRow[];
};

/** Flow の 編集 可能 メタ (PATCH で 送る フィールド のみ) */
type FlowMeta = {
  name: string;
  description: string;
  goal_event_key: string;
  allow_reentry: boolean;
  max_send_per_day: number | null;
  target_segment_id: string | null;
  /** trigger_type='keyword_matched' 用 */
  keyword: string;
  keyword_match_mode: "partial" | "exact";
};

const NODE_TYPES = { step: StepNode };

// ────────────────────────────────────────
// steps → ReactFlow node / edge の 変換
// ────────────────────────────────────────

function defaultPosition(index: number): { x: number; y: number } {
  return { x: 60, y: 40 + index * 130 };
}

/**
 * AI 生成 Flow で「本当は送信 / タグ操作をしたかったのに、既存資産が見つからず
 * wait にフォールバックされたステップ」を検出する。
 *
 * action_config に ai_intent が入っていれば、AI は wait ではなく本来別の動作を
 * 意図していた印。実行時に何も起きないので、担当者に修正を促す必要がある。
 */
export function isStepNeedsSetup(step: StepEditable): boolean {
  const cfg = step.action_config ?? {};
  if (step.action_type === "wait" && typeof cfg.ai_intent === "string") return true;
  // send_message なのにテンプレ未割当:CHECK 制約で保存時に落ちるはずだが念のため
  if (step.action_type === "send_message" && !step.template_id) return true;
  // assign_tag / remove_tag なのに tag_id 未指定
  if (
    (step.action_type === "assign_tag" || step.action_type === "remove_tag") &&
    typeof cfg.tag_id !== "string"
  ) {
    return true;
  }
  return false;
}

/** ai_intent キー → 利用者向けの日本語ラベル */
function labelForAiIntent(intent: string): string {
  switch (intent) {
    case "send_message":
      return "メッセージ送信";
    case "assign_tag":
      return "タグ付与";
    case "remove_tag":
      return "タグ削除";
    default:
      return intent;
  }
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
      needsSetup: isStepNeedsSetup(s),
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

export function FlowEditor({ flow, isAdmin, tags, templates, segments, attribution }: Props) {
  const initialSteps = useMemo(() => toEditable(flow.steps), [flow.steps]);
  const [steps, setSteps] = useState<StepEditable[]>(initialSteps);
  const [meta, setMeta] = useState<FlowMeta>({
    name: flow.name,
    description: flow.description ?? "",
    goal_event_key: flow.goal_event_key ?? "",
    allow_reentry: flow.allow_reentry,
    max_send_per_day: flow.max_send_per_day,
    target_segment_id: flow.target_segment_id,
    keyword:
      typeof (flow.trigger_config as { keyword?: unknown }).keyword === "string"
        ? String((flow.trigger_config as { keyword: string }).keyword)
        : "",
    keyword_match_mode:
      (flow.trigger_config as { match_mode?: unknown }).match_mode === "exact"
        ? "exact"
        : "partial",
  });
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [aiImproveOpen, setAiImproveOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(
    initialSteps[0]?.step_order ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const router = useRouter();

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

  /**
   * 矢印が空いているステップを、並び順の次ステップに自動で繋げる。
   *
   * ・非 branch / 非 stop:next_step_on_default が null なら次ステップに
   * ・branch:next_step_on_true / false が片方 null なら次ステップに
   * 既に手動で繋いだ矢印は上書きしない。AI 生成直後の Flow を綺麗に繋ぐ用途。
   */
  const autoConnectMissing = () => {
    if (!isAdmin) return;
    setSteps((prev) => {
      const sorted = [...prev].sort((a, b) => a.step_order - b.step_order);
      const nextByOrder = new Map<number, number>();
      for (let i = 0; i < sorted.length - 1; i++) {
        nextByOrder.set(sorted[i].step_order, sorted[i + 1].step_order);
      }
      return prev.map((s) => {
        const next = nextByOrder.get(s.step_order) ?? null;
        if (next == null) return s;
        if (s.action_type === "stop") return s;
        if (s.action_type === "branch") {
          return {
            ...s,
            next_step_on_true: s.next_step_on_true ?? next,
            next_step_on_false: s.next_step_on_false ?? next,
          };
        }
        return {
          ...s,
          next_step_on_default: s.next_step_on_default ?? next,
        };
      });
    });
    setSaveMsg("空いている矢印を並び順で繋ぎました。「保存」で確定します。");
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
          // 起動条件が keyword_matched のときだけ trigger_config を上書き。
          // 他の trigger_type ではプリセット由来の trigger_config を保持したいので
          // undefined を渡す(PATCH は provided fields のみ更新)。
          trigger_config:
            flow.trigger_type === "keyword_matched"
              ? {
                  keyword: meta.keyword.trim(),
                  match_mode: meta.keyword_match_mode,
                }
              : undefined,
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
        setSaveMsg(`ステップの保存に失敗: ${body.error ?? res.status}`);
        return;
      }
      setSaveMsg(`保存しました (${new Date().toLocaleTimeString("ja-JP")})`);
    } catch (err) {
      setSaveMsg(`保存に失敗: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedStep = steps.find((s) => s.step_order === selectedOrder) ?? null;
  const allStepOrders = steps.map((s) => s.step_order);
  const needsSetupSteps = steps.filter(isStepNeedsSetup);

  return (
    <div className="flex h-full flex-col gap-3">
      {needsSetupSteps.length > 0 && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 font-semibold">
            未設定のステップが {needsSetupSteps.length} 件あります。このままだと動きません。
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-xs">
            {needsSetupSteps.map((s) => (
              <li key={s.step_order}>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-amber-950"
                  onClick={() => setSelectedOrder(s.step_order)}
                >
                  ステップ {s.step_order}: {s.name ?? "(名前なし)"}
                </button>
                {typeof s.action_config?.ai_intent === "string" &&
                  ` — 本来は「${labelForAiIntent(s.action_config.ai_intent)}」の予定`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!isAdmin} onClick={addStep}>
            + ステップを追加
          </Button>
          <Button variant="outline" size="sm" disabled={!isAdmin} onClick={resetLayout}>
            レイアウトをリセット
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!isAdmin || steps.length < 2}
            onClick={autoConnectMissing}
            title="矢印が繋がっていないステップを、並び順の次ステップに自動で繋げます"
          >
            矢印を自動接続
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
            起動タイミング: {labelForTriggerType(flow.trigger_type)} / ステップ: {steps.length}
            {flow.updated_at && ` / 最終更新: ${formatUpdatedAtJa(flow.updated_at)}`}
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

          {flow.trigger_type === "keyword_matched" && (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="mb-2 text-sm font-medium text-emerald-900">キーワード応答の設定</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="flow-meta-keyword">反応するキーワード</Label>
                  <Input
                    id="flow-meta-keyword"
                    value={meta.keyword}
                    disabled={!isAdmin}
                    onChange={(e) => setMeta({ ...meta, keyword: e.target.value })}
                    placeholder="求人 / 面接 / 相談 など"
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="flow-meta-match-mode">照合方法</Label>
                  <select
                    id="flow-meta-match-mode"
                    className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                    value={meta.keyword_match_mode}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setMeta({
                        ...meta,
                        keyword_match_mode: e.target.value === "exact" ? "exact" : "partial",
                      })
                    }
                  >
                    <option value="partial">部分一致(メッセージに含まれれば反応)</option>
                    <option value="exact">完全一致(メッセージ全体がキーワードと同一)</option>
                  </select>
                </div>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                大文字・小文字は無視されます。キーワードを空にすると Flow は反応しません。
              </p>
            </div>
          )}

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
                <option value="">絞り込みなし(起動条件を満たす全員に届く)</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.friend_count_cache != null ? ` (現在 ${s.friend_count_cache}人)` : ""}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                {(() => {
                  if (!meta.target_segment_id) {
                    return "起動条件を満たした人 全員 に届きます。";
                  }
                  const seg = segments.find((s) => s.id === meta.target_segment_id);
                  if (!seg) return "選んだセグメントを条件として使います。";
                  const count = seg.friend_count_cache;
                  return count != null
                    ? `現在 ${count}人 が「${seg.name}」に該当します。この人たちだけに届きます。`
                    : `「${seg.name}」に該当する人だけに届きます(人数は未計算)。`;
                })()}
              </p>
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

          {/* CV attribution:この Flow が貢献した目標達成の件数 */}
          <div className="border-border rounded border bg-white p-3">
            <div className="mb-2 text-sm font-medium">この Flow が貢献した目標達成</div>
            {attribution.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                まだ集計対象の目標達成イベントがありません。応募・面接・内定などが記録されると、この
                Flow が関わっていた場合にここに反映されます(過去 30 日以内の関与を集計)。
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-1 font-normal">目標</th>
                    <th
                      className="py-1 pr-2 text-right font-normal"
                      title="この Flow が最後に到達した後に発生した件数(直接寄与)"
                    >
                      直接寄与
                    </th>
                    <th
                      className="py-1 text-right font-normal"
                      title="この Flow が過去 30 日以内に関与した件数(間接寄与を含む)"
                    >
                      関与
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((a) => (
                    <tr key={a.event_key} className="border-b last:border-none">
                      <td className="py-1">{labelForConversionEvent(a.event_key)}</td>
                      <td className="py-1 pr-2 text-right font-mono">{a.last_touch_count}</td>
                      <td className="py-1 text-right font-mono">{a.any_touch_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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

      <AiImproveModal
        open={aiImproveOpen}
        onOpenChange={setAiImproveOpen}
        flowId={flow.id}
        onApplied={() => {
          setSaveMsg("AI の改善提案を反映しました");
          router.refresh();
        }}
      />
    </div>
  );
}
