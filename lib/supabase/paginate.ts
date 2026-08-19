/**
 * PostgREST の max_rows(返却行数の上限)を分割取得で越えて全行を読み込むヘルパー。
 *
 * 背景:
 *   一覧/エクスポート系クエリは limit/range を付けず「全件」のつもりでも、実際は
 *   PostgREST の max_rows で頭打ちになり、超過分がブラウザ/エクスポートから漏れる。
 *
 * 使い方:
 *   const { rows, complete } = await fetchAllRows((from, to) =>
 *     supabase.from("t").select("*").eq(...).order("id").range(from, to),
 *   );
 *
 * 重要:
 *   - buildPage には必ず「一意で安定した order」を付けること(order が不安定だと
 *     ページ境界で行の重複 / 欠落が起きる)。id を最終タイブレークにするのが安全。
 *   - from の前進は「要求幅(SPAN)」ではなく「実際に返ってきた行数」で行うため、
 *     server の max_rows 値に依存しない(設定変更で静かに壊れない)。終端は空ページ。
 *   - complete: 全ページを最後まで読めたら true。途中エラー / 安全弁到達なら false
 *     (件数集計など「過少表示が誤解を生む」用途で使い分ける)。
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; complete: boolean }> {
  const SPAN = 1000; // 1 リクエストで要求する行数(実返却は max_rows でこれ以下になり得る)
  const MAX_REQUESTS = 200; // 安全弁:最大 20 万件相当。無限ループ防止。
  const rows: T[] = [];
  let from = 0;
  for (let req = 0; req < MAX_REQUESTS; req++) {
    const { data, error } = await buildPage(from, from + SPAN - 1);
    if (error || !data) return { rows, complete: false }; // 途中失敗:取れた分で打ち切り
    if (data.length === 0) return { rows, complete: true }; // 空ページ = 末尾に到達
    rows.push(...data);
    from += data.length; // 実返却数だけ前進(max_rows < SPAN でも取りこぼさない)
  }
  // MAX_REQUESTS 到達(極端に多い)。無言切り捨てを避けて警告を残す。
  console.warn("[supabase/paginate] fetchAllRows hit MAX_REQUESTS cap", { fetched: rows.length });
  return { rows, complete: false };
}
