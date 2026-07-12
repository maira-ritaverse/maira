"use client";

/**
 * Flow 一覧の画面。
 *
 * - カードで Flow を表示、状態(有効・停止)を色で区別
 * - 「AI に提案してもらう」で自然文から自動生成
 * - 「新しい Flow」でプリセットから作成
 * - 各カードから編集画面へ遷移
 */
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatUpdatedAtJa, labelForTriggerType } from "@/lib/ma/flow-labels";
import type { FlowListItem } from "@/lib/ma/flow-queries";

import { AiFlowModal } from "./ai-flow-modal";
import { NewFlowModal } from "./new-flow-modal";

// Badge shadcn コンポーネントは未導入なので、この画面用にインラインで用意。
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

export function FlowList({ initialFlows, isAdmin }: Props) {
  const [flows, setFlows] = useState<FlowListItem[]>(initialFlows);
  const [modalOpen, setModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function toggle(flow: FlowListItem, next: boolean) {
    if (!isAdmin) return;
    setBusyId(flow.id);
    setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, is_active: next } : f)));
    const res = await fetch("/api/agency/ma/flows", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: flow.id, is_active: next }),
    });
    if (!res.ok) {
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, is_active: !next } : f)));
    }
    setBusyId(null);
  }

  function handleCreated() {
    setModalOpen(false);
    setAiModalOpen(false);
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
        <Link
          href="/agency/marketing/forms"
          className="text-muted-foreground hover:text-primary rounded border px-3 py-1.5 text-xs"
        >
          フォーム管理
        </Link>
        {isAdmin && (
          <>
            <Button variant="outline" onClick={() => setAiModalOpen(true)}>
              <Sparkles className="mr-1 size-4" aria-hidden />
              AI に提案してもらう
            </Button>
            <Button onClick={() => setModalOpen(true)}>+ 新しい Flow</Button>
          </>
        )}
      </div>

      {flows.length === 0 ? (
        <EmptyState
          title="まだ Flow がありません"
          description={
            isAdmin
              ? "「AI に提案してもらう」または「新しい Flow」から始めてください。"
              : "管理者が作成するとここに表示されます。"
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
                    {flow.is_active ? "動作中" : "停止中"}
                  </Chip>
                </div>
                {flow.description && (
                  <p className="text-muted-foreground line-clamp-2 text-sm">{flow.description}</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between space-y-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Chip>{labelForTriggerType(flow.trigger_type)}</Chip>
                  <Chip>{flow.step_count} ステップ</Chip>
                  {flow.active_subscription_count > 0 && (
                    <Chip>実行中 {flow.active_subscription_count}</Chip>
                  )}
                  {flow.origin_preset_key && <Chip>プリセット由来</Chip>}
                </div>
                <div className="text-muted-foreground text-xs">
                  最終更新: {formatUpdatedAtJa(flow.updated_at)}
                </div>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Link
                    href={`/agency/marketing/flows/${flow.id}/edit`}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    詳細・編集
                  </Link>
                  {isAdmin && (
                    <Button
                      variant={flow.is_active ? "outline" : "default"}
                      size="sm"
                      disabled={busyId === flow.id}
                      onClick={() => toggle(flow, !flow.is_active)}
                    >
                      {flow.is_active ? "停止する" : "動かす"}
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
