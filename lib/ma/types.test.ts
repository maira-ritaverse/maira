import { describe, it, expect } from "vitest";
import { IMPLEMENTED_SCENARIO_KEYS, isScenarioImplemented } from "./types";

/**
 * 「実装済みシナリオキー」の判定テスト。
 *
 * UI(scenario-list)と Edge Function(ma-send-campaign)の両方が、この集合を
 * 単一情報源として参照している。意図せず集合が変わると「UI で配信中表示なのに
 * 実際は送られない」という静かな運用事故になりうるので、テストで明示する。
 */

describe("IMPLEMENTED_SCENARIO_KEYS", () => {
  it("現状の実装済みシナリオキーは 2 種類(register_meeting_promotion / dormant_outreach)", () => {
    // この件数を増やすときは Edge Function 側にも対応ロジックを追加してから更新する。
    expect(IMPLEMENTED_SCENARIO_KEYS).toEqual(["register_meeting_promotion", "dormant_outreach"]);
  });
});

describe("isScenarioImplemented", () => {
  it("実装済みキーには true を返す(型ガードとしても機能する)", () => {
    expect(isScenarioImplemented("register_meeting_promotion")).toBe(true);
    expect(isScenarioImplemented("dormant_outreach")).toBe(true);
  });

  it("未実装のプリセットキーには false を返す", () => {
    // ma_scenario_presets に投入されているが、判定ロジックが未実装のシナリオ。
    expect(isScenarioImplemented("meeting_reminder")).toBe(false);
    expect(isScenarioImplemented("job_introduction")).toBe(false);
    expect(isScenarioImplemented("after_interview_followup")).toBe(false);
    expect(isScenarioImplemented("post_placement_followup")).toBe(false);
    expect(isScenarioImplemented("birthday_greeting")).toBe(false);
  });

  it("全く別の文字列(タイポ・無関係)にも false を返す", () => {
    expect(isScenarioImplemented("")).toBe(false);
    expect(isScenarioImplemented("REGISTER_MEETING_PROMOTION")).toBe(false); // 大文字違い
    expect(isScenarioImplemented("register_meeting_promotion ")).toBe(false); // 末尾空白
    expect(isScenarioImplemented("unknown_key")).toBe(false);
  });

  it("型ガード後は ImplementedScenarioKey として扱える(コンパイル時保証のためのスモーク)", () => {
    const key: string = "register_meeting_promotion";
    if (isScenarioImplemented(key)) {
      // 型レベルで ImplementedScenarioKey に絞り込まれる。
      // ここで構文エラーにならないことが TS の保証(実行時 expect は不要だがケースとして残す)。
      expect(key).toBe("register_meeting_promotion");
    } else {
      // ここには来ないはず
      throw new Error("型ガードが効いていない");
    }
  });
});
