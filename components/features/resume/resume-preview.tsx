import { genderLabels, type Resume } from "@/lib/resumes/types";

/**
 * 履歴書プレビュー(厚生労働省推奨様式 2021〜)
 *
 * 公式 PDF(https://www.hellowork.mhlw.go.jp/doc/kouroushourirekisho.pdf)を
 * 参照して再現。原本は A3 横の見開きだが、画面表示と一般的な A4 プリンタ
 * での印刷を両立するため、ここでは A4 縦 ×2 ページ(左ページ→右ページ)を
 * 縦に積んだレイアウトにする。
 *
 * 設計方針:
 * - 罫線は 1px の黒線、背景は白のみ(印刷時のインクも節約)
 * - フォントは明朝系(履歴書としての伝統的な見た目)
 * - 寸法は mm 固定(画面表示 1mm ≒ 3.78px、印刷時はそのまま物理 mm)
 * - 次の Phase で Puppeteer に渡してそのまま PDF 化できる構造
 *
 * 注意:
 * - 厚労省様式なので 通勤時間/扶養家族/配偶者 欄はない(意図的に省略)
 * - 性別は任意(空欄可)
 */

type Props = {
  resume: Resume;
};

// A4 縦の物理寸法。CSS の mm はそのまま物理 mm を表すので、画面と
// 印刷で同じレイアウトになる。
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// 学歴・職歴/免許・資格の各表に確保する行数。原本の見た目に近づけるため、
// データが少なくても空行で埋めて履歴書らしい余白を作る。
// 1 ページ目に 15 行、2 ページ目に 8 行(続き)+ 免許資格 8 行 = 計 31 行ぶん。
const ROWS_HISTORY_PAGE_1 = 15;
const ROWS_HISTORY_PAGE_2 = 8;
const ROWS_LICENSE = 8;

export function ResumePreview({ resume }: Props) {
  const allHistory = resume.educationHistory;
  const historyPage1 = allHistory.slice(0, ROWS_HISTORY_PAGE_1);
  const historyPage2 = allHistory.slice(
    ROWS_HISTORY_PAGE_1,
    ROWS_HISTORY_PAGE_1 + ROWS_HISTORY_PAGE_2,
  );

  return (
    <div className="overflow-x-auto bg-neutral-200 p-6 print:bg-white print:p-0">
      <div
        className="mx-auto space-y-6 text-black print:space-y-0"
        style={{
          width: `${PAGE_WIDTH_MM}mm`,
          // 履歴書らしさのため明朝系。OS により利用可能フォントが違うので
          // フォールバックを並べる。
          fontFamily:
            '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Hiragino Mincho Pro", "MS Mincho", serif',
        }}
      >
        {/* ===== 1 ページ目 ===== */}
        <Page>
          <HeaderAndBasicInfo resume={resume} />
          <HistoryTable rows={padRows(historyPage1, ROWS_HISTORY_PAGE_1)} showHeader />
          <Footnote>※「性別」欄:記載は任意です。未記載とすることも可能です。</Footnote>
        </Page>

        {/* ===== 2 ページ目 ===== */}
        <Page>
          {/* 学歴・職歴の続き。原本では右ページ上部にも同じ見出し行がある */}
          <HistoryTable rows={padRows(historyPage2, ROWS_HISTORY_PAGE_2)} showHeader />
          <LicenseTable rows={padRows(resume.licenses, ROWS_LICENSE)} />
          <MotivationBox text={resume.motivationNote} />
          <RequestsBox text={resume.personalRequests} />
        </Page>
      </div>

      <p className="mt-4 text-center text-xs text-neutral-600 print:hidden">
        この見た目で PDF 出力(近日対応)
      </p>
    </div>
  );
}

// ====================================================================
// ページ(白紙の A4 縦シート)
// ====================================================================

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col bg-white shadow print:shadow-none"
      style={{
        width: `${PAGE_WIDTH_MM}mm`,
        minHeight: `${PAGE_HEIGHT_MM}mm`,
        padding: "10mm",
        breakAfter: "page",
      }}
    >
      {children}
    </div>
  );
}

// ====================================================================
// ヘッダー + 基本情報 + 写真
//
// 原本では「履歴書」「ふりがな/氏名」「生年月日/性別」が左カラムにあり、
// 右カラムに写真欄が縦方向にまたがって配置される。
// ここでは flex で 2 カラムに分け、右側を写真セルとして固定幅にする。
// ====================================================================

function HeaderAndBasicInfo({ resume }: { resume: Resume }) {
  const age = calcAge(resume.birthDate);
  const genderLabel = resume.gender ? genderLabels[resume.gender] : "";

  return (
    <div>
      {/* 上ブロック:基本情報 + 写真欄 */}
      <div className="flex border border-black">
        {/* 左カラム:タイトル/氏名/生年月日 */}
        <div className="flex flex-1 flex-col">
          {/* タイトル行 */}
          <div className="flex items-end justify-between border-b border-black px-3 py-2">
            <h2 className="text-[20px] font-bold tracking-[0.3em]">履 歴 書</h2>
            <p className="text-[11px]">{formatDocumentDate(resume.documentDate)} 現在</p>
          </div>

          {/* ふりがな */}
          <RowLine label="ふりがな" small>
            {resume.nameKana ?? ""}
          </RowLine>

          {/* 氏名(背の高いセル) */}
          <div className="flex flex-1 border-b border-black">
            <CellLabel>氏 名</CellLabel>
            <div className="flex flex-1 items-center px-3 text-[18px]">{resume.name ?? ""}</div>
          </div>

          {/* 生年月日 + 性別 */}
          <div className="flex">
            <div className="flex flex-1 border-r border-black">
              <div className="flex items-center px-3 py-2 text-[12px]">
                {formatBirthDate(resume.birthDate, age)}
              </div>
            </div>
            <div className="flex w-[100px] items-center justify-center border-r border-black px-2 py-2 text-[11px]">
              ※性別
            </div>
            <div className="flex w-[80px] items-center justify-center px-2 py-2 text-[12px]">
              {genderLabel}
            </div>
          </div>
        </div>

        {/* 右カラム:写真欄(縦長) */}
        <div className="flex w-[120px] shrink-0 items-stretch justify-center border-l border-black">
          <PhotoBox photoUrl={resume.photoUrl} />
        </div>
      </div>

      {/* 現住所ブロック */}
      <AddressBlock
        addressKana={resume.addressKana}
        postalCode={resume.postalCode}
        address={resume.address}
        phone={resume.phone}
        email={resume.email}
        label="現住所"
      />

      {/* 連絡先ブロック */}
      <AddressBlock
        addressKana={resume.contactAddressKana}
        postalCode={null}
        address={resume.contactAddress}
        phone={resume.contactPhone}
        email={null}
        label="連絡先"
        note="(現住所以外に連絡を希望する場合のみ記入)"
      />
    </div>
  );
}

// ====================================================================
// 写真欄
//
// 原本では「写真をはる位置 / 写真をはる必要がある場合 1.縦 横 ...」と
// いう注釈が枠内に入る。写真がアップ済みなら画像で上書きする。
// ====================================================================

function PhotoBox({ photoUrl }: { photoUrl: string | null }) {
  return (
    <div className="flex flex-1 flex-col p-2 text-[9px] leading-tight">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="本人写真" className="h-full w-full object-cover" />
      ) : (
        <>
          <p>写真をはる位置</p>
          <p className="mt-2">写真をはる必要が</p>
          <p>ある場合</p>
          {/* 厚労省様式の規定寸法。原本注記をそのまま再現することで本人の貼り間違いを防ぐ。 */}
          <p className="mt-2">1. 縦 36〜40mm</p>
          <p className="pl-3">横 24〜30mm</p>
          <p>2. 本人単身胸から上</p>
          <p>3. 裏面のりづけ</p>
        </>
      )}
    </div>
  );
}

// ====================================================================
// 住所ブロック(現住所/連絡先で共用)
//
// ふりがな行 → 〒+住所(左) + 電話(右) の構造。
// ====================================================================

function AddressBlock({
  addressKana,
  postalCode,
  address,
  phone,
  email,
  label,
  note,
}: {
  addressKana: string | null | undefined;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  label: string;
  note?: string;
}) {
  return (
    <div className="border-x border-b border-black">
      {/* ふりがな */}
      <RowLine label="ふりがな" small>
        {addressKana ?? ""}
      </RowLine>

      {/* 住所 + 電話 */}
      <div className="flex">
        <CellLabel>{label}</CellLabel>
        <div className="flex flex-1 flex-col justify-center px-3 py-2 text-[12px]">
          <div className="flex items-baseline gap-2">
            <span>〒</span>
            <span>{postalCode ?? ""}</span>
          </div>
          <div className="mt-1 min-h-[1.2em]">{address ?? ""}</div>
          {note && <div className="mt-1 text-[9px] text-neutral-600">{note}</div>}
          {email !== null && email !== undefined && email !== "" && (
            <div className="mt-1 text-[11px]">メール {email}</div>
          )}
        </div>
        <div className="flex w-[140px] shrink-0 flex-col border-l border-black">
          <div className="border-b border-black px-2 py-1 text-[10px]">電話</div>
          <div className="flex flex-1 items-center px-2 text-[12px]">{phone ?? ""}</div>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// 学歴・職歴テーブル
//
// 表の見出しは「年 / 月 / 学 歴・職 歴(各別にまとめて書く)」。
// 学歴/職歴の見出し行(「学歴」「職歴」)は description 側に書いて運用する
// 仕様(Phase 1 の設計通り)なので、ここはデータをそのまま 1 行ずつ並べる。
// ====================================================================

type HistoryRow = { year: number | null; month: number | null; description: string };

function HistoryTable({ rows, showHeader }: { rows: (HistoryRow | null)[]; showHeader: boolean }) {
  return (
    <table className="w-full border-x border-b border-black" style={{ borderCollapse: "collapse" }}>
      {showHeader && (
        <thead>
          <tr>
            <Th width="48px">年</Th>
            <Th width="40px">月</Th>
            <Th>学 歴・職 歴(各別にまとめて書く)</Th>
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <Td center small>
              {row?.year ?? ""}
            </Td>
            <Td center small>
              {row?.month ?? ""}
            </Td>
            <Td>{row?.description ?? ""}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ====================================================================
// 免許・資格テーブル
// ====================================================================

type LicenseRow = { year: number | null; month: number | null; name: string };

function LicenseTable({ rows }: { rows: (LicenseRow | null)[] }) {
  return (
    <table className="w-full border-x border-b border-black" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <Th width="48px">年</Th>
          <Th width="40px">月</Th>
          <Th>免 許・資 格</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <Td center small>
              {row?.year ?? ""}
            </Td>
            <Td center small>
              {row?.month ?? ""}
            </Td>
            <Td>{row?.name ?? ""}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ====================================================================
// 志望の動機ブロック
// ====================================================================

function MotivationBox({ text }: { text: string | null }) {
  return (
    <div className="mt-3 border border-black">
      <div className="border-b border-black bg-white px-2 py-1 text-[11px]">
        志望の動機、特技、好きな学科、アピールポイントなど
      </div>
      <div className="min-h-[60mm] px-3 py-2 text-[12px] whitespace-pre-wrap">{text ?? ""}</div>
    </div>
  );
}

// ====================================================================
// 本人希望記入欄
// ====================================================================

function RequestsBox({ text }: { text: string | null }) {
  return (
    <div className="mt-3 border border-black">
      <div className="border-b border-black bg-white px-2 py-1 text-[11px]">
        本人希望記入欄(特に給料・職種・勤務時間・勤務地・その他についての希望などがあれば記入)
      </div>
      <div className="min-h-[30mm] px-3 py-2 text-[12px] whitespace-pre-wrap">{text ?? ""}</div>
    </div>
  );
}

// ====================================================================
// 汎用セル / 行
// ====================================================================

function RowLine({
  label,
  children,
  small,
}: {
  label: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex border-b border-black">
      <div
        className={`shrink-0 border-r border-black ${small ? "py-0.5" : "py-1"}`}
        style={{ width: "60px", paddingLeft: "8px", fontSize: small ? "9px" : "11px" }}
      >
        {label}
      </div>
      <div
        className="flex-1 px-3"
        style={{ fontSize: small ? "10px" : "12px", paddingTop: small ? "2px" : "4px" }}
      >
        {children}
      </div>
    </div>
  );
}

function CellLabel({ children }: { children: React.ReactNode }) {
  // 「氏名」「現住所」「連絡先」など、左端のラベル列。
  return (
    <div
      className="flex shrink-0 items-center justify-center border-r border-black bg-white text-[11px]"
      style={{ width: "60px" }}
    >
      {children}
    </div>
  );
}

function Th({ children, width }: { children: React.ReactNode; width?: string }) {
  return (
    <th
      className="border border-black px-2 py-1 text-center text-[11px] font-medium"
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  small,
}: {
  children: React.ReactNode;
  center?: boolean;
  small?: boolean;
}) {
  return (
    <td
      className={`border border-black px-2 align-middle ${center ? "text-center" : ""}`}
      style={{ height: "8mm", fontSize: small ? "11px" : "12px" }}
    >
      {children}
    </td>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[9px] text-neutral-700">{children}</p>;
}

// ====================================================================
// ヘルパー
// ====================================================================

function padRows<T>(items: T[], min: number): (T | null)[] {
  if (items.length >= min) return items;
  return [...items, ...Array<null>(min - items.length).fill(null)];
}

/**
 * 西暦の生年月日 → 「YYYY年M月D日生 (満○歳)」表記。
 */
function formatBirthDate(birthDate: string | null, age: number | null): string {
  if (!birthDate) return "　　年　　月　　日生 (満　　歳)";
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return "";
  const ageText = age !== null ? `(満 ${age} 歳)` : "";
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月 ${d.getDate()}日生 ${ageText}`;
}

/**
 * 満年齢計算。誕生日を迎えていないときは -1 する。
 */
function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/**
 * 履歴書「○年○月○日 現在」の日付を西暦で返す。
 *
 * documentDate(YYYY-MM-DD)が指定されていればそれを採用し、
 * 未指定なら本日の日付にフォールバックする。
 * 生年月日・学歴・職歴も西暦表記なので、現在日付も西暦に揃える。
 */
function formatDocumentDate(documentDate: string | null): string {
  const d = documentDate ? new Date(documentDate) : new Date();
  // パース不能(壊れた値を渡された場合)は本日にフォールバック
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()} 年 ${safe.getMonth() + 1} 月 ${safe.getDate()} 日`;
}
