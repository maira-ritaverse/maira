import { describe, it, expect } from "vitest";
import { loginSchema, requestPasswordResetSchema, resetPasswordSchema, signupSchema } from "./auth";

/**
 * 認証フォームの zod スキーマテスト。
 *
 * 4 つのフォーム(signup / login / requestPasswordReset / resetPassword)が
 * email・password の文字数制限・必須・refine の挙動で「同じ契約」を持つように
 * 揃えるための回帰テスト。bcrypt 上限(72 文字)はサーバー側 Supabase Auth と
 * 一致させる必要があるので、境界値を明示。
 */

describe("signupSchema", () => {
  // ADR 0006 で agreeToTerms を必須化したため、valid fixture にも含める
  const valid = {
    email: "user@example.com",
    password: "securePass123",
    displayName: "田中太郎",
    agreeToTerms: true,
  } as const;

  it("最小構成で通る(invitationToken なし)", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("invitationToken ありでも通る", () => {
    expect(signupSchema.safeParse({ ...valid, invitationToken: "tok-abc-123" }).success).toBe(true);
  });

  it("email が空 / 不正形式は失敗", () => {
    expect(signupSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, email: "not-email" }).success).toBe(false);
  });

  it("password は 12 文字未満 / 73 文字超で失敗、12〜72 で通る", () => {
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(11) }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(12) }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(72) }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(73) }).success).toBe(false);
  });

  it("displayName は 1〜50 文字", () => {
    expect(signupSchema.safeParse({ ...valid, displayName: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, displayName: "a".repeat(50) }).success).toBe(true);
    expect(signupSchema.safeParse({ ...valid, displayName: "a".repeat(51) }).success).toBe(false);
  });

  it("invitationToken は 1〜256 文字(渡す場合)", () => {
    expect(signupSchema.safeParse({ ...valid, invitationToken: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, invitationToken: "a".repeat(256) }).success).toBe(
      true,
    );
    expect(signupSchema.safeParse({ ...valid, invitationToken: "a".repeat(257) }).success).toBe(
      false,
    );
  });

  // ADR 0006:利用規約とプライバシーポリシー同意は必須
  it("agreeToTerms が undefined / false は失敗", () => {
    const { agreeToTerms: _agree, ...withoutAgree } = valid;
    void _agree;
    expect(signupSchema.safeParse(withoutAgree).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, agreeToTerms: false }).success).toBe(false);
  });

  it("agreeToTerms = true で通る", () => {
    expect(signupSchema.safeParse({ ...valid, agreeToTerms: true }).success).toBe(true);
  });
});

describe("loginSchema", () => {
  const valid = { email: "user@example.com", password: "anything" };

  it("正常入力で通る", () => {
    expect(loginSchema.safeParse(valid).success).toBe(true);
  });

  it("password は最小 1 文字でも OK(ログイン側は強度チェックしない契約)", () => {
    // signup と違い、ログインは既存ユーザーのパスワード強度をフィルタしない。
    // 「弱いパスワードでも既存アカウントには入れる」を担保。
    expect(loginSchema.safeParse({ ...valid, password: "a" }).success).toBe(true);
  });

  it("email が空 / 不正なら失敗", () => {
    expect(loginSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ ...valid, email: "not-email" }).success).toBe(false);
  });

  it("password が空なら失敗", () => {
    expect(loginSchema.safeParse({ ...valid, password: "" }).success).toBe(false);
  });
});

describe("requestPasswordResetSchema", () => {
  it("正常な email で通る", () => {
    expect(requestPasswordResetSchema.safeParse({ email: "user@example.com" }).success).toBe(true);
  });

  it("email が空 / 不正なら失敗", () => {
    expect(requestPasswordResetSchema.safeParse({ email: "" }).success).toBe(false);
    expect(requestPasswordResetSchema.safeParse({ email: "not-email" }).success).toBe(false);
  });
});

describe("resetPasswordSchema — 基本", () => {
  const valid = { new_password: "newPass123456", confirm_password: "newPass123456" };

  it("正常入力で通る", () => {
    expect(resetPasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("12 文字未満 / 72 文字境界", () => {
    expect(
      resetPasswordSchema.safeParse({
        new_password: "a".repeat(11),
        confirm_password: "a".repeat(11),
      }).success,
    ).toBe(false);
    const p72 = "a".repeat(72);
    expect(
      resetPasswordSchema.safeParse({ new_password: p72, confirm_password: p72 }).success,
    ).toBe(true);
    const p73 = "a".repeat(73);
    expect(
      resetPasswordSchema.safeParse({ new_password: p73, confirm_password: p73 }).success,
    ).toBe(false);
  });
});

describe("resetPasswordSchema — refine(現パスワード差分は要求しない設計)", () => {
  it("確認用が不一致で失敗、エラーパスは confirm_password", () => {
    const r = resetPasswordSchema.safeParse({
      new_password: "newPass123456",
      confirm_password: "differentPass",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("confirm_password"));
      expect(issue?.message).toContain("一致しません");
    }
  });

  it("changePasswordRequestSchema と違い、現パスとの差分 refine は無い(forgot 経路の前提)", () => {
    // ユーザーは現パスワードを忘れている前提のフロー。
    // 新パスが「以前と同じだったとしても」通る契約を明示。
    // (実際に同じパスを設定する意味は薄いが、フロー上は弾かない)
    expect(
      resetPasswordSchema.safeParse({
        new_password: "samePass1234",
        confirm_password: "samePass1234",
      }).success,
    ).toBe(true);
  });
});
