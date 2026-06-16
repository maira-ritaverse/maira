"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type CustomFieldDefinition, type CustomFieldType } from "@/lib/custom-fields/types";

type Props = {
  initialFields: CustomFieldDefinition[];
};

const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "テキスト",
  number: "数値",
  date: "日付",
  select: "選択",
  boolean: "Yes/No",
};

export function CustomFieldsManager({ initialFields }: Props) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>(initialFields);
  const [showCreate, setShowCreate] = useState(false);

  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [displayOrder, setDisplayOrder] = useState("0");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => {
    setKey("");
    setLabel("");
    setFieldType("text");
    setOptionsText("");
    setIsRequired(false);
    setDisplayOrder("0");
  };

  const create = async () => {
    if (!key.trim() || !label.trim()) {
      setError("key と ラベル を入力してください");
      return;
    }
    const options =
      fieldType === "select"
        ? optionsText
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "")
        : [];
    if (fieldType === "select" && options.length === 0) {
      setError("select 型は選択肢を 1 つ以上入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/agency/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          label,
          fieldType,
          options,
          isRequired,
          displayOrder: Number(displayOrder) || 0,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        field?: CustomFieldDefinition;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.field) setFields((prev) => [...prev, json.field!]);
      setShowCreate(false);
      reset();
      setMessage("作成しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (f: CustomFieldDefinition) => {
    if (
      !confirm(
        `「${f.label}」(${f.key})を削除しますか?\n顧客レコード内の値はそのまま残ります(再追加すれば復活)。`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/agency/custom-fields/${f.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFields((prev) => prev.filter((x) => x.id !== f.id));
      setMessage(`「${f.label}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    }
  };

  const toggleRequired = async (f: CustomFieldDefinition) => {
    setError(null);
    try {
      const res = await fetch(`/api/agency/custom-fields/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRequired: !f.isRequired }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFields((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, isRequired: !f.isRequired } : x)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{fields.length} 件</span>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={showCreate}>
          + 新規フィールド
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {message && <div className="text-xs text-emerald-600 dark:text-emerald-300">{message}</div>}

      {showCreate && (
        <Card className="space-y-2 p-3">
          <h3 className="text-sm font-medium">新規フィールド</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Input
              placeholder="key(例:lead_source、英小文字+数字+_)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={50}
            />
            <Input
              placeholder="表示ラベル(例:獲得経路)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-muted-foreground text-xs">タイプ:</label>
            <select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
              className="border-input bg-background rounded-lg border px-2 py-1 text-sm"
            >
              {(Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="text-muted-foreground flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              必須
            </label>
            <label className="text-muted-foreground text-xs">表示順:</label>
            <Input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              className="w-20"
              min={0}
              max={9999}
            />
          </div>
          {fieldType === "select" && (
            <Input
              placeholder="選択肢(カンマ区切り。例:HP, リクナビ, ビズリーチ)"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={submitting}>
              {submitting ? "作成中…" : "作成"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                reset();
                setError(null);
              }}
            >
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      <ul className="space-y-2">
        {fields.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            まだフィールドがありません
          </li>
        )}
        {fields.map((f) => (
          <li key={f.id}>
            <Card className="space-y-1 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{f.label}</span>
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                      {f.key}
                    </span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      {FIELD_TYPE_LABEL[f.fieldType]}
                    </span>
                    {f.isRequired && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                        必須
                      </span>
                    )}
                    <span className="text-muted-foreground text-[10px]">
                      表示順 {f.displayOrder}
                    </span>
                  </div>
                  {f.fieldType === "select" && f.options.length > 0 && (
                    <div className="text-muted-foreground mt-1 text-xs">
                      選択肢:{f.options.join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => toggleRequired(f)}>
                    必須切替
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(f)}>
                    削除
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
