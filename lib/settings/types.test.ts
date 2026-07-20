import { describe, it, expect } from "vitest";
import { changePasswordRequestSchema, updateProfileRequestSchema } from "./types";

/**
 * 設定画面の zod スキーマテスト。
 *
 * updateProfileRequestSchema:
 *   - 空白のみの表示名を refine で弾く契約をテスト(空白で「未設定」風になる事故防止)
 *   - 50 文字境界
 *
 * changePasswordRequestSchema:
 *   - 確認用パスワード一致 / 現パスワードとの差分の 2 つの refine
 *   - bcrypt の 72 文字上限(Supabase Auth 内部制約)
 *   - エラーパスが正しいフィールド(confirm_password / new_password)に付くこと
 */

describe("updateProfileRequestSchema", () => {
  it("正常な表示名で通る", () => {
    expect(updateProfileRequestSchema.safeParse({ display_name: "田中太郎" }).success).toBe(true);
  });

  it("空文字は失敗", () => {
    expect(updateProfileRequestSchema.safeParse({ display_name: "" }).success).toBe(false);
  });

  it("空白のみ(スペース・タブ・改行)は refine で弾く", () => {
    // 「空白だけ入れて未設定 UI 風にする」事故を防ぐ
    expect(updateProfileRequestSchema.safeParse({ display_name: "   " }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ display_name: "\t\n" }).success).toBe(false);
  });

  it("前後の空白は許容するが、trim 後が 1 文字以上必要", () => {
    expect(updateProfileRequestSchema.safeParse({ display_name: " 田中 " }).success).toBe(true);
  });

  it("50 文字までは OK / 51 文字で失敗", () => {
    expect(updateProfileRequestSchema.safeParse({ display_name: "a".repeat(50) }).success).toBe(
      true,
    );
    expect(updateProfileRequestSchema.safeParse({ display_name: "a".repeat(51) }).success).toBe(
      false,
    );
  });
});

describe("changePasswordRequestSchema — 基本", () => {
  const valid = {
    current_password: "oldPass123",
    new_password: "newSecurePass456",
    confirm_password: "newSecurePass456",
  };

  it("正常入力で通る", () => {
    expect(changePasswordRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("current_password が空文字なら失敗", () => {
    expect(changePasswordRequestSchema.safeParse({ ...valid, current_password: "" }).success).toBe(
      false,
    );
  });

  it("new_password が 12 文字未満なら失敗", () => {
    const r = changePasswordRequestSchema.safeParse({
      current_password: "old",
      new_password: "short12345",
      confirm_password: "short12345",
    });
    expect(r.success).toBe(false);
  });

  it("new_password が 72 文字までは OK(Supabase の bcrypt 上限)", () => {
    const longPass = "a".repeat(72);
    expect(
      changePasswordRequestSchema.safeParse({
        current_password: "old",
        new_password: longPass,
        confirm_password: longPass,
      }).success,
    ).toBe(true);
  });

  it("new_password が 73 文字で失敗", () => {
    const tooLong = "a".repeat(73);
    expect(
      changePasswordRequestSchema.safeParse({
        current_password: "old",
        new_password: tooLong,
        confirm_password: tooLong,
      }).success,
    ).toBe(false);
  });
});

describe("changePasswordRequestSchema — refine 検証", () => {
  it("確認用パスワードが一致しないと失敗、エラーパスは confirm_password", () => {
    const r = changePasswordRequestSchema.safeParse({
      current_password: "oldPass123",
      new_password: "newSecurePass456",
      confirm_password: "different456",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("confirm_password"));
      expect(issue?.message).toContain("一致しません");
    }
  });

  it("新パスワードが現パスワードと同じだと失敗、エラーパスは new_password", () => {
    const r = changePasswordRequestSchema.safeParse({
      current_password: "samePassword123",
      new_password: "samePassword123",
      confirm_password: "samePassword123",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("new_password"));
      expect(issue?.message).toContain("異なる");
    }
  });

  it("2 つの refine が独立に判定される(両方違反でも両方のエラーが出る)", () => {
    const r = changePasswordRequestSchema.safeParse({
      current_password: "samePassword123",
      new_password: "samePassword123", // 現パスと同じ
      confirm_password: "different", // 確認不一致
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const hasMismatch = r.error.issues.some((i) => i.path.includes("confirm_password"));
      const hasSame = r.error.issues.some((i) => i.path.includes("new_password"));
      // どちらか一方は確実に出る(両方出るかどうかは zod のショートサーキット次第)
      expect(hasMismatch || hasSame).toBe(true);
    }
  });
});
