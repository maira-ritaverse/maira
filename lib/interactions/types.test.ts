import { describe, it, expect } from "vitest";
import {
  createInteractionRequestSchema,
  getInteractionTypeConfig,
  interactionTypeConfig,
  updateInteractionRequestSchema,
  type InteractionType,
} from "./types";

/**
 * 対応履歴(client_interactions)の定数と zod スキーマのテスト。
 *
 * interactionTypeConfig は DB の check 制約と画面表示の単一情報源。
 * 想定外の type を渡したときのフォールバックを明示テスト(referrals は先頭、
 * agency-tasks の priority は中央値、こちらは "other" を返す設計)。
 */

const VALID_UUID = "12345678-1234-1234-1234-123456789012";
const ALL_TYPES: InteractionType[] = ["call", "email", "meeting", "message", "note", "other"];

describe("interactionTypeConfig", () => {
  it("全 InteractionType に config がある", () => {
    for (const t of ALL_TYPES) {
      expect(interactionTypeConfig.find((c) => c.value === t)).toBeDefined();
    }
  });

  it("config 数が union と一致", () => {
    expect(interactionTypeConfig).toHaveLength(ALL_TYPES.length);
  });

  it("label は全部非空", () => {
    for (const c of interactionTypeConfig) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("other の order は 99(末尾扱い)", () => {
    const other = interactionTypeConfig.find((c) => c.value === "other");
    expect(other?.order).toBe(99);
  });

  it("other 以外は order 1〜5 の連番(並び順を担保)", () => {
    const orders = interactionTypeConfig
      .filter((c) => c.value !== "other")
      .map((c) => c.order)
      .sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("getInteractionTypeConfig", () => {
  it("有効な type の config を返す", () => {
    expect(getInteractionTypeConfig("call").label).toBe("電話");
    expect(getInteractionTypeConfig("email").label).toBe("メール");
    expect(getInteractionTypeConfig("meeting").label).toBe("面談");
    expect(getInteractionTypeConfig("other").label).toBe("その他");
  });

  it("想定外は 'other'(末尾=配列の最後)にフォールバック", () => {
    // referrals は先頭、agency-tasks の priority は中央値、interactions は末尾(other)
    // を返す。それぞれ業務上の「無難な見え方」が違うことを示すコメント。
    const r = getInteractionTypeConfig("unknown" as InteractionType);
    expect(r.value).toBe("other");
  });
});

describe("createInteractionRequestSchema", () => {
  const base = {
    client_record_id: VALID_UUID,
    interaction_type: "call" as const,
  };

  it("最小構成(client + type)で通る", () => {
    expect(createInteractionRequestSchema.safeParse(base).success).toBe(true);
  });

  it("client_record_id は UUID 必須", () => {
    expect(
      createInteractionRequestSchema.safeParse({ ...base, client_record_id: "not-uuid" }).success,
    ).toBe(false);
  });

  it("referral_id は省略 / null / UUID を許容", () => {
    expect(createInteractionRequestSchema.safeParse({ ...base, referral_id: null }).success).toBe(
      true,
    );
    expect(
      createInteractionRequestSchema.safeParse({ ...base, referral_id: VALID_UUID }).success,
    ).toBe(true);
    expect(createInteractionRequestSchema.safeParse({ ...base, referral_id: "abc" }).success).toBe(
      false,
    );
  });

  it("interaction_type は ALL_TYPES のみ", () => {
    for (const t of ALL_TYPES) {
      expect(
        createInteractionRequestSchema.safeParse({ ...base, interaction_type: t }).success,
      ).toBe(true);
    }
    expect(
      createInteractionRequestSchema.safeParse({ ...base, interaction_type: "fax" }).success,
    ).toBe(false);
  });

  it("summary は 200 文字までは OK / 201 で失敗 / 空文字 OK", () => {
    expect(
      createInteractionRequestSchema.safeParse({ ...base, summary: "a".repeat(200) }).success,
    ).toBe(true);
    expect(
      createInteractionRequestSchema.safeParse({ ...base, summary: "a".repeat(201) }).success,
    ).toBe(false);
    expect(createInteractionRequestSchema.safeParse({ ...base, summary: "" }).success).toBe(true);
  });

  it("body は 5000 文字までは OK / 5001 で失敗", () => {
    expect(
      createInteractionRequestSchema.safeParse({ ...base, body: "a".repeat(5000) }).success,
    ).toBe(true);
    expect(
      createInteractionRequestSchema.safeParse({ ...base, body: "a".repeat(5001) }).success,
    ).toBe(false);
  });

  it("occurred_at は ISO 8601 のみ(YYYY-MM-DD だけは不可)", () => {
    expect(
      createInteractionRequestSchema.safeParse({ ...base, occurred_at: "2026-06-14T12:00:00Z" })
        .success,
    ).toBe(true);
    expect(
      createInteractionRequestSchema.safeParse({ ...base, occurred_at: "2026-06-14" }).success,
    ).toBe(false);
  });
});

describe("updateInteractionRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updateInteractionRequestSchema.safeParse({}).success).toBe(true);
  });

  it("client_record_id は更新スキーマには無い(変更不可なため)", () => {
    // 仕様確認:client_record_id を渡しても通る(zod は strict ではない=余分は無視)
    // クライアント変更は禁止だが、サーバー側ロジックで弾く想定。
    const r = updateInteractionRequestSchema.safeParse({ client_record_id: VALID_UUID });
    expect(r.success).toBe(true);
  });

  it("interaction_type は enum 検証される", () => {
    expect(updateInteractionRequestSchema.safeParse({ interaction_type: "call" }).success).toBe(
      true,
    );
    expect(updateInteractionRequestSchema.safeParse({ interaction_type: "fax" }).success).toBe(
      false,
    );
  });

  it("summary / body の文字数制限も維持", () => {
    expect(updateInteractionRequestSchema.safeParse({ summary: "a".repeat(201) }).success).toBe(
      false,
    );
    expect(updateInteractionRequestSchema.safeParse({ body: "a".repeat(5001) }).success).toBe(
      false,
    );
  });
});
