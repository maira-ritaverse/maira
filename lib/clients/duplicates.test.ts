/**
 * duplicates.ts のテスト
 *
 * 検出ロジック(email / phone / name+birthdate / name_kana)それぞれの単独動作と、
 * 複数シグナルが連鎖して 1 グループに収束するケースを網羅する。
 */
import { describe, expect, it } from "vitest";

import { findDuplicateClientGroups, type ClientForDuplicateDetection } from "./duplicates";

function c(overrides: Partial<ClientForDuplicateDetection> = {}): ClientForDuplicateDetection {
  return {
    id: `id-${Math.floor(Math.random() * 1000000)}`,
    name: "田中太郎",
    email: "tanaka@example.com",
    phone: null,
    nameKana: null,
    birthDate: null,
    ...overrides,
  };
}

describe("findDuplicateClientGroups", () => {
  it("空入力は空配列", () => {
    expect(findDuplicateClientGroups([])).toEqual([]);
  });

  it("1 件入力は空配列(比較対象なし)", () => {
    expect(findDuplicateClientGroups([c({ id: "a" })])).toEqual([]);
  });

  it("email 完全一致で 1 グループ", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "x@example.com" }),
      c({ id: "b", email: "x@example.com" }),
      c({ id: "c", email: "y@example.com" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(r[0].reasons).toEqual(["email"]);
  });

  it("email は大文字小文字を無視", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "X@Example.COM" }),
      c({ id: "b", email: "x@example.com" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("phone は数字以外を除去して比較(ハイフン / 全角混在)", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "a@x.com", phone: "090-1234-5678" }),
      c({ id: "b", email: "b@x.com", phone: "09012345678" }),
      c({ id: "c", email: "c@x.com", phone: "(090) 1234-5678" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(r[0].reasons).toEqual(["phone"]);
  });

  it("phone が空文字 / null は判定対象外", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "a@x.com", phone: "" }),
      c({ id: "b", email: "b@x.com", phone: null }),
    ]);
    expect(r).toEqual([]);
  });

  it("氏名 + 生年月日 が完全一致で重複", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "a@x.com", name: "田中太郎", birthDate: "1990-01-01" }),
      c({ id: "b", email: "b@x.com", name: "田中太郎", birthDate: "1990-01-01" }),
      c({ id: "c", email: "c@x.com", name: "田中花子", birthDate: "1990-01-01" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(r[0].reasons).toEqual(["name_birthdate"]);
  });

  it("birthDate が片方 null なら検出対象外", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "a@x.com", name: "田中太郎", birthDate: "1990-01-01" }),
      c({ id: "b", email: "b@x.com", name: "田中太郎", birthDate: null }),
    ]);
    expect(r).toEqual([]);
  });

  it("氏名カナ 完全一致(前後空白を無視)", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "a@x.com", nameKana: "タナカタロウ" }),
      c({ id: "b", email: "b@x.com", nameKana: "  タナカタロウ  " }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].reasons).toEqual(["name_kana"]);
  });

  it("複数シグナルが連鎖して 1 グループに収束する(A↔B email, B↔C phone)", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "x@x.com", phone: null }),
      c({ id: "b", email: "x@x.com", phone: "090-1234-5678" }),
      c({ id: "c", email: "y@x.com", phone: "09012345678" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(r[0].reasons.sort()).toEqual(["email", "phone"]);
  });

  it("独立した 2 つの重複グループを別々に返す", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "x@x.com" }),
      c({ id: "b", email: "x@x.com" }),
      c({ id: "c", email: "y@x.com" }),
      c({ id: "d", email: "y@x.com" }),
    ]);
    expect(r).toHaveLength(2);
    const groupedIds = r.map((g) => g.members.map((m) => m.id).sort()).sort();
    expect(groupedIds).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("3 件以上のグループも 1 つにまとめる", () => {
    const r = findDuplicateClientGroups([
      c({ id: "a", email: "x@x.com" }),
      c({ id: "b", email: "x@x.com" }),
      c({ id: "c", email: "x@x.com" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].members).toHaveLength(3);
  });

  it("reasons の並びは固定(email → phone → name_birthdate → name_kana)", () => {
    const r = findDuplicateClientGroups([
      c({
        id: "a",
        email: "x@x.com",
        phone: "090-1234-5678",
        name: "田中太郎",
        birthDate: "1990-01-01",
        nameKana: "タナカタロウ",
      }),
      c({
        id: "b",
        email: "x@x.com",
        phone: "09012345678",
        name: "田中太郎",
        birthDate: "1990-01-01",
        nameKana: "タナカタロウ",
      }),
    ]);
    expect(r[0].reasons).toEqual(["email", "phone", "name_birthdate", "name_kana"]);
  });

  it("入力配列を破壊しない", () => {
    const input = [c({ id: "a", email: "x@x.com" }), c({ id: "b", email: "x@x.com" })];
    const orig = input.map((x) => ({ ...x }));
    findDuplicateClientGroups(input);
    expect(input).toEqual(orig);
  });
});
