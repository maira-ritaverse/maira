"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Props = { token: string };

/**
 * 公開フォーム本体(認証不要)。
 *
 * 入力 → /api/public/intake-forms/[token] へ POST。
 * 成功時は「お問い合わせを受け付けました」を表示してフォームを隠す。
 * 失敗時は inline エラー(送信者が誤入力を修正できるように)。
 */
export function PublicIntakeForm({ token }: Props) {
  const [name, setName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [prefecture, setPrefecture] = useState("");
  const [desiredLocations, setDesiredLocations] = useState("");
  const [desiredAnnualIncome, setDesiredAnnualIncome] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/intake-forms/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nameKana,
          email,
          phone,
          prefecture,
          desiredLocations,
          desiredAnnualIncome,
          notes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Card className="space-y-2 border-green-200 bg-green-50/50 p-4 text-sm dark:border-green-900 dark:bg-green-950/30">
        <p className="font-medium">お問い合わせを受け付けました。</p>
        <p>担当者よりご連絡いたします。今しばらくお待ちください。</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <form onSubmit={submit} className="space-y-3">
        <Field id="name" label="お名前 *" required>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="山田 太郎"
            required
            maxLength={100}
          />
        </Field>
        <Field id="nameKana" label="お名前(カナ)">
          <Input
            id="nameKana"
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
            placeholder="ヤマダ タロウ"
            maxLength={100}
          />
        </Field>
        <Field id="email" label="メールアドレス *" required>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="taro@example.com"
            required
            maxLength={254}
          />
        </Field>
        <Field id="phone" label="電話番号">
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="090-1234-5678"
            maxLength={20}
          />
        </Field>
        <Field id="prefecture" label="お住まいの都道府県">
          <Input
            id="prefecture"
            value={prefecture}
            onChange={(e) => setPrefecture(e.target.value)}
            placeholder="東京都"
            maxLength={20}
          />
        </Field>
        <Field id="desiredLocations" label="希望勤務地(カンマ区切り)">
          <Input
            id="desiredLocations"
            value={desiredLocations}
            onChange={(e) => setDesiredLocations(e.target.value)}
            placeholder="東京, 神奈川"
            maxLength={500}
          />
        </Field>
        <Field id="desiredAnnualIncome" label="希望年収(万円)">
          <Input
            id="desiredAnnualIncome"
            type="number"
            value={desiredAnnualIncome}
            onChange={(e) => setDesiredAnnualIncome(e.target.value)}
            placeholder="600"
            min={0}
            max={99999}
          />
        </Field>
        <Field id="notes" label="ご相談内容">
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={2000}
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="ご状況、ご希望などをご記入ください"
          />
        </Field>

        {error && <p className="text-destructive text-xs">{error}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? "送信中…" : "送信する"}
        </Button>
        <p className="text-muted-foreground text-xs">
          * は必須項目です。送信いただいた情報はエージェント企業のみが確認できます。
        </p>
      </form>
    </Card>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
