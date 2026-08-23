import { describe, expect, it } from "vitest";

import { executeSubscriptionTick, type SubscriptionRow } from "./flow-executor";

/**
 * flow-executor の二重ディスパッチ防止(CAS リース)の契約テスト。
 *
 * ここでは tick 冒頭の「確保(claim)」の分岐だけを検証する。claim が 0 行 =
 * 別ワーカーが既に確保済みなら、以降の DB アクセス(flow / step 取得や送信)を
 * 一切行わずに skipped で降りることを確認する。これにより cron のオーバーラップ /
 * 二重発火時に同一ステップが二重送信されないことを担保する。
 *
 * claim 成功後の本処理は多数の DB 呼び出しを伴うため本テストの対象外
 * (別途 flow-scheduler / segment-eval 等の純関数テストで各部品を検証している)。
 */

type ClaimResult = { data: unknown; error: { message: string } | null };

/**
 * claim クエリチェーン
 * (.from().update().eq().eq().eq().select())だけを満たす最小モック。
 */
function makeSupabaseClaimMock(claimResult: ClaimResult) {
  const calls = {
    fromTables: [] as string[],
    updatePayload: undefined as Record<string, unknown> | undefined,
    eqFilters: [] as Array<[string, unknown]>,
    selectArg: undefined as unknown,
  };
  const builder = {
    update(payload: Record<string, unknown>) {
      calls.updatePayload = payload;
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.eqFilters.push([col, val]);
      return builder;
    },
    select(arg: unknown) {
      calls.selectArg = arg;
      return Promise.resolve(claimResult);
    },
  };
  const supabase = {
    from(table: string) {
      calls.fromTables.push(table);
      return builder;
    },
  };
  // executeSubscriptionTick は SupabaseClient 型を期待するが、claim 分岐で使うのは
  // from/update/eq/select のみ。テスト用に構造的部分型を as でキャストする。
  return { supabase: supabase as never, calls };
}

const BASE_SUB: SubscriptionRow = {
  id: "sub-1",
  organization_id: "org-1",
  flow_id: "flow-1",
  line_user_id: "U0123456789",
  client_record_id: null,
  current_step_order: 0,
  // マイクロ秒精度をそのまま CAS フィルタに使う(dispatcher が読んだ生の文字列)
  next_action_at: "2026-08-23T05:00:00.123456+00:00",
  status: "active",
  entered_at: "2026-08-23T00:00:00+00:00",
};

describe("executeSubscriptionTick: 二重ディスパッチ防止(CAS リース)", () => {
  it("claim が 0 行(別ワーカーが確保済み)なら skipped で降り、以降のテーブルに触れない", async () => {
    const { supabase, calls } = makeSupabaseClaimMock({ data: [], error: null });

    const result = await executeSubscriptionTick(supabase, BASE_SUB);

    expect(result).toEqual({ kind: "skipped", reason: "already_claimed" });
    // claim の 1 回のみ。flow / step 取得や送信には進んでいない。
    expect(calls.fromTables).toEqual(["ma_flow_subscriptions"]);
  });

  it("claim は id / status=active / 読み取った next_action_at を CAS 条件にし、リースへ前進させる", async () => {
    const { supabase, calls } = makeSupabaseClaimMock({ data: [], error: null });

    await executeSubscriptionTick(supabase, BASE_SUB);

    // CAS 条件:同じ行 かつ まだ active かつ next_action_at が読み取り時と同一
    expect(calls.eqFilters).toEqual([
      ["id", "sub-1"],
      ["status", "active"],
      ["next_action_at", "2026-08-23T05:00:00.123456+00:00"],
    ]);
    expect(calls.selectArg).toBe("id");
    // next_action_at を未来(リース時刻)へ前進させている
    const leased = calls.updatePayload?.next_action_at;
    expect(typeof leased).toBe("string");
    expect(new Date(leased as string).getTime()).toBeGreaterThan(
      new Date(BASE_SUB.next_action_at).getTime(),
    );
  });

  it("claim が成功(1 行)なら claim 分岐で降りず本処理(ma_flows 取得)へ進む", async () => {
    const { supabase, calls } = makeSupabaseClaimMock({ data: [{ id: "sub-1" }], error: null });

    // claim 後、後続の ma_flows 取得で最小モックが尽きて throw するが、それは想定内。
    // ここで確認したいのは「claim 成功時に skipped/failed で早期 return せず、
    // 実際に本処理(ma_flows 取得)へ進んでいる」こと。
    await executeSubscriptionTick(supabase, BASE_SUB).catch(() => {});

    expect(calls.fromTables).toContain("ma_flows");
  });

  it("claim 自体が DB エラーなら tick_failure を増やさず failed(claim_failed)を返す", async () => {
    const { supabase, calls } = makeSupabaseClaimMock({
      data: null,
      error: { message: "boom" },
    });

    const result = await executeSubscriptionTick(supabase, BASE_SUB);

    expect(result).toEqual({ kind: "failed", error: "claim_failed:boom" });
    // 失敗回数の読み書き等、追加の DB アクセスをしていない(claim の 1 回のみ)
    expect(calls.fromTables).toEqual(["ma_flow_subscriptions"]);
  });
});
