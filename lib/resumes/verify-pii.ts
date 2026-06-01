import {
  pickResumePii,
  RESUME_PII_FIELDS,
  type ResumePii,
  type ResumePiiFieldName,
} from "./pii-fields";

/**
 * バックフィル後の検証ロジック
 *
 * encrypted_pii を復号して得た ResumePii と、DB の個別 PII カラム(行データ)が
 * 「意味的に一致している」ことを確かめる。Step 3c で個別カラムを削除しても
 * データが失われないと保証するためのチェック。
 *
 * 重要な比較ルール:
 *   - text 系スカラー:null / undefined / 空文字を意味的に同値と扱う
 *     (DB の text 列でユーザーが履歴的に空文字を入れていた場合の偽陽性を避ける)
 *   - date 系(birth_date):両者とも "YYYY-MM-DD" 文字列を期待。
 *     PostgREST は date 型を ISO 文字列で返すため、blob 側と同じ表現になる。
 *     型違いが来た場合は文字列化して比較し、それでも違えば差分扱い。
 *   - gender:enum 値 + null。同値比較。
 *   - jsonb 系(education_history / licenses):**raw を捨てず深く比較**する。
 *     pickResumePii が要素を落としていれば(zod スキーマで弾かれていれば)
 *     blob の長さが減るので「真の差分」として検出される。ここは緩めない。
 */

export type DiffKind = "value_mismatch" | "row_has_extra" | "blob_has_extra";

export type FieldDiff = {
  field: ResumePiiFieldName;
  kind: DiffKind;
};

export type RowDiff = {
  rowId: string;
  diffs: FieldDiff[];
};

/**
 * 検証対象として受け取る「行データの読み取り形」。
 * Supabase からそのまま渡せる形。
 */
export type ResumeRowForVerify = {
  id: string;
  name: string | null;
  name_kana: string | null;
  birth_date: string | null;
  gender: string | null;
  postal_code: string | null;
  address: string | null;
  address_kana: string | null;
  phone: string | null;
  email: string | null;
  contact_address: string | null;
  contact_address_kana: string | null;
  contact_phone: string | null;
  photo_url: string | null;
  education_history: unknown;
  licenses: unknown;
  motivation_note: string | null;
  personal_requests: string | null;
};

/**
 * text 系スカラーの「意味的同値」比較。
 * null / undefined / 空文字 / 空白だけ、をすべて null に倒してから比較する。
 */
function normalizeScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * date(birth_date)の比較用正規化。
 * Supabase は date を "YYYY-MM-DD" 文字列で返すため、ほぼ scalar と同じだが
 * 万が一 Date 型が混入しても拾えるよう ISO 化を試みる。
 */
function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  // Date 型(理論上ありうる) → "YYYY-MM-DD"
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * jsonb 系の深い比較。
 *
 * 比較方針(Step 3b 実データ確認後に調整):
 *   - row 側の jsonb には react-hook-form の useFieldArray 由来 `id` 等、
 *     スキーマに無い UI 副作用フィールドが残っているケースが実在する。
 *     これは「データ消失」ではない(必要キーは全て残っている)ので差分にしない。
 *   - そのため row 側も同じ zod スキーマ(pickResumePii 経路)で正規化してから
 *     blob と比較する。両者が同じ canonical form になるので余分なキーは無視。
 *   - ただし「pickResumePii が要素を 1 つでも落とした(zod safeParse 失敗)」
 *     ケースは raw の要素数と正規化後の要素数で検出する。ここは緩めない。
 *
 * 注意:Supabase が jsonb を返すときは Object/Array で返ってくる。
 * blob 側は deserializeResumePii で zod を通した配列。
 * どちらも JSON 互換のため stringify で十分。
 */
function jsonbEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 1 行ぶんの個別 PII カラムと、復号した blob の PII を比較し、
 * 差分があるフィールド名と種別の配列を返す。
 *
 * 戻り値が空配列なら一致(OK)。
 */
export function compareRowToBlob(row: ResumeRowForVerify, blob: ResumePii): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  // row 全体を pickResumePii に通したスナップショット。jsonb の正規化に使う。
  // 何度呼んでも純粋関数なので 1 回で十分。
  const rowNormalized = pickResumePii(row as unknown as Record<string, unknown>);

  for (const field of RESUME_PII_FIELDS) {
    if (field === "education_history" || field === "licenses") {
      const raw = row[field];
      // データ消失検出:raw が配列で、zod 通過後に要素が減っていれば真の差分。
      if (Array.isArray(raw) && raw.length !== rowNormalized[field].length) {
        diffs.push({ field, kind: "value_mismatch" });
        continue;
      }
      // raw が配列でない(null や object など想定外)場合は blob が空配列でなければ差分。
      if (!Array.isArray(raw) && rowNormalized[field].length !== blob[field].length) {
        diffs.push({ field, kind: "value_mismatch" });
        continue;
      }
      // 正規化済み row vs blob を深く比較。UI 副作用キー(id 等)はここで一致する。
      if (!jsonbEqual(rowNormalized[field], blob[field])) {
        diffs.push({ field, kind: "value_mismatch" });
      }
      continue;
    }

    if (field === "birth_date") {
      const rowNorm = normalizeDate(row.birth_date);
      const blobNorm = normalizeDate(blob.birth_date);
      if (rowNorm !== blobNorm) {
        diffs.push({ field, kind: "value_mismatch" });
      }
      continue;
    }

    if (field === "gender") {
      // gender は enum / null。null↔ 不正値を null として揃える。
      const rowG = isValidGender(row.gender) ? row.gender : null;
      const blobG = blob.gender;
      if (rowG !== blobG) {
        diffs.push({ field, kind: "value_mismatch" });
      }
      continue;
    }

    // それ以外の text 系スカラー
    const rowV = normalizeScalar(row[field]);
    const blobV = normalizeScalar(blob[field]);
    if (rowV !== blobV) {
      diffs.push({ field, kind: "value_mismatch" });
    }
  }

  return diffs;
}

function isValidGender(value: unknown): boolean {
  return value === "male" || value === "female" || value === "unspecified";
}

/**
 * 差分内訳のサマリを集計する(レポート用)。
 * フィールド名と種別だけを使い、値そのものは含めない。
 */
export type DiffSummary = Record<string, number>;

export function summarizeDiffs(rowDiffs: RowDiff[]): DiffSummary {
  const summary: DiffSummary = {};
  for (const row of rowDiffs) {
    for (const d of row.diffs) {
      const key = `${d.field}:${d.kind}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
  }
  return summary;
}
