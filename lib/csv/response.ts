/**
 * CSV ダウンロード用 Response 構築ヘルパー
 *
 * - Content-Type は text/csv; charset=utf-8(BOM は本文側で付与)
 * - ASCII safe な filename と RFC 5987 形式 filename*= を両方付ける
 *   (古いブラウザ向け fallback と UTF-8 ファイル名の両対応)
 */

export function csvResponse(body: string, filename: string): Response {
  const asciiSafe = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`,
      "cache-control": "no-store",
    },
  });
}
