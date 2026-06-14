import { describe, it, expect } from "vitest";
import {
  PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
  PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC,
} from "./photo-signed-url";

/**
 * 履歴書写真の署名URL 有効期限定数のテスト。
 *
 * これらは「URL 漏えい時の被害最小化」というセキュリティ責務を持つ値。
 * PDF 用は短命(漏れても再利用される前に切れる)、プレビュー用は長め
 * (ユーザーがページを開いたままにしても切れない)という設計判断を
 * テストで明文化する。
 *
 * 値そのものを直接 assert することで、誰かが PDF 用を 1 時間に伸ばすような
 * 安全側を崩す変更を入れたら確実に気付く。
 */

describe("PHOTO_SIGNED_URL_* 定数", () => {
  it("プレビュー用は 1 時間(60 * 60 秒)", () => {
    expect(PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC).toBe(60 * 60);
  });

  it("PDF 用は 5 分(5 * 60 秒)— URL 漏えい時の被害最小化", () => {
    expect(PHOTO_SIGNED_URL_PDF_EXPIRES_SEC).toBe(5 * 60);
  });

  it("PDF 用 < プレビュー用(PDF は必ず短命であるべき設計契約)", () => {
    // この不等式が崩れたら設計の意図が逆転している。
    // PDF 生成は networkidle0 完了直後に署名URL が切れるべきで、
    // プレビューと同じ長さにしてはいけない。
    expect(PHOTO_SIGNED_URL_PDF_EXPIRES_SEC).toBeLessThan(PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC);
  });

  it("両方とも 0 より大きい正の整数", () => {
    expect(PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC).toBeGreaterThan(0);
    expect(PHOTO_SIGNED_URL_PDF_EXPIRES_SEC).toBeGreaterThan(0);
    expect(Number.isInteger(PHOTO_SIGNED_URL_PREVIEW_EXPIRES_SEC)).toBe(true);
    expect(Number.isInteger(PHOTO_SIGNED_URL_PDF_EXPIRES_SEC)).toBe(true);
  });
});
