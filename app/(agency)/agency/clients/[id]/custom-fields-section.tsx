"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CustomFieldDefinition } from "@/lib/custom-fields/types";

type Props = {
  clientId: string;
  definitions: CustomFieldDefinition[];
  initialValues: Record<string, unknown>;
};

/**
 * クライアント詳細のカスタムフィールドセクション。
 *
 * 定義(client_custom_field_definitions)を listing し、各フィールドを type に合わせて
 * 編集可能な入力にする。保存は /api/agency/clients/[id]/custom-fields へまとめて PATCH。
 */
export function CustomFieldsSection({ clientId, definitions, initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initialValues }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (definitions.length === 0) {
    return null;
  }

  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/agency/clients/${clientId}/custom-fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string>;
      };
      if (!res.ok) {
        if (json.details) {
          const msgs = Object.entries(json.details).map(([k, v]) => `${k}: ${v}`);
          throw new Error(msgs.join(", "));
        }
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setMessage("保存しました");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">カスタムフィールド</h2>
        <span className="text-muted-foreground text-xs">{definitions.length} 項目</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {definitions.map((def) => (
          <FieldEditor
            key={def.id}
            def={def}
            value={values[def.key]}
            onChange={(v) => set(def.key, v)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={submitting}>
          {submitting ? "保存中…" : "保存"}
        </Button>
        {message && (
          <span className="text-xs text-emerald-600 dark:text-emerald-300">{message}</span>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-300">{error}</span>}
      </div>
    </Card>
  );
}

type EditorProps = {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
};

function FieldEditor({ def, value, onChange }: EditorProps) {
  const id = `cf-${def.key}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>{def.label}</span>
        {def.isRequired && <span className="text-red-500">*</span>}
        <span className="bg-muted ml-1 rounded px-1 py-0.5 font-mono text-[10px]">{def.key}</span>
      </label>
      {def.fieldType === "text" && (
        <Input
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          maxLength={1000}
        />
      )}
      {def.fieldType === "number" && (
        <Input
          id={id}
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => {
            if (e.target.value === "") onChange(null);
            else {
              const n = Number(e.target.value);
              onChange(Number.isFinite(n) ? n : null);
            }
          }}
        />
      )}
      {def.fieldType === "date" && (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      )}
      {def.fieldType === "select" && (
        <select
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="border-input bg-background w-full rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="">(未選択)</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {def.fieldType === "boolean" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          はい
        </label>
      )}
    </div>
  );
}
