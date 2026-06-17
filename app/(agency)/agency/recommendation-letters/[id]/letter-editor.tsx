"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  FileDown,
  FileText,
  PenLine,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  buildRecommendationLetterHtml,
  buildRecommendationLetterPlainText,
} from "@/lib/recommendation-letters/render-html";
import {
  getRecommendationLetterStatusConfig,
  type RecommendationLetter,
  type RecommendationLetterSummary,
  type RecommendationLetterTemplate,
} from "@/lib/recommendation-letters/types";

/**
 * 推薦文編集 UI
 *
 * 構成:
 *   - sticky メタヘッダ:推薦先 / 候補者 / バージョン / ステータス / 保存状態
 *   - プライマリツールバー:AI 生成・テンプレ選択・確定 / 新版作成・PDF・コピー
 *   - 編集ペイン(件名 + 本文 + 適用テンプレの折りたたみ展開)
 *   - プレビューペイン(iframe で PDF と同じ HTML を表示)
 *
 * 自動保存(800ms デバウンス)+ 手動保存 + 確定 + 削除(admin)を備える。
 */

type Props = {
  letter: RecommendationLetter;
  client: { id: string; name: string };
  job: { id: string; companyName: string; position: string };
  organizationName: string;
  templates: RecommendationLetterTemplate[];
  historySummaries: RecommendationLetterSummary[];
  isAdmin: boolean;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

const AUTO_SAVE_DEBOUNCE_MS = 800;

export function LetterEditor({
  letter,
  client,
  job,
  organizationName,
  templates,
  historySummaries,
  isAdmin,
}: Props) {
  const router = useRouter();

  const [headline, setHeadline] = useState(letter.headline);
  const [body, setBody] = useState(letter.body);
  const [templateId, setTemplateId] = useState<string | null>(letter.templateId);
  const [status, setStatus] = useState(letter.status);

  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<{ headline: string; body: string } | null>(null);

  const [isFinalizingOpen, setIsFinalizingOpen] = useState(false);
  const [isDeletingOpen, setIsDeletingOpen] = useState(false);

  const [, startTransition] = useTransition();

  const isFinalized = status === "finalized";
  const statusConfig = getRecommendationLetterStatusConfig(status);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  // === 自動保存(デバウンス) ===
  const lastSavedRef = useRef({
    headline: letter.headline,
    body: letter.body,
    templateId: letter.templateId,
  });
  useEffect(() => {
    if (isFinalized) return;
    const changed =
      headline !== lastSavedRef.current.headline ||
      body !== lastSavedRef.current.body ||
      templateId !== lastSavedRef.current.templateId;
    if (!changed) return;

    const timer = setTimeout(() => {
      void doSave({ silent: true });
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headline, body, templateId]);

  async function doSave(opts: { silent: boolean }) {
    if (isFinalized) return;
    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(`/api/agency/recommendation-letters/${letter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headline, body, template_id: templateId }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(errData.message ?? errData.error ?? "保存に失敗しました");
      }
      lastSavedRef.current = { headline, body, templateId };
      setSaveState({ kind: "saved", at: Date.now() });
      if (!opts.silent) router.refresh();
    } catch (err) {
      setSaveState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  async function handleGenerate() {
    setActionError(null);
    setIsGenerating(true);
    try {
      const res = await fetch("/api/agency/recommendation-letters/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralId: letter.referralId }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          code?: string;
        };
        throw new Error(errData.message ?? errData.error ?? "ドラフト生成に失敗しました");
      }
      const data = (await res.json()) as { headline: string; body: string };
      const hasContent = headline.trim().length > 0 || body.trim().length > 0;
      if (hasContent) {
        setPendingDraft({ headline: data.headline, body: data.body });
      } else {
        applyDraft(data.headline, data.body);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  }

  function applyDraft(newHeadline: string, newBody: string) {
    setHeadline(newHeadline);
    setBody(newBody);
    setPendingDraft(null);
  }

  async function handleFinalize() {
    setActionError(null);
    setIsFinalizingOpen(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agency/recommendation-letters/${letter.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            headline,
            body,
            template_id: templateId,
            status: "finalized",
          }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "確定に失敗しました");
        }
        setStatus("finalized");
        lastSavedRef.current = { headline, body, templateId };
        setSaveState({ kind: "saved", at: Date.now() });
        router.refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  async function handleCreateNewVersion() {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agency/referrals/${letter.referralId}/recommendation-letters`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ headline, body, template_id: templateId }),
          },
        );
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "新バージョン作成に失敗しました");
        }
        const data = (await res.json()) as { letter: RecommendationLetter };
        router.push(`/agency/recommendation-letters/${data.letter.id}`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  async function handleDelete() {
    setActionError(null);
    setIsDeletingOpen(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agency/recommendation-letters/${letter.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "削除に失敗しました");
        }
        router.push(`/agency/clients/${client.id}`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  async function handleCopy() {
    try {
      const text = buildRecommendationLetterPlainText({
        letter: { headline, body },
        template: selectedTemplate,
        recipientCompanyName: job.companyName,
        organizationName,
        documentDate: new Date().toISOString().slice(0, 10),
      });
      await navigator.clipboard.writeText(text);
      setSaveState({ kind: "saved", at: Date.now() });
      setActionError(null);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "クリップボードへのコピーに失敗しました(ブラウザの権限を確認してください)",
      );
    }
  }

  const previewHtml = useMemo(
    () =>
      buildRecommendationLetterHtml({
        letter: { headline, body, version: letter.version, status },
        template: selectedTemplate,
        organizationName,
        recipientCompanyName: job.companyName,
        recipientPosition: job.position,
        documentDate: new Date().toISOString().slice(0, 10),
      }),
    [
      headline,
      body,
      selectedTemplate,
      organizationName,
      job.companyName,
      job.position,
      letter.version,
      status,
    ],
  );

  return (
    <div className="space-y-4">
      {/* ===== sticky メタヘッダ ===== */}
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 -mx-4 border-b backdrop-blur lg:-mx-6">
        <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <Link
                href={`/agency/clients/${client.id}`}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <ArrowLeft className="size-3" />
                {client.name} の詳細へ戻る
              </Link>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold">推薦文の作成</h1>
                <p className="text-muted-foreground text-sm">
                  推薦先 <span className="text-foreground font-medium">{job.companyName}</span>{" "}
                  <span className="text-muted-foreground">/</span> {job.position}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${statusConfig.className}`}
              >
                {isFinalized ? <CheckCircle2 className="size-3" /> : <PenLine className="size-3" />}
                {statusConfig.label} v{letter.version}
              </span>
              {historySummaries.length > 1 && (
                <HistoryDropdown
                  currentLetterId={letter.id}
                  histories={historySummaries}
                  onSelect={(id) => router.push(`/agency/recommendation-letters/${id}`)}
                />
              )}
              <SaveStateIndicator state={saveState} />
            </div>
          </div>

          {/* ===== プライマリツールバー ===== */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating || isFinalized}
              title="キャリア棚卸し + 求人情報から AI でドラフトを生成"
            >
              <Sparkles className="size-4" />
              {isGenerating ? "生成中…" : "AI でドラフト生成"}
            </Button>

            <TemplateSelect
              templates={templates}
              value={templateId}
              onChange={setTemplateId}
              disabled={isFinalized}
            />

            <div className="hidden flex-1 sm:block" />

            <div className="flex flex-wrap items-center gap-2">
              {!isFinalized ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => doSave({ silent: false })}
                    disabled={saveState.kind === "saving"}
                  >
                    <Save className="size-4" />
                    下書き保存
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIsFinalizingOpen(true)}
                    disabled={isGenerating || saveState.kind === "saving"}
                  >
                    <Check className="size-4" />
                    確定する
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" onClick={handleCreateNewVersion}>
                  <PenLine className="size-4" />
                  新バージョンを作成
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                variant="outline"
                render={
                  <a
                    href={`/api/agency/recommendation-letters/${letter.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <FileDown className="size-4" />
                PDF
              </Button>

              <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="size-4" />
                コピー
              </Button>

              {isAdmin && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setIsDeletingOpen(true)}
                  title="この推薦文を削除(管理者のみ)"
                >
                  <Trash2 className="size-4" />
                  削除
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* ===== 編集ペイン + プレビュー(lg 以上で 2 列) ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="letter-headline" className="text-sm font-medium">
              件名
            </Label>
            <input
              id="letter-headline"
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              disabled={isFinalized}
              maxLength={200}
              placeholder="例:山田様(プロダクトマネージャー職)推薦の件"
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="letter-body" className="text-sm font-medium">
                本文
              </Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {body.length.toLocaleString()} / 8,000
              </span>
            </div>
            <textarea
              id="letter-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isFinalized}
              maxLength={8000}
              rows={22}
              placeholder="拝啓 …(本文)… 敬具"
              className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2.5 text-sm leading-7 focus-visible:ring-1 focus-visible:outline-none disabled:opacity-60"
            />
          </div>

          {selectedTemplate && (
            <details className="border-border rounded-md border p-3">
              <summary className="text-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
                <FileText className="size-3.5" />
                適用中テンプレ「{selectedTemplate.name}」の定型句を見る
              </summary>
              <div className="text-muted-foreground mt-3 space-y-3 text-xs">
                <div>
                  <p className="text-foreground mb-1 font-medium">冒頭(prefix)</p>
                  <pre className="bg-muted/40 rounded p-2 text-xs whitespace-pre-wrap">
                    {selectedTemplate.prefixBody || "(空)"}
                  </pre>
                </div>
                <div>
                  <p className="text-foreground mb-1 font-medium">末尾(suffix)</p>
                  <pre className="bg-muted/40 rounded p-2 text-xs whitespace-pre-wrap">
                    {selectedTemplate.suffixBody || "(空)"}
                  </pre>
                </div>
                <p className="text-[11px]">
                  ※ テンプレの定型句は本文に挿入されません。プレビュー / PDF /
                  コピー時に自動連結されます。
                </p>
              </div>
            </details>
          )}

          {templates.length === 0 && (
            <Alert>
              <AlertDescription className="text-xs">
                組織共通テンプレートが未登録です。
                <Link
                  href="/agency/settings/recommendation-letter-templates"
                  className="ml-1 underline"
                >
                  設定 → 推薦文テンプレート
                </Link>{" "}
                で冒頭・末尾の定型句を作成しておくと作成が楽になります。
              </AlertDescription>
            </Alert>
          )}
        </Card>

        {/* プレビュー(A4 を等比縮小して常にカラム幅に収める) */}
        <Card className="overflow-hidden p-0">
          <div className="bg-muted/40 border-border flex items-center justify-between border-b px-4 py-2 text-xs">
            <span className="font-medium">プレビュー</span>
            <span className="text-muted-foreground">PDF と同じ見た目(等比縮小)</span>
          </div>
          <PreviewPane html={previewHtml} />
        </Card>
      </div>

      {/* ===== AI 上書き確認 ===== */}
      <AlertDialog open={pendingDraft !== null} onOpenChange={(o) => !o && setPendingDraft(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>AI ドラフトで上書きしますか?</AlertDialogTitle>
            <AlertDialogDescription>
              現在編集中の本文を破棄して、AI が生成したドラフトに置き換えます。元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDraft && applyDraft(pendingDraft.headline, pendingDraft.body)}
            >
              置き換える
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== 確定確認 ===== */}
      <AlertDialog open={isFinalizingOpen} onOpenChange={setIsFinalizingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この内容で確定しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              確定後はこのバージョンを編集できなくなります。修正したい場合は「新バージョンを作成」してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>確定する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== 削除確認 ===== */}
      <AlertDialog open={isDeletingOpen} onOpenChange={setIsDeletingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この推薦文を削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              v{letter.version} の推薦文を完全に削除します。元に戻せません(管理者操作)。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================
// サブコンポーネント
// ============================================

/**
 * A4 サイズ(96dpi 換算で 794 × 1123 px)で生成された推薦文 HTML を
 * カラム幅に常にフィットさせるプレビューペイン。
 *
 * 親要素の幅を ResizeObserver で監視し、794px を上限として等比 scale を計算する。
 * iframe は内部 DOM 寸法を保ったまま transform: scale で見た目だけ縮小し、
 * wrapper の高さも scale 後の値(1123 * scale)に合わせて固定する。
 *
 * scale が 1 を超えないようにキャップし、画面が広い場合でも原寸表示にとどめる
 * (原寸より拡大すると文字がにじむため)。
 */
function PreviewPane({ html }: { html: string }) {
  const A4_WIDTH = 794;
  const A4_HEIGHT = 1123;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      // 0.1 までは縮める。1 を超えない(等倍が最大)。
      const next = Math.max(0.1, Math.min(1, width / A4_WIDTH));
      setScale(next);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="bg-muted/20 w-full overflow-hidden">
      <div
        // wrapper の見かけ高さも scale に追従させる(余白が出ないように)
        style={{ height: A4_HEIGHT * scale }}
        className="relative"
      >
        <iframe
          title="recommendation-letter-preview"
          srcDoc={html}
          style={{
            width: A4_WIDTH,
            height: A4_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
          }}
          className="absolute top-0 left-0 bg-white shadow-sm"
        />
      </div>
    </div>
  );
}

function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state.kind === "saving") {
    return <span className="text-muted-foreground text-xs">保存中…</span>;
  }
  if (state.kind === "saved") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Check className="size-3" />
        保存済 {formatTime(state.at)}
      </span>
    );
  }
  if (state.kind === "error") {
    return <span className="text-destructive text-xs">保存エラー: {state.message}</span>;
  }
  return <span className="text-muted-foreground text-xs">未保存</span>;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TemplateSelect({
  templates,
  value,
  onChange,
  disabled,
}: {
  templates: RecommendationLetterTemplate[];
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
}) {
  if (templates.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="template-select" className="text-muted-foreground text-xs">
        テンプレ
      </Label>
      <select
        id="template-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="border-input bg-background h-9 rounded-md border px-2 text-xs disabled:opacity-60"
      >
        <option value="">(なし)</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function HistoryDropdown({
  currentLetterId,
  histories,
  onSelect,
}: {
  currentLetterId: string;
  histories: RecommendationLetterSummary[];
  onSelect: (letterId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor="history-select" className="text-muted-foreground text-xs">
        履歴
      </Label>
      <select
        id="history-select"
        value={currentLetterId}
        onChange={(e) => onSelect(e.target.value)}
        className="border-input bg-background h-7 rounded-md border px-2 text-xs"
      >
        {histories.map((h) => (
          <option key={h.id} value={h.id}>
            v{h.version} {h.status === "finalized" ? "(確定)" : "(下書き)"}
          </option>
        ))}
      </select>
    </div>
  );
}
