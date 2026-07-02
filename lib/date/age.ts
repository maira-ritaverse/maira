/**
 * 生年月日 から 満年齢 を 計算 する。
 *
 * 「満年齢」 = 誕生日 を 迎える 前 = 前年 の 年齢、 迎えた 後 = 今年 の 年齢。
 * 日本 の 一般 的 な 「満 何 歳」 表記 と 一致 させる。
 *
 * 戻り値:
 *   ・数値 (満 X 歳)。 birthDate が 未来 の 場合 は 負数 に なる ので 呼び出し 側 で 判定。
 *   ・birthDate が 未指定 / 不正 形式 の 場合 は null。
 *
 * 入力 は 「YYYY-MM-DD」 (client_records.birth_date が date 型 の ため) を 想定 する が、
 * "YYYY/MM/DD" や Date オブジェクト も 許容 する。
 */
export function calculateAge(
  birthDate: string | Date | null | undefined,
  reference: Date = new Date(),
): number | null {
  if (birthDate === null || birthDate === undefined || birthDate === "") return null;

  let b: Date;
  if (birthDate instanceof Date) {
    b = birthDate;
  } else {
    const normalized = birthDate.replace(/\//g, "-").trim();
    // 「YYYY-MM-DD」 のみ を 許容 ( 誤 formatted で NaN Date に なる の を 明示 拒否 )
    if (!/^\d{4}-\d{1,2}-\d{1,2}(T.*)?$/.test(normalized)) return null;
    b = new Date(normalized);
  }
  if (Number.isNaN(b.getTime())) return null;

  let age = reference.getFullYear() - b.getFullYear();
  const beforeBirthday =
    reference.getMonth() < b.getMonth() ||
    (reference.getMonth() === b.getMonth() && reference.getDate() < b.getDate());
  if (beforeBirthday) age -= 1;

  return age;
}

/**
 * 満年齢 を 「満 X 歳」 の 表示 用 文字列 に する ヘルパー。
 * 計算 でき ない / 未来 の 日付 の 場合 は null を 返し、 UI 側 で 非 表示 判定 に 使う。
 */
export function formatAgeLabel(
  birthDate: string | Date | null | undefined,
  reference?: Date,
): string | null {
  const age = calculateAge(birthDate, reference);
  if (age === null || age < 0 || age > 150) return null;
  return `満 ${age} 歳`;
}
