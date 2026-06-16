"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  applicationId: string;
};

type CustomizationResponse = {
  applicationId: string;
  overrides: {
    motivation_note?: string;
    self_pr?: string;
    cv_self_pr?: string;
    notes?: string;
  };
  baseResumeId: string | null;
  baseCvId: string | null;
  updatedAt: string | null;
};

type GenerateResponse = {
  ok: boolean;
  generated: {
    resume_self_pr: string;
    cv_self_pr: string;
    motivation_note: string;
  };
};

/**
 * 応募ごとの PR カスタマイズセクション(求職者本人向け)。
 *
 * 機能:
 *   - 履歴書用自己PR / 職務経歴書用自己PR / 志望動機 / 自分メモ の差し替えを保存
 *   - 「AI で求人特化版を生成」ボタンで 3 項目を 1 ショット生成 → ドラフトとして
 *     右側プレビューに並べ、「採用」で本欄に反映、「破棄」でドラフト破棄
 *   - JD を貼り付ける欄(任意)を出して生成精度を上げる
 *
 * 保存先 API は既存の /api/applications/[id]/pr-customization(暗号化保存)。
 * 生成 API は /api/applications/[id]/pr-customization/generate(保存はしない)。
 */
export function PrCustomizationSection({ applicationId }: Props) {
  const [motivationNote, setMotivationNote] = useState("");
  const [selfPr, setSelfPr] = useState("");
  const [cvSelfPr, setCvSelfPr] = useState("");
  const [notes, setNotes] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI 生成用の追加 JD(任意)とドラフト保管
  const [jdExtra, setJdExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<GenerateResponse["generated"] | null>(null);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void (async () => {
      try {
        const res = await apiFetch<CustomizationResponse>(
          `/api/applications/${applicationId}/pr-customization`,
        );
        if (res) {
          setMotivationNote(res.overrides.motivation_note ?? "");
          setSelfPr(res.overrides.self_pr ?? "");
          setCvSelfPr(res.overrides.cv_self_pr ?? "");
          setNotes(res.overrides.notes ?? "");
          setUpdatedAt(res.updatedAt);
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [applicationId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/applications/${applicationId}/pr-customization`, {
        method: "PUT",
        json: {
          overrides: {
            motivation_note: motivationNote || undefined,
            self_pr: selfPr || undefined,
            cv_self_pr: cvSelfPr || undefined,
            notes: notes || undefined,
          },
        },
      });
      setSuccess("保存しました");
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("この応募のカスタマイズを削除しますか?")) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/applications/${applicationId}/pr-customization`, {
        method: "DELETE",
      });
      setMotivationNote("");
      setSelfPr("");
      setCvSelfPr("");
      setNotes("");
      setUpdatedAt(null);
      setSuccess("カスタマイズを削除しました");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // AI 生成:結果は draft に置き、ユーザが「採用」したら本欄に反映する
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<GenerateResponse>(
        `/api/applications/${applicationId}/pr-customization/generate`,
        {
          method: "POST",
          json: { jdExtra: jdExtra || null },
        },
      );
      if (res?.generated) {
        setDraft(res.generated);
        setSuccess("AI が下書きを作成しました。下のプレビューで採用するか確認してください。");
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  // 「すべて採用」:3 項目を本欄に流し込み(保存はしない)
  const adoptAll = () => {
    if (!draft) return;
    setSelfPr(draft.resume_self_pr);
    setCvSelfPr(draft.cv_self_pr);
    setMotivationNote(draft.motivation_note);
    setDraft(null);
    setSuccess("ドラフトを反映しました。内容を確認して「保存」してください。");
  };

  // 個別採用ヘルパ
  const adoptOne = (key: "resume_self_pr" | "cv_self_pr" | "motivation_note") => {
    if (!draft) return;
    if (key === "resume_self_pr") setSelfPr(draft.resume_self_pr);
    if (key === "cv_self_pr") setCvSelfPr(draft.cv_self_pr);
    if (key === "motivation_note") setMotivationNote(draft.motivation_note);
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">この応募の PR カスタマイズ</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          履歴書 /
          職務経歴書のベース内容に対して、この応募だけ差し替える志望動機・自己PRを保存できます。
          空欄の項目はベースの値をそのまま使います。
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-xs">読み込み中…</p>
      ) : (
        <>
          {/* === AI 生成ブロック === */}
          <div className="border-primary/40 bg-primary/5 space-y-2 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">AI でこの求人向けに 3 つ同時生成</p>
                <p className="text-muted-foreground text-[11px]">
                  キャリア棚卸し + 応募の企業 / 職種 + 任意の JD から、 履歴書用 /
                  職務経歴書用の自己PR と志望動機の下書きを 1 回でまとめて作ります。
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={generating || saving}
              >
                {generating ? "生成中…" : "AI で生成"}
              </Button>
            </div>
            <Textarea
              value={jdExtra}
              onChange={(e) => setJdExtra(e.target.value)}
              rows={3}
              maxLength={20000}
              placeholder="(任意)求人 JD の全文をここに貼ると、より精度が上がります"
              disabled={generating || saving}
            />
          </div>

          {/* === ドラフトプレビュー === */}
          {draft && (
            <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">AI ドラフト(未保存)</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                    破棄
                  </Button>
                  <Button size="sm" onClick={adoptAll}>
                    すべて採用して下に反映
                  </Button>
                </div>
              </div>
              <DraftPreview
                label="履歴書用 自己PR"
                text={draft.resume_self_pr}
                onAdopt={() => adoptOne("resume_self_pr")}
              />
              <DraftPreview
                label="職務経歴書用 自己PR"
                text={draft.cv_self_pr}
                onAdopt={() => adoptOne("cv_self_pr")}
              />
              <DraftPreview
                label="志望動機"
                text={draft.motivation_note}
                onAdopt={() => adoptOne("motivation_note")}
              />
              <p className="text-muted-foreground text-[11px]">
                「採用」で下のフォーム欄に流し込みます。保存はその後、最下部の「保存」ボタンで行います。
              </p>
            </div>
          )}

          {/* === 入力欄(本体) === */}
          <div className="space-y-1">
            <Label htmlFor="motivation_note">志望動機(この応募用)</Label>
            <Textarea
              id="motivation_note"
              value={motivationNote}
              onChange={(e) => setMotivationNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="この企業ならではの志望動機。AI 生成ボタンで下書き作成も可能。"
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="self_pr">自己PR(履歴書用)</Label>
            <Textarea
              id="self_pr"
              value={selfPr}
              onChange={(e) => setSelfPr(e.target.value)}
              rows={4}
              maxLength={3000}
              placeholder="求人内容に合わせた強みのアピール(履歴書側)"
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cv_self_pr">自己PR(職務経歴書用)</Label>
            <Textarea
              id="cv_self_pr"
              value={cvSelfPr}
              onChange={(e) => setCvSelfPr(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="職務経歴書末尾に置く自己PR(具体エピソード込み)"
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">メモ(自分用)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="面接で話したいエピソードなど"
              disabled={saving}
            />
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}
          {success && <p className="text-xs text-emerald-700 dark:text-emerald-300">{success}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-[11px]">
              {updatedAt ? `最終更新:${new Date(updatedAt).toLocaleString("ja-JP")}` : "未保存"}
            </p>
            <div className="flex gap-2">
              {updatedAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleClear()}
                  disabled={saving}
                >
                  カスタマイズを削除
                </Button>
              )}
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * 1 セクション分のドラフトプレビュー(ラベル + 本文 + 「採用」ボタン)。
 * 折りたたみは付けない(短いので 1 画面に並ぶ)。
 */
function DraftPreview({
  label,
  text,
  onAdopt,
}: {
  label: string;
  text: string;
  onAdopt: () => void;
}) {
  return (
    <div className="space-y-1 rounded border border-emerald-200 bg-white p-2 dark:border-emerald-900 dark:bg-emerald-950/50">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{label}</p>
        <Button size="sm" variant="outline" onClick={onAdopt}>
          採用
        </Button>
      </div>
      <p className="text-xs leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
