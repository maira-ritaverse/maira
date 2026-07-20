import { describe, expect, it } from "vitest";

import {
  buildOrgLineItems,
  buildSoloLineItems,
  isSoloStripeConfigured,
  type OrgStripeConfig,
} from "./stripe";

const CONFIG: OrgStripeConfig = {
  secretKey: "sk_test_dummy",
  siteUrl: "https://www.example.com",
  prices: {
    standardBaseMonthly: "price_base_m",
    standardBaseYearly: "price_base_y",
    extraSeatMonthly: "price_seat_m",
    extraSeatYearly: "price_seat_y",
    aiBoostMonthly: "price_boost_m",
    aiBoostYearly: "price_boost_y",
    // Solo 系 (Phase 2 で 追加、 env 未設定 環境 は 空文字)
    soloMonthly: "price_solo_m",
    soloYearly: "price_solo_y",
    soloProMonthly: "price_solo_pro_m",
    soloProYearly: "price_solo_pro_y",
  },
};

const CONFIG_WITHOUT_SOLO: OrgStripeConfig = {
  ...CONFIG,
  prices: {
    ...CONFIG.prices,
    soloMonthly: "",
    soloYearly: "",
    soloProMonthly: "",
    soloProYearly: "",
  },
};

describe("buildOrgLineItems", () => {
  it("Standard 月次 / 3 名 = Base のみ 1 個", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard",
      cycle: "monthly",
      seatCount: 3,
    });
    expect(items).toEqual([{ price: "price_base_m", quantity: 1 }]);
  });

  it("Standard 月次 / 5 名 = Base + Extra Seat × 2", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard",
      cycle: "monthly",
      seatCount: 5,
    });
    expect(items).toEqual([
      { price: "price_base_m", quantity: 1 },
      { price: "price_seat_m", quantity: 2 },
    ]);
  });

  it("Standard 年次 / 10 名 = Base 年 + Extra Seat 年 × 7", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard",
      cycle: "yearly",
      seatCount: 10,
    });
    expect(items).toEqual([
      { price: "price_base_y", quantity: 1 },
      { price: "price_seat_y", quantity: 7 },
    ]);
  });

  it("Pro 月次 / 3 名 = Base + AI Boost", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard_pro",
      cycle: "monthly",
      seatCount: 3,
    });
    expect(items).toEqual([
      { price: "price_base_m", quantity: 1 },
      { price: "price_boost_m", quantity: 1 },
    ]);
  });

  it("Pro 年次 / 5 名 = Base + Extra Seat × 2 + AI Boost (全 年)", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard_pro",
      cycle: "yearly",
      seatCount: 5,
    });
    expect(items).toEqual([
      { price: "price_base_y", quantity: 1 },
      { price: "price_seat_y", quantity: 2 },
      { price: "price_boost_y", quantity: 1 },
    ]);
  });

  it("Pro 月次 / 100 名 = Base + Extra Seat × 97 + AI Boost", () => {
    const items = buildOrgLineItems(CONFIG, {
      tier: "standard_pro",
      cycle: "monthly",
      seatCount: 100,
    });
    expect(items).toEqual([
      { price: "price_base_m", quantity: 1 },
      { price: "price_seat_m", quantity: 97 },
      { price: "price_boost_m", quantity: 1 },
    ]);
  });

  it("seatCount = 2 は throw (Base に 3 席 込み の 契約 上、 不正 な 入力)", () => {
    expect(() =>
      buildOrgLineItems(CONFIG, {
        tier: "standard",
        cycle: "monthly",
        seatCount: 2,
      }),
    ).toThrow(/最低 3/);
  });

  it("Solo tier は throw (buildSoloLineItems を 使う べき)", () => {
    expect(() =>
      buildOrgLineItems(CONFIG, {
        tier: "solo",
        cycle: "monthly",
        seatCount: 1,
      }),
    ).toThrow(/Solo/);
  });
});

describe("buildSoloLineItems (Phase 2)", () => {
  it("Solo 月次 = solo Monthly Price 1 個", () => {
    const items = buildSoloLineItems(CONFIG, { tier: "solo", cycle: "monthly" });
    expect(items).toEqual([{ price: "price_solo_m", quantity: 1 }]);
  });

  it("Solo 年払い = solo Yearly Price 1 個", () => {
    const items = buildSoloLineItems(CONFIG, { tier: "solo", cycle: "yearly" });
    expect(items).toEqual([{ price: "price_solo_y", quantity: 1 }]);
  });

  it("Solo Pro 月次 = solo pro Monthly Price 1 個", () => {
    const items = buildSoloLineItems(CONFIG, { tier: "solo_pro", cycle: "monthly" });
    expect(items).toEqual([{ price: "price_solo_pro_m", quantity: 1 }]);
  });

  it("Solo Pro 年払い = solo pro Yearly Price 1 個", () => {
    const items = buildSoloLineItems(CONFIG, { tier: "solo_pro", cycle: "yearly" });
    expect(items).toEqual([{ price: "price_solo_pro_y", quantity: 1 }]);
  });

  it("Solo Price ID が env 未設定 (config で 空文字) だと throw", () => {
    expect(() =>
      buildSoloLineItems(CONFIG_WITHOUT_SOLO, { tier: "solo", cycle: "monthly" }),
    ).toThrow(/Solo 系 Price ID が env に 設定 されて いません/);
  });
});

describe("isSoloStripeConfigured (Phase 2)", () => {
  it("4 種 の Solo Price ID が 全 て 設定 されて いれば true", () => {
    expect(isSoloStripeConfigured(CONFIG)).toBe(true);
  });

  it("1 つ でも 未設定 なら false (segment リリース の 判定)", () => {
    expect(isSoloStripeConfigured(CONFIG_WITHOUT_SOLO)).toBe(false);

    const partial = { ...CONFIG, prices: { ...CONFIG.prices, soloProYearly: "" } };
    expect(isSoloStripeConfigured(partial)).toBe(false);
  });
});
