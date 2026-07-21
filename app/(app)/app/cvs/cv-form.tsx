"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AIActionButton } from "@/components/features/cv/ai-action-button";
import {
  employmentTypeLabels,
  employmentTypes,
  saveCvRequestSchema,
  skillCategories,
  skillCategoryLabels,
  skillLevelLabels,
  skillLevels,
  type Cv,
  type PeriodPoint,
  type SaveCvRequest,
  type Skill,
  type WorkExperience,
} from "@/lib/cvs/types";

/**
 * 職務経歴書 新規 / 編集 フォーム(共通)
 *
 * - 必須は title だけ(他は下書き保存可)。事実(会社名)は WorkExperience 単位で必須
 * - 職務経歴・スキルは useFieldArray で動的に行追加
 * - 期間({year, month})は PeriodInput で「両方入って初めて確定」
 * - mode="create" → POST /api/cvs、成功で /app/cvs/[id] へ
 * - mode="edit"   → PATCH /api/cvs/[id]、成功はフォームに留まる
 * - mode="edit" のみ「削除」ボタンを表示(window.confirm の二段ガード)
 *
 * Phase 1 では AI下書き / プレビュー / PDF は無し。Phase 2 以降で追加。
 *
 * Phase 4-c でスキル候補生成、4-d で全項目に AI 下書きボタンを追加:
 * - 職務要約 / 自己PR / 各職歴(行ごと)/ スキル候補 の 4 種類のボタン
 * - 共通ボタン:components/features/cv/ai-action-button.tsx
 * - 連打防止:draftingField を 1 つの union state で管理(同時実行は 1 件まで)
 * - hasCareerProfile が false なら全ボタン無効化 + 棚卸し導線
 * - 会社名未入力の職歴行はボタン無効化(API 側でも弾くが、UX のため client でも判定)
 * - 既存入力がある項目で生成する時は window.confirm で上書き確認
 * - エラー表示はフォーム上部の draftError Alert に集約
 */

type ResumeOption = { id: string; title: string };

type Props = (
  | {
      mode: "create";
      existing?: undefined;
      resumeOptions: ResumeOption[];
    }
  | {
      mode: "edit";
      existing: Cv;
      resumeOptions: ResumeOption[];
    }
) & {
  // このユーザーの career_profile が存在するか。AI ボタンを有効化するかの判定。
  // 4-c 時点ではスキル候補生成のみで使うが、4-d で全 AI ボタンが共通して使う。
  hasCareerProfile: boolean;
};

/**
 * 現在生成中の AI 下書きフィールドを表す union(Phase 4-d、連打防止)。
 *
 * - "summary" / "self_pr" / "skills": トップレベルの単一フィールド
 * - { type: "work_experience"; index }: 各職歴(行ごと)
 * - null: 何も動いていない
 *
 * draftingField が非 null の間、他のすべての AI ボタンは無効化される。
 */
type DraftingField =
  | "summary"
  | "self_pr"
  | { type: "work_experience"; index: number }
  | "skills"
  | null;

/**
 * draftingField が「特定のフィールド」と一致するか判定するヘルパー。
 *
 * 文字列フィールド("summary" 等)と work_experience({type, index})の両方に対応。
 */
function isFieldDrafting(current: DraftingField, target: Exclude<DraftingField, null>): boolean {
  if (current === null) return false;
  if (typeof current === "string" && typeof target === "string") {
    return current === target;
  }
  if (typeof current === "object" && typeof target === "object") {
    return current.type === target.type && current.index === target.index;
  }
  return false;
}

// 年月は数値入力欄で直接入力する(旧: 年月 select 用の YEAR_OPTIONS/MONTH_OPTIONS は廃止)

export function CvForm(props: Props) {
  const { mode, resumeOptions, hasCareerProfile } = props;
  const existing = mode === "edit" ? props.existing : undefined;

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // AI 下書き / 候補生成 用 state(Phase 4-d で統一)
  // - draftingField: 現在生成中のフィールド。null = 何も動いていない
  //   "summary" / "self_pr" / { type: "work_experience", index } / "skills"
  //   いずれか 1 つに限定することで連打防止(同時に複数の AI 生成は走らせない)。
  // - draftError: API エラーの文言(no_career_profile / 通信エラー等を共通表示)
  // - skillCandidates / selectedSkillCandidates: スキル候補パネル用(Phase 4-c)
  const [draftingField, setDraftingField] = useState<DraftingField>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<Skill[] | null>(null);
  const [selectedSkillCandidates, setSelectedSkillCandidates] = useState<Set<number>>(new Set());

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<SaveCvRequest>({
    resolver: zodResolver(saveCvRequestSchema),
    defaultValues: buildDefaultValues(existing),
  });

  const workExperiencesArray = useFieldArray({
    control,
    name: "body.work_experiences",
  });

  const skillsArray = useFieldArray({
    control,
    name: "body.skills",
  });

  // 各職歴行の company_name を購読(会社名未入力なら AI ボタンを disabled にするため)。
  // useWatch は購読対象の path 変更時のみ再レンダーを起こすので、
  // 他フィールド(title 等)の編集では再レンダーされない。
  // 全行を一括で watch することで、行追加・削除にも追従する。
  const workExperiencesWatch = useWatch({
    control,
    name: "body.work_experiences",
  });

  const isAnyDrafting = draftingField !== null;

  /**
   * AI エラーレスポンスを共通の文言に変換する(Phase 4-d で共通化)。
   *
   * no_career_profile のとき:棚卸しへの導線を示す文言
   * その他:API が返したメッセージ、無ければ汎用文言
   */
  const messageFromErrorResponse = (json: {
    message?: string;
    error?: string;
    code?: string;
  }): string => {
    if (json.code === "no_career_profile") {
      return "先にキャリア棚卸しを完了してください。棚卸し結果を元に AI が下書きを作成します。";
    }
    return json.message ?? json.error ?? "AI 生成に失敗しました";
  };

  /**
   * 職務要約の AI 下書きを生成して setValue する(Phase 4-d)。
   * 既存入力があれば確認(履歴書 draft と同じパターン)。
   */
  const handleGenerateSummary = async () => {
    const current = (getValues("body.summary") ?? "").trim();
    if (current.length > 0) {
      const ok = window.confirm(
        "「職務要約」には既に入力があります。AIの下書きで上書きしてもよろしいですか?\n\n(現在の入力は失われます)",
      );
      if (!ok) return;
    }
    setDraftError(null);
    setDraftingField("summary");
    try {
      const response = await fetch("/api/cvs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "summary" }),
      });
      const json = (await response.json()) as {
        content?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setDraftError(messageFromErrorResponse(json));
        return;
      }
      if (json.content) {
        setValue("body.summary", json.content, { shouldDirty: true });
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDraftingField(null);
    }
  };

  /**
   * 自己PR の AI 下書きを生成して setValue する(Phase 4-d)。
   */
  const handleGenerateSelfPr = async () => {
    const current = (getValues("body.self_pr") ?? "").trim();
    if (current.length > 0) {
      const ok = window.confirm(
        "「自己PR」には既に入力があります。AIの下書きで上書きしてもよろしいですか?\n\n(現在の入力は失われます)",
      );
      if (!ok) return;
    }
    setDraftError(null);
    setDraftingField("self_pr");
    try {
      const response = await fetch("/api/cvs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "self_pr" }),
      });
      const json = (await response.json()) as {
        content?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setDraftError(messageFromErrorResponse(json));
        return;
      }
      if (json.content) {
        setValue("body.self_pr", json.content, { shouldDirty: true });
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDraftingField(null);
    }
  };

  /**
   * 特定の職歴行の業務内容・実績を AI 生成して setValue する(Phase 4-d)。
   *
   * - 会社名が空なら何もしない(クライアント側ガード。API でも 400 を返す)
   * - 既存入力(job_description or achievements)があれば確認
   * - レスポンスの content は { job_description, achievements } の構造化データ。
   *   API は index を echo するが、クライアントは closure の index を使う
   *   (生成中に行を並べ替えるレースを避ける、resume-form と同じ方針)
   */
  const handleGenerateWorkExperience = async (index: number) => {
    const we = getValues(`body.work_experiences.${index}`) as WorkExperience | undefined;
    if (!we) return;
    if (!we.company_name?.trim()) {
      setDraftError("会社名を入力してから AI 下書きを生成してください");
      return;
    }
    const hasExisting =
      (we.job_description ?? "").trim().length > 0 || (we.achievements ?? "").trim().length > 0;
    if (hasExisting) {
      const ok = window.confirm(
        `「職歴 ${index + 1}」の業務内容・実績には既に入力があります。AIの下書きで上書きしてもよろしいですか?\n\n(現在の入力は失われます)`,
      );
      if (!ok) return;
    }
    setDraftError(null);
    setDraftingField({ type: "work_experience", index });
    try {
      const response = await fetch("/api/cvs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "work_experience",
          workExperience: we,
          index,
        }),
      });
      const json = (await response.json()) as {
        content?: { job_description?: string; achievements?: string };
        message?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setDraftError(messageFromErrorResponse(json));
        return;
      }
      if (json.content) {
        setValue(
          `body.work_experiences.${index}.job_description`,
          json.content.job_description ?? "",
          { shouldDirty: true },
        );
        setValue(`body.work_experiences.${index}.achievements`, json.content.achievements ?? "", {
          shouldDirty: true,
        });
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDraftingField(null);
    }
  };

  /**
   * スキル候補を API から取得する(Phase 4-c → 4-d で draftingField に乗せ替え)。
   *
   * 取得後はパネルを開いた状態にする(skillCandidates が配列なら表示)。
   * 連打防止は draftingField === "skills" の間、他ボタンを disabled にすることで実現。
   * エラーは draftError(共通)に詰めて、フォーム上部の Alert で表示する。
   */
  const handleFetchSkillCandidates = async () => {
    setDraftError(null);
    setDraftingField("skills");
    try {
      const response = await fetch("/api/cvs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "skills" }),
      });

      const json = (await response.json()) as {
        candidates?: Skill[];
        message?: string;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        setDraftError(messageFromErrorResponse(json));
        return;
      }

      // 候補が空でもパネルは開く(「候補が見つかりませんでした」の案内のため)
      setSkillCandidates(json.candidates ?? []);
      // 取得し直したら選択状態はリセット(以前のチェックは残さない)
      setSelectedSkillCandidates(new Set());
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDraftingField(null);
    }
  };

  /**
   * 選んだ候補を skills(useFieldArray)に追加する。
   *
   * 既に同名スキルがフォームに存在する場合は、重複登録を避けるためスキップする
   * (大文字小文字・前後空白を無視して比較)。
   * 追加後はパネルを閉じる(skillCandidates=null、selected=空)。
   */
  const handleAddSelectedSkillCandidates = () => {
    if (!skillCandidates) return;

    // 既存スキルの正規化名 Set(O(N) でルックアップしたいので Set に詰める)。
    // getValues で最新値を取る(register でユーザーが手入力した直後でも反映される)。
    const existingNames = new Set(
      (getValues("body.skills") ?? []).map((s) => normalizeSkillName(s.name)),
    );

    skillCandidates.forEach((candidate, idx) => {
      if (!selectedSkillCandidates.has(idx)) return;
      if (existingNames.has(normalizeSkillName(candidate.name))) return;
      skillsArray.append({
        category: candidate.category,
        name: candidate.name,
        level: candidate.level,
        description: candidate.description,
      });
      // 連続追加で同じ AI 候補内の重複も避ける
      existingNames.add(normalizeSkillName(candidate.name));
    });

    setSkillCandidates(null);
    setSelectedSkillCandidates(new Set());
  };

  const toggleSkillCandidate = (idx: number) => {
    setSelectedSkillCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const onSubmit = (data: SaveCvRequest) => {
    startTransition(async () => {
      setServerError(null);
      setSaveMessage(null);
      try {
        const url = mode === "create" ? "/api/cvs" : `/api/cvs/${existing!.id}`;
        const method = mode === "create" ? "POST" : "PATCH";

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errData = (await response.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "Save failed");
        }

        if (mode === "create") {
          const result = (await response.json()) as { id: string };
          router.push(`/app/cvs/${result.id}`);
        } else {
          setSaveMessage("保存しました");
          router.refresh();
        }
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const handleDelete = async () => {
    if (mode !== "edit") return;
    const ok = window.confirm(
      `「${existing!.title}」を削除しますか?\n\nこの操作は取り消せません。`,
    );
    if (!ok) return;

    setIsDeleting(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/cvs/${existing!.id}`, { method: "DELETE" });
      if (!response.ok) {
        const errData = (await response.json()) as { error?: string; message?: string };
        throw new Error(errData.message ?? errData.error ?? "Delete failed");
      }
      router.push("/app/cvs");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Unknown error");
      setIsDeleting(false);
    }
  };

  const noResumes = resumeOptions.length === 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {serverError}</AlertDescription>
        </Alert>
      )}
      {saveMessage && (
        <Alert>
          <AlertDescription>{saveMessage}</AlertDescription>
        </Alert>
      )}
      {draftError && (
        <Alert variant="destructive">
          <AlertDescription>AI生成エラー: {draftError}</AlertDescription>
        </Alert>
      )}
      {/* AI 下書き使用時の注意喚起(履歴書フォームと同じトーン)。
          career_profile が無いとどのみち全 AI ボタンが無効化されるので、
          有効化されているときだけ案内文を出してフォーム上部の情報量を抑える。 */}
      {hasCareerProfile && (
        <p className="text-muted-foreground text-xs">
          ✨マーク付きボタンの下書きは AI が生成します。内容は必ずご自身で確認・編集してください。
        </p>
      )}

      {/* ============================================ */}
      {/* セクション1:基本情報                         */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">基本情報</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            必須はタイトルのみ。他は途中まで入力して保存できます(下書き)
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-2">
            <Label htmlFor="title">
              タイトル(管理用) <span className="text-red-600">*</span>
            </Label>
            <Input
              id="title"
              {...register("title")}
              disabled={isPending}
              placeholder="例:汎用、○○社向け など"
            />
            {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="document_date">作成日</Label>
            <Input
              id="document_date"
              type="date"
              {...register("document_date")}
              disabled={isPending}
            />
            <p className="text-muted-foreground text-xs">
              未入力の場合は表示時点の本日の日付になります
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="license_resume_id">資格を引いてくる履歴書</Label>
          <select
            id="license_resume_id"
            {...register("license_resume_id", { setValueAs: emptyToNullString })}
            disabled={isPending || noResumes}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">— 選択しない —</option>
            {resumeOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          {noResumes ? (
            <p className="text-muted-foreground text-xs">
              履歴書が未登録です。後から{" "}
              <Link href="/app/resumes" className="underline hover:no-underline">
                履歴書
              </Link>{" "}
              を作成すれば参照できます。
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              選んだ履歴書の免許・資格欄を職務経歴書に引き継ぎます(プレビュー/PDF 表示時に反映)
            </p>
          )}
        </div>
      </Card>

      {/* ============================================ */}
      {/* セクション2:職務要約                         */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">職務要約</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              これまでのキャリアを 150〜250 字程度で簡潔に
            </p>
          </div>
          <AIActionButton
            label="AIで下書き"
            isDrafting={isFieldDrafting(draftingField, "summary")}
            disabled={isPending || (isAnyDrafting && !isFieldDrafting(draftingField, "summary"))}
            hasCareerProfile={hasCareerProfile}
            onClick={handleGenerateSummary}
            ariaLabel="職務要約のAI下書きを生成"
          />
        </div>
        <Textarea
          {...register("body.summary")}
          disabled={isPending || isFieldDrafting(draftingField, "summary")}
          rows={5}
          placeholder="例:SaaS 企業で 5 年間、ユーザー視点の機能設計を担当..."
        />
        {errors.body?.summary && (
          <p className="text-sm text-red-600">{errors.body.summary.message}</p>
        )}
      </Card>

      {/* ============================================ */}
      {/* セクション3:職務経歴(逆編年式)              */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">職務経歴(新しい順)</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            会社名・期間・役職は事実なのでご自身で入力してください。業務内容・実績は各職歴の「✨AIで下書き」から生成できます(AI
            に事実は作らせません)
          </p>
        </div>

        {workExperiencesArray.fields.length === 0 && (
          <p className="text-muted-foreground text-sm">
            「+ 職歴を追加」から経歴を 1 件ずつ追加してください
          </p>
        )}

        <div className="space-y-4">
          {workExperiencesArray.fields.map((field, index) => {
            // 会社名未入力ならこの行の AI ボタンを無効化(API でも弾くが、UX 親切のため client でも判定)。
            // workExperiencesWatch は useWatch でリアクティブに、行内編集に追従する。
            const companyName = workExperiencesWatch?.[index]?.company_name ?? "";
            const hasCompanyName = companyName.trim().length > 0;
            const thisRowTarget = { type: "work_experience" as const, index };
            const isThisRowDrafting = isFieldDrafting(draftingField, thisRowTarget);

            return (
              <div key={field.id} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">職歴 {index + 1}</p>
                  <div className="flex items-center gap-2">
                    <AIActionButton
                      label="AIで下書き"
                      isDrafting={isThisRowDrafting}
                      disabled={isPending || (isAnyDrafting && !isThisRowDrafting)}
                      hasCareerProfile={hasCareerProfile}
                      disabledHint={
                        hasCareerProfile && !hasCompanyName
                          ? "会社名を入力すると利用できます"
                          : undefined
                      }
                      onClick={() => handleGenerateWorkExperience(index)}
                      ariaLabel={`職歴 ${index + 1} の業務内容・実績をAIで下書き`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => workExperiencesArray.remove(index)}
                      disabled={isPending}
                      aria-label={`職歴 ${index + 1} を削除`}
                    >
                      削除
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`we-${index}-company`}>
                      会社名 <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      id={`we-${index}-company`}
                      {...register(`body.work_experiences.${index}.company_name`)}
                      disabled={isPending}
                      placeholder="例:株式会社○○"
                    />
                    {errors.body?.work_experiences?.[index]?.company_name && (
                      <p className="text-sm text-red-600">
                        {errors.body.work_experiences[index]?.company_name?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`we-${index}-industry`}>業界</Label>
                    <Input
                      id={`we-${index}-industry`}
                      {...register(`body.work_experiences.${index}.industry`, {
                        setValueAs: emptyToNullString,
                      })}
                      disabled={isPending}
                      placeholder="例:SaaS、人材"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>入社年月</Label>
                    <Controller
                      control={control}
                      name={`body.work_experiences.${index}.period_start`}
                      render={({ field: f }) => (
                        <PeriodInput
                          value={f.value ?? null}
                          onChange={f.onChange}
                          disabled={isPending}
                        />
                      )}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>退社年月(在籍中は空欄)</Label>
                    <Controller
                      control={control}
                      name={`body.work_experiences.${index}.period_end`}
                      render={({ field: f }) => (
                        <PeriodInput
                          value={f.value ?? null}
                          onChange={f.onChange}
                          disabled={isPending}
                        />
                      )}
                    />
                    {/* refine による前後チェックは period_end にエラーを置く設計
                      (lib/cvs/types.ts の workExperienceSchema.refine)。 */}
                    {errors.body?.work_experiences?.[index]?.period_end && (
                      <p className="text-sm text-red-600">
                        {errors.body.work_experiences[index]?.period_end?.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`we-${index}-position`}>役職</Label>
                    <Input
                      id={`we-${index}-position`}
                      {...register(`body.work_experiences.${index}.position`, {
                        setValueAs: emptyToNullString,
                      })}
                      disabled={isPending}
                      placeholder="例:プロダクトマネージャー"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`we-${index}-employment`}>雇用形態</Label>
                    <select
                      id={`we-${index}-employment`}
                      {...register(`body.work_experiences.${index}.employment_type`, {
                        setValueAs: emptyToNullString,
                      })}
                      disabled={isPending}
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                    >
                      <option value="">— 選択しない —</option>
                      {employmentTypes.map((t) => (
                        <option key={t} value={t}>
                          {employmentTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-description`}>業務内容</Label>
                  <Textarea
                    id={`we-${index}-description`}
                    {...register(`body.work_experiences.${index}.job_description`)}
                    disabled={isPending || isThisRowDrafting}
                    rows={4}
                    placeholder="担当した業務を箇条書きまたは文章で(右上の「AIで下書き」でも生成できます)"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`we-${index}-achievements`}>実績・成果</Label>
                  <Textarea
                    id={`we-${index}-achievements`}
                    {...register(`body.work_experiences.${index}.achievements`)}
                    disabled={isPending || isThisRowDrafting}
                    rows={3}
                    placeholder="数値があれば数値で(○○% 改善 等)、なければ定性的に"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => workExperiencesArray.append(buildEmptyWorkExperience())}
          disabled={isPending}
        >
          + 職歴を追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション4:スキル                           */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">スキル</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              言語・フレームワーク・ツール・ソフトスキル・ドメイン知識など
            </p>
          </div>
          {/* スキル候補生成ボタン(Phase 4-c、4-d で共通 AIActionButton に寄せ替え)。
              候補は AI が抽出 → ユーザーがチェックで採択 → skills に追加する。
              ラベルだけ「AIでスキル候補を提案」に変えて、他項目のボタンと挙動を揃える。 */}
          <AIActionButton
            label="AIでスキル候補を提案"
            isDrafting={isFieldDrafting(draftingField, "skills")}
            disabled={isPending || (isAnyDrafting && !isFieldDrafting(draftingField, "skills"))}
            hasCareerProfile={hasCareerProfile}
            onClick={handleFetchSkillCandidates}
            ariaLabel="棚卸し結果からAIでスキル候補を提案"
          />
        </div>

        {/* スキル候補パネル(取得済み時のみ表示) */}
        {skillCandidates && (
          <SkillCandidatesPanel
            candidates={skillCandidates}
            selected={selectedSkillCandidates}
            existingSkillNames={
              new Set((getValues("body.skills") ?? []).map((s) => normalizeSkillName(s.name)))
            }
            onToggle={toggleSkillCandidate}
            onAdd={handleAddSelectedSkillCandidates}
            onClose={() => {
              setSkillCandidates(null);
              setSelectedSkillCandidates(new Set());
            }}
          />
        )}

        {skillsArray.fields.length === 0 && (
          <p className="text-muted-foreground text-sm">
            「+ スキルを追加」から 1 件ずつ追加してください
          </p>
        )}

        <div className="space-y-3">
          {skillsArray.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]"
            >
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">カテゴリ</Label>}
                <select
                  {...register(`body.skills.${index}.category`)}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                >
                  {skillCategories.map((c) => (
                    <option key={c} value={c}>
                      {skillCategoryLabels[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                {index === 0 && (
                  <Label className="text-xs">
                    スキル名 <span className="text-red-600">*</span>
                  </Label>
                )}
                <Input
                  {...register(`body.skills.${index}.name`)}
                  disabled={isPending}
                  placeholder="例:TypeScript、Figma、ファシリテーション"
                />
                {errors.body?.skills?.[index]?.name && (
                  <p className="text-xs text-red-600">{errors.body.skills[index]?.name?.message}</p>
                )}
              </div>
              <div className="space-y-1">
                {index === 0 && <Label className="text-xs">レベル</Label>}
                <select
                  {...register(`body.skills.${index}.level`, { setValueAs: emptyToNullString })}
                  disabled={isPending}
                  className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
                >
                  <option value="">—</option>
                  {skillLevels.map((l) => (
                    <option key={l} value={l}>
                      {skillLevelLabels[l]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => skillsArray.remove(index)}
                disabled={isPending}
                aria-label={`スキル ${index + 1} を削除`}
              >
                削除
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => skillsArray.append(buildEmptySkill())}
          disabled={isPending}
        >
          + スキルを追加
        </Button>
      </Card>

      {/* ============================================ */}
      {/* セクション5:自己PR                           */}
      {/* ============================================ */}
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">自己PR</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              強み・働き方の方針・今後のキャリア展望など
            </p>
          </div>
          <AIActionButton
            label="AIで下書き"
            isDrafting={isFieldDrafting(draftingField, "self_pr")}
            disabled={isPending || (isAnyDrafting && !isFieldDrafting(draftingField, "self_pr"))}
            hasCareerProfile={hasCareerProfile}
            onClick={handleGenerateSelfPr}
            ariaLabel="自己PRのAI下書きを生成"
          />
        </div>
        <Textarea
          {...register("body.self_pr")}
          disabled={isPending || isFieldDrafting(draftingField, "self_pr")}
          rows={6}
          placeholder="例:ユーザー視点での課題抽出を強みとしてきました..."
        />
      </Card>

      {/* ============================================ */}
      {/* フッター:戻る / 削除 / 保存                  */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          render={<Link href="/app/cvs" />}
          disabled={isPending || isDeleting}
        >
          戻る
        </Button>
        <div className="flex gap-2">
          {mode === "edit" && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={isPending || isDeleting}
              aria-label="この職務経歴書を削除"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {isDeleting ? "削除中..." : "削除"}
            </Button>
          )}
          <Button type="submit" disabled={isPending || isDeleting}>
            {isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ====================================================================
// PeriodInput:{ year, month } 用の年・月セレクタ
//
// 設計:
//   - 親(Controller の value)に対しては「両方揃った時だけ PeriodPoint、
//     それ以外は null」を返す(zod 型を保つため)
//   - 「年だけ選んだ」「月だけ選んだ」のような部分入力は内部 state で保持し、
//     UI 上で消えないようにする(下書き編集中の手触りを改善)
//
// 表示優先順:
//   - 親から確定値(value: PeriodPoint)が来ていればそれを表示
//   - 来ていなければ(value=null)、内部 state の部分入力を表示
//
// 外部リセット(form reset / field array remove+add)で value=null になっても、
// 同じインスタンスが残れば内部 state は前回の入力を保持する。これはユーザーが
// セルを編集し直しているケースでは自然な挙動になる(部分入力を再開できる)。
// ====================================================================
function PeriodInput({
  value,
  onChange,
  disabled,
}: {
  value: PeriodPoint | null;
  onChange: (v: PeriodPoint | null) => void;
  disabled?: boolean;
}) {
  // 部分入力の保持。親が PeriodPoint を返している間は使われず、value=null の時だけ
  // フォールバックとして UI に表示される。
  const [pendingYear, setPendingYear] = useState<string>(
    value?.year != null ? String(value.year) : "",
  );
  const [pendingMonth, setPendingMonth] = useState<string>(
    value?.month != null ? String(value.month) : "",
  );

  const yearStr = value?.year != null ? String(value.year) : pendingYear;
  const monthStr = value?.month != null ? String(value.month) : pendingMonth;

  const emit = (y: string, m: string) => {
    setPendingYear(y);
    setPendingMonth(m);
    if (y === "" || m === "") {
      onChange(null);
      return;
    }
    onChange({ year: Number(y), month: Number(m) });
  };

  return (
    <div className="grid grid-cols-[1fr_5rem] gap-1">
      <input
        type="number"
        inputMode="numeric"
        value={yearStr}
        onChange={(e) => emit(e.target.value, monthStr)}
        disabled={disabled}
        className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
        aria-label="年"
        placeholder="年 (例 2019)"
      />
      <input
        type="number"
        inputMode="numeric"
        value={monthStr}
        onChange={(e) => emit(yearStr, e.target.value)}
        disabled={disabled}
        className="border-input bg-background w-full rounded-md border px-2 py-2 text-sm"
        aria-label="月"
        placeholder="月"
      />
    </div>
  );
}

// ====================================================================
// ヘルパー
// ====================================================================

/**
 * 既存 Cv → フォーム初期値(snake_case + body)。新規時は空デフォルト。
 *
 * react-hook-form の defaultValues は再レンダーで差し替わらないので、
 * existing がある時はその時点のスナップショットを使う前提(履歴書と同じ)。
 */
function buildDefaultValues(existing: Cv | undefined): SaveCvRequest {
  if (!existing) {
    return {
      title: "",
      document_date: "",
      license_resume_id: null,
      body: {
        summary: "",
        work_experiences: [],
        skills: [],
        self_pr: "",
      },
    };
  }
  return {
    title: existing.title,
    document_date: existing.documentDate ?? "",
    license_resume_id: existing.licenseResumeId,
    body: existing.body,
  };
}

function buildEmptyWorkExperience() {
  return {
    company_name: "",
    industry: null,
    period_start: null,
    period_end: null,
    position: null,
    employment_type: null,
    job_description: "",
    achievements: "",
  } as const;
}

function buildEmptySkill() {
  return {
    category: "language",
    name: "",
    level: null,
    description: null,
  } as const;
}

/**
 * <select> や <input> の空文字を null に正規化する。
 * zod の nullable() に乗せるための setValueAs。
 */
function emptyToNullString(v: unknown): string | null {
  if (typeof v !== "string") return v as string | null;
  return v === "" ? null : v;
}

/**
 * スキル名の重複検出用に正規化する。
 *
 * 「TypeScript」と「typescript」「 typescript 」が同じスキルとして扱われるよう、
 * trim + lowercase で比較する。完全一致では無いものは別スキルとして許す
 * (例:「React」と「React Native」)。
 */
function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

// ====================================================================
// スキル候補パネル(Phase 4-c)
//
// 取得した候補をチェックボックスで採択 → 「追加」で skills に append。
// 既に同名スキルが存在する候補はチェック不可にし、ラベルで明示する
// (重複追加を未然に防ぐ)。空配列の時は「候補が見つかりませんでした」を出す。
// ====================================================================

function SkillCandidatesPanel({
  candidates,
  selected,
  existingSkillNames,
  onToggle,
  onAdd,
  onClose,
}: {
  candidates: Skill[];
  selected: Set<number>;
  existingSkillNames: Set<string>;
  onToggle: (idx: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  // 「追加可能な候補が 0 件」だと追加ボタンを無効化したいので、選択中の有効件数を数える。
  const selectableSelectedCount = Array.from(selected).filter((idx) => {
    const c = candidates[idx];
    return c ? !existingSkillNames.has(normalizeSkillName(c.name)) : false;
  }).length;

  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">AI が提案したスキル候補</p>
          <p className="text-muted-foreground mt-1 text-xs">
            棚卸し結果から抽出した候補です。持っているスキルにチェックして「追加」を押すと、
            下のスキル一覧に追加されます。
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="候補を閉じる">
          閉じる
        </Button>
      </div>

      {candidates.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">
          棚卸し結果から具体的なスキル名が見つかりませんでした。手動で追加してください。
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((c, idx) => {
            const isDuplicate = existingSkillNames.has(normalizeSkillName(c.name));
            const isChecked = selected.has(idx);
            return (
              <li
                key={`${c.name}-${idx}`}
                className={`flex items-start gap-3 rounded-md border bg-white p-3 ${
                  isDuplicate ? "opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  id={`skill-candidate-${idx}`}
                  checked={isChecked && !isDuplicate}
                  disabled={isDuplicate}
                  onChange={() => onToggle(idx)}
                  className="mt-1"
                  aria-label={`${c.name} を採択`}
                />
                <label
                  htmlFor={`skill-candidate-${idx}`}
                  className={`flex-1 ${isDuplicate ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                      {skillCategoryLabels[c.category]}
                    </span>
                    {c.level && (
                      <span className="text-muted-foreground text-xs">
                        ({skillLevelLabels[c.level]})
                      </span>
                    )}
                    {isDuplicate && (
                      <span className="text-xs text-amber-700">
                        既に追加済みのため選択できません
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p className="text-muted-foreground mt-1 text-xs">{c.description}</p>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" onClick={onAdd} disabled={selectableSelectedCount === 0}>
          選んだものを追加{selectableSelectedCount > 0 ? `(${selectableSelectedCount}件)` : ""}
        </Button>
      </div>
    </div>
  );
}
