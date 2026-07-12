"use client";

/**
 * Flow 一覧 の Client component。
 *
 * 責務 :
 *   ・初期 フェッチ 済 の Flows を テーブル 形式 で 表示
 *   ・「新規 Flow 作成」 ボタン → NewFlowModal を 開く
 *   ・admin なら 有効化 スイッチ で is_active を PATCH
 *   ・PATCH 成功 後 は 楽観 更新 (エラー 時 は revert)
 */
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { FlowListItem } from "@/lib/ma/flow-queries";

import { AiFlowModal } from "./ai-flow-modal";
import { NewFlowModal } from "./new-flow-modal";

// Badge shadcn コンポーネント は 未 導入 なので、 本 画面 用 に インライン span で 統一。
// Phase 1-F 以降 で 他 画面 と 共用 する 場合 は shadcn add badge を 検討。
function Chip({
  children,
  tone = "outline",
}: {
  children: React.ReactNode;
  tone?: "outline" | "solid" | "muted";
}) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";
  const styles =
    tone === "solid"
      ? "bg-primary text-primary-foreground border-transparent"
      : tone === "muted"
        ? "bg-muted text-muted-foreground border-transparent"
        : "border-border text-foreground";
  return <span className={`${base} ${styles}`}>{children}</span>;
}

type Props = {
  initialFlows: FlowListItem[];
  isAdmin: boolean;
};

const TRIGGER_LABELS: Record<string, string> = {
  friend_added: "友だち追加",
  tag_assigned: "タグ付与",
  tag_removed: "タグ削除",
  segment_matched: "セグメント一致",
  form_submitted: "フォーム送信",
  postback_received: "postback",
  keyword_matched: "キーワード",
  conversion_event: "CV",
  manual: "手動",
};

export function FlowList({ initialFlows, isAdmin }: Props) {
  const [flows, setFlows] = useState<FlowListItem[]>(initialFlows);
  const [modalOpen, setModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function toggle(flow: FlowListItem, next: boolean) {
    if (!isAdmin) return;
    setBusyId(flow.id);
    // 楽観 更新
    setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, is_active: next } : f)));
    const res = await fetch("/api/agency/ma/flows", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: flow.id, is_active: next }),
    });
    if (!res.ok) {
      // revert
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, is_active: !next } : f)));
    }
    setBusyId(null);
  }

  function handleCreated() {
    setModalOpen(false);
    // 一覧 を 再取得
    startTransition(async () => {
      const res = await fetch("/api/agency/ma/flows", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { flows: FlowListItem[] };
        setFlows(json.flows);
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {isAdmin && (
          <>
            <Button variant="outline" onClick={() => setAiModalOpen(true)}>
              <Sparkles className="mr-1 size-4" aria-hidden />
              AI で 生成
            </Button>
            <Button onClick={() => setModalOpen(true)}>+ 新規 Flow 作成</Button>
          </>
        )}
      </div>

      {flows.length === 0 ? (
        <EmptyState
          title="Flow が まだ ありません"
          description={
            isAdmin
              ? "上の 「新規 Flow 作成」 から プリセット を 選ぶ か、 空白 で 作成 してください。"
              : "admin が Flow を 作成 する と ここ に 表示 されます。"
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => (
            <Card key={flow.id} className="flex flex-col">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{flow.name}</CardTitle>
                  <Chip tone={flow.is_active ? "solid" : "muted"}>
                    {flow.is_active ? "有効" : "停止"}
                  </Chip>
                </div>
                {flow.description && (
                  <p className="text-muted-foreground line-clamp-2 text-sm">{flow.description}</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between space-y-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Chip>{TRIGGER_LABELS[flow.trigger_type] ?? flow.trigger_type}</Chip>
                  <Chip>{flow.step_count} ステップ</Chip>
                  {flow.active_subscription_count > 0 && (
                    <Chip>進行中 {flow.active_subscription_count}</Chip>
                  )}
                  {flow.origin_preset_key && <Chip>プリセット由来</Chip>}
                </div>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Link
                    href={`/agency/marketing/flows/${flow.id}/edit`}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    詳細 / 編集
                  </Link>
                  {isAdmin && (
                    <Button
                      variant={flow.is_active ? "outline" : "default"}
                      size="sm"
                      disabled={busyId === flow.id}
                      onClick={() => toggle(flow, !flow.is_active)}
                    >
                      {flow.is_active ? "停止" : "有効化"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <NewFlowModal open={modalOpen} onOpenChange={setModalOpen} onCreated={handleCreated} />
          <AiFlowModal open={aiModalOpen} onOpenChange={setAiModalOpen} onCreated={handleCreated} />
        </>
      )}
    </>
  );
}
