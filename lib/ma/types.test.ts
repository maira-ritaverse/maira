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
  it("現状 の 実装済 シナリオ キー は Email 7 件 + LINE 7 件 = 14 件", () => {
    // この件数を増やすときは Edge Function / cron route 側 にも 対応 ロジック を 追加 して から 更新 する。
    expect(IMPLEMENTED_SCENARIO_KEYS).toEqual([
      "register_meeting_promotion",
      "dormant_outreach",
      "line_welcome_after_friend",
      "line_dormant_outreach",
      "meeting_reminder",
      "job_introduction",
      "after_interview_followup",
      "post_placement_followup",
      "birthday_greeting",
      "line_register_meeting_promotion",
      "line_meeting_reminder",
      "line_job_introduction",
      "line_after_interview_followup",
      "line_birthday_greeting",
    ]);
  });
});

describe("isScenarioImplemented", () => {
  it("実装済みキー (Email 7 件 + LINE 2 件) には true を返す(型ガードとしても機能)", () => {
    // Phase C-3
    expect(isScenarioImplemented("register_meeting_promotion")).toBe(true);
    expect(isScenarioImplemented("dormant_outreach")).toBe(true);
    // Phase C-4 (LINE)
    expect(isScenarioImplemented("line_welcome_after_friend")).toBe(true);
    expect(isScenarioImplemented("line_dormant_outreach")).toBe(true);
    // Phase C-5 (interviews / birth_date 前提)
    expect(isScenarioImplemented("meeting_reminder")).toBe(true);
    expect(isScenarioImplemented("job_introduction")).toBe(true);
    expect(isScenarioImplemented("after_interview_followup")).toBe(true);
    expect(isScenarioImplemented("post_placement_followup")).toBe(true);
    expect(isScenarioImplemented("birthday_greeting")).toBe(true);
  });

  it("未投入 / タイポ の プリセット キー には false を返す", () => {
    // ma_scenario_presets に 投入 されて いない 想定 の キー。
    expect(isScenarioImplemented("never_existed_scenario")).toBe(false);
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
