"use client";

/**
 * セグメント 画面 の Client 統合。
 *
 * 責務 :
 *   ・左:セグメント カード 一覧 (name + friend_count_cache)
 *   ・右:選択中 セグメント の 編集 (name / description / condition-builder / 保存)
 *   ・「+ 新規」 で 空 セグメント を 作成 して 編集 状態 に
 *
 * 保存 は POST / PATCH。 filter_dsl_json 更新 時 は サーバー 側 で
 * friend_count_cache も 再計算 される。
 */
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";
import { type SegmentCondition } from "@/lib/ma/segment-dsl";
import type { SegmentListItem } from "@/lib/ma/segment-queries";

import { AiSegmentModal } from "./ai-segment-modal";
import { ConditionEditor } from "./condition-builder";

type Props = {
  initialSegments: SegmentListItem[];
  isAdmin: boolean;
  tags: LineConversationTag[];
};

type EditState = {
  /** 既存 セグメント の 場合 は id、 新規 は null */
  id: string | null;
  name: string;
  description: string;
  root: SegmentCondition;
};

const BLANK_ROOT: SegmentCondition = { kind: "and", conditions: [] };

function toEditState(seg: SegmentListItem): EditState {
  return {
    id: seg.id,
    name: seg.name,
    description: seg.description ?? "",
    root: seg.filter_dsl_json.root,
  };
}

function blankEditState(): EditState {
  return { id: null, name: "", description: "", root: BLANK_ROOT };
}

export function SegmentsScreen({ initialSegments, isAdmin, tags }: Props) {
  const [segments, setSegments] = useState<SegmentListItem[]>(initialSegments);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refetch() {
    startTransition(async () => {
      const res = await fetch("/api/agency/ma/segments", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { segments: SegmentListItem[] };
        setSegments(json.segments);
      }
    });
  }

  async function save() {
    if (!edit || !isAdmin) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const body = {
        name: edit.name,
        description: edit.description || null,
        filter_dsl_json: { root: edit.root },
      };
      const res = edit.id
        ? await fetch("/api/agency/ma/segments", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: edit.id, ...body }),
          })
        : await fetch("/api/agency/ma/segments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveMsg(`保存 失敗: ${err.error ?? res.status}`);
        return;
      }
      const json = (await res.json()) as { id?: string; friend_count_cache?: number | null };
      const savedId = edit.id ?? json.id ?? null;
      setSaveMsg(
        `保存 完了${json.friend_count_cache != null ? ` (${json.friend_count_cache} 人 マッチ)` : ""}`,
      );
      await refetch();
      if (savedId) {
        // 更新 後 に 選択 を 維持
        setEdit((cur) => (cur ? { ...cur, id: savedId } : cur));
      }
    } catch (err) {
      setSaveMsg(`保存 失敗: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      {/* 左:一覧 */}
      <div className="space-y-3">
        {isAdmin && (
          <div className="space-y-2">
            <Button className="w-full" onClick={() => setEdit(blankEditState())}>
              + 新しいセグメント
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setAiModalOpen(true)}>
              <Sparkles className="mr-1 size-4" aria-hidden />
              AI に提案してもらう
            </Button>
          </div>
        )}
        {segments.length === 0 ? (
          <EmptyState
            title="まだセグメントがありません"
            description={
              isAdmin
                ? "「+ 新しいセグメント」から作成してください。"
                : "管理者が作成するとここに表示されます。"
            }
          />
        ) : (
          <div className="space-y-2">
            {segments.map((s) => {
              const isSelected = edit?.id === s.id;
              return (
                <Card
                  key={s.id}
                  className={`cursor-pointer ${isSelected ? "border-primary" : ""}`}
                  onClick={() => setEdit(toEditState(s))}
                >
                  <CardHeader className="py-2">
                    <CardTitle className="text-sm">{s.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="py-2 pt-0">
                    <div className="text-muted-foreground text-xs">
                      {s.friend_count_cache != null ? `${s.friend_count_cache} 人が該当` : "未計算"}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 右:編集 */}
      <div>
        {!edit ? (
          <EmptyState
            title="左の一覧から選択してください"
            description="または「+ 新しいセグメント」で新規作成します。"
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {edit.id ? "セグメントを編集" : "新しいセグメント"}
              </div>
              <div className="flex items-center gap-2">
                {saveMsg && <span className="text-muted-foreground text-xs">{saveMsg}</span>}
                <Button variant="outline" size="sm" onClick={() => setEdit(null)}>
                  閉じる
                </Button>
                <Button disabled={!isAdmin || saving || !edit.name.trim()} onClick={save}>
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="seg-name">名前 *</Label>
                <Input
                  id="seg-name"
                  value={edit.name}
                  disabled={!isAdmin}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="seg-desc">説明(任意)</Label>
                <Input
                  id="seg-desc"
                  value={edit.description}
                  disabled={!isAdmin}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                  maxLength={2000}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>絞り込み条件</Label>
              <ConditionEditor
                condition={edit.root}
                disabled={!isAdmin}
                tags={tags}
                onChange={(next) => setEdit({ ...edit, root: next })}
              />
              <p className="text-muted-foreground text-xs">
                保存すると条件が反映され、該当する人数が再計算されます。
              </p>
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <AiSegmentModal
          open={aiModalOpen}
          onOpenChange={setAiModalOpen}
          onCreated={() => {
            setAiModalOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
