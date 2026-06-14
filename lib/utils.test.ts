import { describe, it, expect } from "vitest";
import { cn } from "./utils";

/**
 * shadcn/ui の cn 関数(clsx + tailwind-merge)テスト。
 *
 * 影響範囲が広い(全コンポーネントが使う)割に挙動を勘違いしやすいので、
 * 「条件付きクラス / 重複した tailwind の衝突を後勝ちで解決 / falsy 除外」
 * の契約を明示テスト。
 */

describe("cn — 基本挙動", () => {
  it("文字列を結合する", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("空入力なら空文字", () => {
    expect(cn()).toBe("");
  });

  it("falsy(undefined / null / false / '')は無視する", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("配列もフラット化して結合", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("条件付きオブジェクト({class: bool})もサポート", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
});

describe("cn — tailwind-merge の衝突解決", () => {
  it("後勝ち:p-2 と p-4 が並ぶと p-4 だけ残る", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("text-red-500 → text-blue-500 で後勝ち", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("衝突しないクラスは両方残る(text-sm + font-bold)", () => {
    const result = cn("text-sm", "font-bold");
    expect(result).toContain("text-sm");
    expect(result).toContain("font-bold");
  });

  it("条件付きで上書き(active 時だけ別の色を当てる)", () => {
    const active = true;
    expect(cn("text-gray-500", active && "text-blue-500")).toBe("text-blue-500");
  });
});
