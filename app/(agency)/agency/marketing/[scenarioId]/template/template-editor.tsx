"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_VARIABLES, type TemplateVariable, type TemplateView } from "@/lib/ma/types";

/**
 * テンプレート編集 UI(クライアント側)
 *
 * EMPRO の「Eメールテンプレート編集」を参考にした 2 カラムレイアウト。
 *   左: 件名 + 本文(編集) + プレビュー(本文の生表示)
 *   右: 利用可能な変数パネル(クリックで本文末尾に挿入)
 *
 * 変数展開は raw 文字列のまま保持(送信時に cron 側で実値置換する)。
 * 設計上、プレビューはあくまで「自分の書いた文面が読みやすいか」の確認用なので、
 * 変数はそのまま `{{candidate_name}}` の表示で十分。
 */
type Props = {
  template: TemplateView;
  isAdmin: boolean;
};

const CATEGORY_LABELS: Record<TemplateVariable["category"], string> = {
  candidate: "候補者",
  agent: "担当アドバイザー",
  organization: "自社組織",
  referral: "紹介・選考",
};

export function TemplateEditor({ template, isAdmin }: Props) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body ?? "");
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 変数をクリックしたときに本文側 textarea のカーソル位置に挿入するため、ref を持つ。
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function insertVariable(key: string) {
    if (!isAdmin) return;
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) {
      // ref が取れていなければ末尾に追加(セーフフォールバック)
      setBody((prev) => `${prev}${token}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // 挿入後にキャレットを変数の末尾に移動
    requestAnimationFrame(() => {
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    if (!isAdmin) return;
    setError(null);
    startSave(async () => {
      try {
        const res = await fetch(
          `/api/agency/ma/templates/${encodeURIComponent(template.scenarioId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, body }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(data?.message ?? `保存に失敗しました(${res.status})`);
        }
        // 「保存しました」表示用に時刻を残す。トーストがまだ無いので軽量に。
        setSavedAt(new Date().toLocaleTimeString("ja-JP"));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      }
    });
  }

  // 変数をカテゴリでグルーピング
  const grouped = TEMPLATE_VARIABLES.reduce<Record<string, TemplateVariable[]>>((acc, v) => {
    (acc[v.category] = acc[v.category] || []).push(v);
    return acc;
  }, {});

  const dirty = subject !== (template.subject ?? "") || body !== (template.body ?? "");
  const canSave = isAdmin && dirty && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <>
      {/* ヘッダー */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link href="/agency/marketing" className="hover:underline">
              マーケティング
            </Link>{" "}
            / テンプレート編集
          </p>
          <h1 className="mt-1 text-2xl font-bold">{template.presetName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{template.presetDescription}</p>
        </div>
        <Button variant="outline" render={<Link href="/agency/marketing" />}>
          一覧に戻る
        </Button>
      </div>

      {!isAdmin && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          閲覧のみ可能です。テンプレートの編集は管理者にお問い合わせください。
        </div>
      )}

      {/* 本体: 2 カラム */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
        {/* 左:編集+プレビュー */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">メール文面設定</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="subject">件名</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="メールの件名を入力(例:【{{organization_name}}】面談のご案内)"
                  disabled={!isAdmin}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="body">本文</Label>
                <Textarea
                  id="body"
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="本文を入力。右パネルの変数をクリックすると現在のカーソル位置に挿入されます。"
                  disabled={!isAdmin}
                  rows={14}
                  maxLength={50000}
                  className="font-mono text-sm"
                />
                <p className="text-muted-foreground text-xs">{body.length} / 50000 文字</p>
              </div>

              {error && (
                <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={handleSave} disabled={!canSave || saving}>
                  {saving ? "保存中..." : "変更を保存"}
                </Button>
                <Button variant="outline" render={<Link href="/agency/marketing" />}>
                  キャンセル
                </Button>
                {savedAt && (
                  <span className="text-muted-foreground text-xs">保存しました({savedAt})</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">プレビュー</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-muted-foreground text-xs">
                変数は <code className="font-mono">{`{{...}}`}</code>{" "}
                のまま表示されます。送信時に実値で展開されます。
              </div>
              <div className="bg-muted rounded-md border p-4 text-sm">
                <p className="mb-2 font-semibold">{subject || "(件名未入力)"}</p>
                <pre className="font-sans break-words whitespace-pre-wrap">
                  {body || "(本文未入力)"}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右:利用可能な変数 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">利用可能な変数</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-xs">
              クリックで本文のカーソル位置に挿入されます。
            </p>
            {Object.entries(grouped).map(([category, vars]) => (
              <div key={category} className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-semibold">
                  {CATEGORY_LABELS[category as TemplateVariable["category"]]}
                </p>
                <div className="space-y-1">
                  {vars.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      disabled={!isAdmin}
                      className="hover:bg-accent w-full rounded border px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <code className="text-primary font-mono">{`{{${v.key}}}`}</code>
                      <div className="text-foreground mt-0.5">{v.label}</div>
                      <div className="text-muted-foreground mt-0.5 text-[10px]">
                        {v.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
