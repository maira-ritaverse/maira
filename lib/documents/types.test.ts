import { describe, it, expect } from "vitest";
import {
  documentTypeDescriptions,
  documentTypeLabels,
  documentTypes,
  generateDocumentRequestSchema,
  getDocumentTypeLabel,
  requiresJobInfo,
  type DocumentType,
} from "./types";

/**
 * 書類タイプの定義と純関数のテスト。
 *
 * getDocumentTypeLabel は Phase A 整理で削除された 'resume' / 'cv' を持つ
 * 既存レコードを「undefined」表示にしない防御層。現行 + 旧タイプ + 未知の
 * 値で UI に必ず人間可読な文字列を返す契約を担保。
 */

const ALL_TYPES: DocumentType[] = ["motivation", "self_pr"];

describe("documentTypes / documentTypeLabels / documentTypeDescriptions", () => {
  it("全 DocumentType にラベルと説明がある", () => {
    for (const t of ALL_TYPES) {
      expect(documentTypeLabels[t]).toBeTruthy();
      expect(documentTypeDescriptions[t]).toBeTruthy();
    }
  });

  it("Record キーが union と一致", () => {
    expect(Object.keys(documentTypeLabels).sort()).toEqual([...ALL_TYPES].sort());
    expect(Object.keys(documentTypeDescriptions).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("documentTypes は ['motivation', 'self_pr']", () => {
    expect(documentTypes).toEqual(["motivation", "self_pr"]);
  });
});

describe("requiresJobInfo", () => {
  it("motivation / self_pr は両方 true(求人情報必須の契約)", () => {
    expect(requiresJobInfo("motivation")).toBe(true);
    expect(requiresJobInfo("self_pr")).toBe(true);
  });
});

describe("getDocumentTypeLabel — フォールバック", () => {
  it("現行 DocumentType はラベルを返す", () => {
    expect(getDocumentTypeLabel("motivation")).toBe("志望動機");
    expect(getDocumentTypeLabel("self_pr")).toBe("自己PR");
  });

  it("旧タイプ 'resume' / 'cv' は明示ラベル", () => {
    expect(getDocumentTypeLabel("resume")).toBe("履歴書(旧)");
    expect(getDocumentTypeLabel("cv")).toBe("職務経歴書(旧)");
  });

  it("null / undefined / 空文字は '書類'", () => {
    expect(getDocumentTypeLabel(null)).toBe("書類");
    expect(getDocumentTypeLabel(undefined)).toBe("書類");
    expect(getDocumentTypeLabel("")).toBe("書類");
  });

  it("未知の値も '書類' にフォールバック(undefined 表示を防止)", () => {
    expect(getDocumentTypeLabel("unknown")).toBe("書類");
    expect(getDocumentTypeLabel("MOTIVATION")).toBe("書類"); // 大文字違いも fallback
  });
});

describe("generateDocumentRequestSchema", () => {
  it("最小構成(type のみ)で通る", () => {
    expect(generateDocumentRequestSchema.safeParse({ type: "motivation" }).success).toBe(true);
  });

  it("type は ALL_TYPES のみ", () => {
    for (const t of ALL_TYPES) {
      expect(generateDocumentRequestSchema.safeParse({ type: t }).success).toBe(true);
    }
    expect(generateDocumentRequestSchema.safeParse({ type: "resume" }).success).toBe(false);
    expect(generateDocumentRequestSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("jobInfo / customInstructions は省略可", () => {
    expect(
      generateDocumentRequestSchema.safeParse({
        type: "motivation",
        jobInfo: "求人情報",
        customInstructions: "指示",
      }).success,
    ).toBe(true);
  });
});
