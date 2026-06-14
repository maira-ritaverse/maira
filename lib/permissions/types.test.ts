import { describe, it, expect } from "vitest";
import {
  emptyPermissionFlags,
  PERMISSION_KEYS,
  permissionConfig,
  type MemberPermissionFlags,
  type PermissionKey,
} from "./types";

/**
 * 権限定義の構造テスト。
 *
 * PERMISSION_KEYS は DB の member_permissions.permission_key と同期する単一情報源。
 * permissionConfig が抜けると UI で権限のラベル / 説明が出なくなる。
 * emptyPermissionFlags が全 PERMISSION_KEYS をカバーしないと、新キー追加時に
 * 「権限フラグの初期値が undefined」になり、`flags[key] === true` の判定が
 * 一律 false に倒れて静かに権限ガードが効かなくなる(セキュリティ事故)。
 */

describe("PERMISSION_KEYS", () => {
  it("export キーが存在する", () => {
    expect(PERMISSION_KEYS.EXPORT).toBe("export");
  });

  it("値はキーから取り出した PermissionKey 互換", () => {
    const values = Object.values(PERMISSION_KEYS);
    expect(values).toContain("export");
    // 全部 string
    for (const v of values) {
      expect(typeof v).toBe("string");
    }
  });
});

describe("permissionConfig", () => {
  it("全 PERMISSION_KEYS にラベルと説明が定義されている", () => {
    const keys = Object.values(PERMISSION_KEYS) as PermissionKey[];
    for (const k of keys) {
      expect(permissionConfig[k]).toBeDefined();
      expect(permissionConfig[k].label.length).toBeGreaterThan(0);
      expect(permissionConfig[k].description.length).toBeGreaterThan(0);
    }
  });

  it("permissionConfig のキーが PERMISSION_KEYS の値集合と一致", () => {
    const configKeys = Object.keys(permissionConfig).sort();
    const permissionValues = Object.values(PERMISSION_KEYS).sort();
    expect(configKeys).toEqual(permissionValues);
  });
});

describe("emptyPermissionFlags", () => {
  it("全 PERMISSION_KEYS が含まれ、全部 false で初期化される", () => {
    const flags = emptyPermissionFlags();
    const keys = Object.values(PERMISSION_KEYS) as PermissionKey[];
    for (const k of keys) {
      expect(flags[k], `${k} が emptyPermissionFlags に含まれていない`).toBe(false);
    }
  });

  it("返り値のキー集合が PERMISSION_KEYS と完全一致", () => {
    // 余計なキーが混ざっていないかも検証
    const flags = emptyPermissionFlags();
    const flagKeys = Object.keys(flags).sort();
    const permissionValues = Object.values(PERMISSION_KEYS).sort();
    expect(flagKeys).toEqual(permissionValues);
  });

  it("呼び出すたびに新しいオブジェクトを返す(参照共有しない)", () => {
    // 同じ参照を返すと「片方を書き換えると別呼び出し先にも波及」する事故が起きる
    const a = emptyPermissionFlags();
    const b = emptyPermissionFlags();
    expect(a).not.toBe(b);
    a.export = true;
    expect(b.export).toBe(false); // a の変更は b に影響しない
  });

  it("MemberPermissionFlags 型に代入できる", () => {
    // 型レベルの保証(コンパイル時)。実行時は flags が PERMISSION_KEYS 全部を持つかを確認。
    const flags: MemberPermissionFlags = emptyPermissionFlags();
    expect(flags).toBeDefined();
  });
});
