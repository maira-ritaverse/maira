import {
  employmentTypeLabels,
  skillCategories,
  skillCategoryLabels,
  skillLevelLabels,
  type CvBody,
  type PeriodPoint,
  type Skill,
  type SkillCategory,
  type WorkExperience,
} from "@/lib/cvs/types";
import type { LicenseItem } from "@/lib/resumes/types";

/**
 * 職務経歴書プレビュー(JIS様式想定、実務標準のブロック型レイアウト)
 *
 * 履歴書のように公式な「JIS様式」が職務経歴書には存在しないため、
 * 実務で広く使われている「セクション見出し + ブロック型」のレイアウトを
 * 採用する。履歴書のような固定行数の罫線テーブルではなく、内容に合わせて
 * 自然に伸びる構造。
 *
 * 設計方針:
 * - 履歴書プレビューから流用:A4 mm 寸法定数、Page コンポーネント、
 *   外枠 div(画面 = 灰背景、印刷 = 白)、明朝フォントスタック
 * - 新規:ヘッダー / 各セクション / 職務経歴ブロック / 期間フォーマッタ /
 *   スキルのカテゴリ別グループ化
 * - 印刷インクの節約と読みやすさのため、罫線は黒/濃いグレーの細線のみ
 *
 * Phase 2-a の範囲:
 * - 氏名・資格は props で受け取るが、本接続は Phase 2-b で行う
 *   (このフェーズでは null / 空配列でも崩れないことを優先)
 */

// A4 縦の物理寸法。CSS の mm はそのまま物理 mm を表すので、画面表示と
// 印刷時で同じレイアウトになる。
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

type Props = {
  body: CvBody;
  // 履歴書から引いてきた氏名。Phase 2-b で license_resume_id 経由で本接続する。
  name: string | null;
  // 履歴書から引いてきた資格一覧。同上。
  licenses: LicenseItem[];
  // CV.documentDate(null なら本日にフォールバック、履歴書と同じ運用)
  documentDate: string | null;
};

export function CvPreview({ body, name, licenses, documentDate }: Props) {
  return (
    <div className="overflow-x-auto bg-neutral-200 p-6 print:bg-white print:p-0">
      <div
        className="mx-auto text-black"
        style={{
          width: `${PAGE_WIDTH_MM}mm`,
          // 履歴書らしさのため明朝系。OS 差異を吸収するためフォールバックを並べる。
          fontFamily:
            '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Hiragino Mincho Pro", "MS Mincho", serif',
        }}
      >
        <Page>
          <Header documentDate={documentDate} name={name} />
          <SummarySection summary={body.summary} />
          <WorkExperiencesSection experiences={body.work_experiences} />
          <SkillsSection skills={body.skills} />
          <LicensesSection licenses={licenses} hasResumeRef={name !== null} />
          <SelfPrSection text={body.self_pr} />
        </Page>
      </div>

      <p className="mt-4 text-center text-xs text-neutral-600 print:hidden">
        このレイアウトで PDF 出力(Phase 3 で対応)
      </p>
    </div>
  );
}

// ====================================================================
// Page:白紙の A4 縦シート
//
// 履歴書プレビューの Page コンポーネントと同じ仕様。padding を 15mm に
// 広げてあるのは、ブロック型の本文を読みやすく余白で囲うため(履歴書は
// 罫線が紙端まで来るので 10mm)。
// ====================================================================
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col bg-white shadow print:shadow-none"
      style={{
        width: `${PAGE_WIDTH_MM}mm`,
        minHeight: `${PAGE_HEIGHT_MM}mm`,
        padding: "15mm",
        breakAfter: "page",
      }}
    >
      {children}
    </div>
  );
}

// ====================================================================
// ヘッダー:タイトル + 日付 + 氏名
//
// 実務慣行:
//   - タイトルは中央寄せ、太字、字間広め
//   - 右上に作成日と氏名(右寄せ揃え)
//   - 氏名が未設定(履歴書未選択)の場合は空欄+注意書きで明示する
// ====================================================================
function Header({ documentDate, name }: { documentDate: string | null; name: string | null }) {
  return (
    <div className="mb-6">
      <h2 className="text-center text-[22px] font-bold tracking-[0.4em]">職 務 経 歴 書</h2>
      <div className="mt-4 flex justify-end gap-8 text-[12px]">
        <div>{formatDocumentDate(documentDate)} 現在</div>
        <div>
          氏名{" "}
          {name ? (
            <span className="ml-1">{name}</span>
          ) : (
            <span className="ml-1 inline-block min-w-[8em] border-b border-neutral-400" />
          )}
        </div>
      </div>
      {!name && (
        <p className="mt-1 text-right text-[10px] text-neutral-500">
          ※ 履歴書を選択すると氏名が反映されます
        </p>
      )}
    </div>
  );
}

// ====================================================================
// セクション見出し(「■ 職務要約」のような左飾り + 下線)
// ====================================================================
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 border-b border-black pb-1 text-[14px] font-bold first:mt-0">
      <span className="mr-2">■</span>
      {children}
    </h3>
  );
}

// ====================================================================
// プレースホルダ(未入力時の薄いグレー文字)
// ====================================================================
function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] text-neutral-400">{children}</p>;
}

// ====================================================================
// 職務要約
// ====================================================================
function SummarySection({ summary }: { summary: string }) {
  return (
    <section>
      <SectionHeading>職務要約</SectionHeading>
      {summary ? (
        <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap">{summary}</div>
      ) : (
        <EmptyHint>(未入力)</EmptyHint>
      )}
    </section>
  );
}

// ====================================================================
// 職務経歴(逆編年式、各社をブロックで表示)
//
// 並び順はフォームの入力順をそのまま反映(自動ソートはしない)。
// 「新しい順」はユーザーが入力時に意識する運用(フォーム側のラベルで促す)。
// ====================================================================
function WorkExperiencesSection({ experiences }: { experiences: WorkExperience[] }) {
  return (
    <section>
      <SectionHeading>職務経歴</SectionHeading>
      {experiences.length === 0 ? (
        <EmptyHint>(未入力)</EmptyHint>
      ) : (
        <div className="mt-3 space-y-4">
          {experiences.map((we, i) => (
            <WorkExperienceBlock key={i} we={we} />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkExperienceBlock({ we }: { we: WorkExperience }) {
  const periodText = formatPeriodRange(we.period_start, we.period_end);

  // メタ情報(業界・役職・雇用形態)は埋まっているものだけ並べる。
  // 全部 null なら行ごと省略する(空のカンマ列が出ないように)。
  const meta: string[] = [];
  if (we.industry) meta.push(`業界:${we.industry}`);
  if (we.position) meta.push(`役職:${we.position}`);
  if (we.employment_type) meta.push(`雇用形態:${employmentTypeLabels[we.employment_type]}`);

  return (
    <div className="border border-neutral-500 px-3 py-3">
      {/* 会社名(左)と期間(右) */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-400 pb-2">
        <div className="text-[13px] font-semibold">{we.company_name}</div>
        <div className="text-[11px] whitespace-nowrap">{periodText}</div>
      </div>

      {meta.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}

      {we.job_description && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold">業務内容</p>
          <div className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap">
            {we.job_description}
          </div>
        </div>
      )}

      {we.achievements && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold">実績・成果</p>
          <div className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap">
            {we.achievements}
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// 活かせる経験・スキル(カテゴリ別グループ化)
//
// 同じカテゴリのスキルが連続するよう、フォームの入力順を保ったまま
// カテゴリでグルーピングする。空のカテゴリは表示しない。
// 表示順は skillCategories(types.ts の列挙順)に従う。
// ====================================================================
function SkillsSection({ skills }: { skills: Skill[] }) {
  const grouped = groupSkillsByCategory(skills);

  return (
    <section>
      <SectionHeading>活かせる経験・スキル</SectionHeading>
      {skills.length === 0 ? (
        <EmptyHint>(未入力)</EmptyHint>
      ) : (
        <div className="mt-3 space-y-3">
          {skillCategories
            .filter((cat) => (grouped.get(cat)?.length ?? 0) > 0)
            .map((cat) => (
              <div key={cat}>
                <p className="text-[11px] font-semibold">【{skillCategoryLabels[cat]}】</p>
                <ul className="mt-1 space-y-0.5">
                  {grouped.get(cat)!.map((s, i) => (
                    <li key={i} className="text-[12px] leading-relaxed">
                      <span className="mr-1">・</span>
                      {s.name}
                      {s.level && (
                        <span className="ml-1 text-[10px] text-neutral-600">
                          ({skillLevelLabels[s.level]})
                        </span>
                      )}
                      {s.description && <span className="ml-2 text-[11px]">— {s.description}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

// ====================================================================
// 資格(履歴書から引いてくる licenses を表示)
//
// hasResumeRef:履歴書参照(license_resume_id)が設定済みかどうか。
//   - 履歴書あり & licenses 空 → 「履歴書に資格未登録」と明示
//   - 履歴書なし → 「履歴書を選択すると資格が反映されます」と案内
// ====================================================================
function LicensesSection({
  licenses,
  hasResumeRef,
}: {
  licenses: LicenseItem[];
  hasResumeRef: boolean;
}) {
  return (
    <section>
      <SectionHeading>資格</SectionHeading>
      {licenses.length === 0 ? (
        <EmptyHint>
          {hasResumeRef
            ? "(参照中の履歴書に資格が登録されていません)"
            : "(履歴書を選択すると資格が反映されます)"}
        </EmptyHint>
      ) : (
        <table className="mt-2 w-full" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {licenses.map((l, i) => (
              <tr key={i}>
                <td className="w-[110px] border-b border-neutral-400 py-1 align-top text-[11px]">
                  {formatYearMonth(l.year, l.month)}
                </td>
                <td className="border-b border-neutral-400 py-1 text-[12px]">{l.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ====================================================================
// 自己PR
// ====================================================================
function SelfPrSection({ text }: { text: string }) {
  return (
    <section>
      <SectionHeading>自己PR</SectionHeading>
      {text ? (
        <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap">{text}</div>
      ) : (
        <EmptyHint>(未入力)</EmptyHint>
      )}
    </section>
  );
}

// ====================================================================
// ヘルパー
// ====================================================================

/**
 * 期間 1 点を「2020年4月」のように整形。null は空文字。
 */
function formatPeriodPoint(p: PeriodPoint | null): string {
  if (!p) return "";
  return `${p.year}年${p.month}月`;
}

/**
 * 期間レンジ「2020年4月 〜 2024年3月」/「2020年4月 〜 現在」/「(期間未入力)」を返す。
 *
 * - 開始のみあり、終了 null → 在籍中とみなして「〜 現在」
 * - 開始 null、終了あり → 「〜 2024年3月」(片側だけの不完全な状態)
 * - 両方 null → 「(期間未入力)」
 */
function formatPeriodRange(start: PeriodPoint | null, end: PeriodPoint | null): string {
  const startText = formatPeriodPoint(start);
  const endText = end ? formatPeriodPoint(end) : start ? "現在" : "";

  if (!startText && !endText) return "(期間未入力)";
  if (!startText) return `〜 ${endText}`;
  return `${startText} 〜 ${endText}`;
}

/**
 * 「2018年6月」のように整形。どちらかが null なら空文字(部分的に出さない)。
 */
function formatYearMonth(year: number | null, month: number | null): string {
  if (year == null || month == null) return "";
  return `${year}年${month}月`;
}

/**
 * スキルをカテゴリ別にグルーピング。入力順は保つ。
 */
function groupSkillsByCategory(skills: Skill[]): Map<SkillCategory, Skill[]> {
  const map = new Map<SkillCategory, Skill[]>();
  for (const s of skills) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  return map;
}

/**
 * 職務経歴書「○年○月○日 現在」の日付。履歴書プレビューと同じ仕様。
 * documentDate(YYYY-MM-DD)未指定なら本日にフォールバック。
 */
function formatDocumentDate(documentDate: string | null): string {
  const d = documentDate ? new Date(documentDate) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()} 年 ${safe.getMonth() + 1} 月 ${safe.getDate()} 日`;
}
