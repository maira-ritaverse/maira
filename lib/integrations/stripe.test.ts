import { describe, expect, it } from "vitest";

import { buildOrgLineItems, type OrgStripeConfig } from "./stripe";

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
});
