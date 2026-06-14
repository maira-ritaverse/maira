"use client";

import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { LABOUR_FIELDS_TOTAL } from "@/lib/jobs/types";

/**
 * 法定明示事項 8 列のフィールド名(snake_case のままフォームの register キーと合わせる)。
 *
 * createJobRequestSchema / updateJobRequestSchema のどちらにも同じキーで含まれているので、
 * このバッジは新規登録フォーム・編集フォーム両方で再利用できる。
 */
export const LABOUR_FIELD_NAMES = [
  "work_change_scope",
  "location_change_scope",
  "smoking_prevention_measure",
  "probation_period",
  "work_hours",
  "break_time",
  "holidays",
  "application_qualifications",
] as const;

type Props<T extends FieldValues> = {
  control: Control<T>;
};

/**
 * 法定 8 列の入力進捗をリアルタイム表示するバッジ(共通)。
 *
 * 仕様:
 *   - useWatch で 8 列を同時監視(各 input ごとに subscribe するより安価)
 *   - 「null / 空文字 / 空白のみ」は未入力扱い(lib/jobs/types の純粋関数と同じ判定)
 *   - 0 = 赤 / 1〜7 = 黄 / 8 = 緑(一覧の LabourBadge と配色を統一)
 *
 * 呼び出し側:
 *   <LabourProgressBadge control={control} />
 *
 * フォームスキーマに上記 8 フィールド名(snake_case)が含まれている前提。
 * 含まれていないキーは useWatch が undefined を返し、自動的に「未入力」扱いになる。
 */
export function LabourProgressBadge<T extends FieldValues>({ control }: Props<T>) {
  // Path<T>[] にキャストすることで、フォーム側にフィールドが定義されていれば動く。
  // 型レベルで全フォームを縛らない方が(新規 / 編集の両方使えるため)実用的。
  const values = useWatch({
    control,
    name: LABOUR_FIELD_NAMES as unknown as Path<T>[],
  });
  const filled = (values ?? []).filter(
    (v: unknown) => typeof v === "string" && v.trim() !== "",
  ).length;
  const total = LABOUR_FIELDS_TOTAL;
  const colorClass =
    filled === total
      ? "bg-green-100 text-green-700"
      : filled === 0
        ? "bg-red-100 text-red-700"
        : "bg-yellow-100 text-yellow-700";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${colorClass}`}
      title="未入力の項目があると一覧にも警告が出ます"
    >
      {filled}/{total} 入力済み
    </span>
  );
}
