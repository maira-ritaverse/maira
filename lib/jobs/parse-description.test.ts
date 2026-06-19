import { describe, expect, it } from "vitest";

import { parseJobDescription, sortJobDescriptionSections } from "./parse-description";

describe("parseJobDescription", () => {
  it("空入力は 空配列を 返す", () => {
    expect(parseJobDescription(null)).toEqual([]);
    expect(parseJobDescription(undefined)).toEqual([]);
    expect(parseJobDescription("")).toEqual([]);
  });

  it("★ 見出しなし は 単一セクション(title=null)で 返す", () => {
    const out = parseJobDescription("仕事内容 だけ あります\n複数行 です");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBeNull();
    expect(out[0].body).toBe("仕事内容 だけ あります\n複数行 です");
  });

  it("★ 既知見出し は セクション分割する", () => {
    const out = parseJobDescription(
      ["★ 仕事内容", "業務内容です", "★ 募集背景", "増員のため"].join("\n"),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: "仕事内容", body: "業務内容です" });
    expect(out[1]).toEqual({ title: "募集背景", body: "増員のため" });
  });

  it("本文中の '★コツコツ' (空白なし) は 本文として 残す", () => {
    // 回帰防止:AI が 原文の ★ を 残す 指示と 両立する
    const out = parseJobDescription(
      [
        "★ ポイント",
        "★コツコツ丁寧に取り組む業務です！",
        "エクセル中級者 歓迎",
        "★ 特徴",
        "土日休み",
      ].join("\n"),
    );
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("ポイント");
    expect(out[0].body).toBe("★コツコツ丁寧に取り組む業務です！\nエクセル中級者 歓迎");
    expect(out[1].title).toBe("特徴");
  });

  it("★ + 空白 + 既知 でない タイトル は 本文として 残す", () => {
    // "★ コツコツ丁寧に取り組む業務です！" (空白あり、未知タイトル) も 見出し と 誤判定しない
    const out = parseJobDescription(
      ["★ 仕事内容", "業務概要", "★ コツコツ丁寧に取り組む業務です！", "つづき"].join("\n"),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("仕事内容");
    expect(out[0].body).toBe("業務概要\n★ コツコツ丁寧に取り組む業務です！\nつづき");
  });

  it("alias(配属先 / チーム など)を 正規化する", () => {
    const out = parseJobDescription(["★ 配属先 / チーム", "10 名前後"].join("\n"));
    expect(out[0].title).toBe("配属先");
  });

  it("見出し末尾の '(必須)' '(任意)' を 無視する", () => {
    const out = parseJobDescription(
      ["★ 仕事内容(必須)", "業務", "★ 募集背景(任意、ある場合のみ)", "増員"].join("\n"),
    );
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("仕事内容");
    expect(out[1].title).toBe("募集背景");
  });

  it("冒頭の ★ 無し テキスト + ★ セクション の 混在", () => {
    const out = parseJobDescription(["先頭のリード文", "★ 仕事内容", "業務内容"].join("\n"));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: null, body: "先頭のリード文" });
    expect(out[1]).toEqual({ title: "仕事内容", body: "業務内容" });
  });
});

describe("sortJobDescriptionSections", () => {
  it("既定の 順序(仕事内容 → 募集背景 → ...)に 並べ替える", () => {
    const out = sortJobDescriptionSections([
      { title: "会社情報", body: "a" },
      { title: "仕事内容", body: "b" },
      { title: "募集背景", body: "c" },
    ]);
    expect(out.map((s) => s.title)).toEqual(["仕事内容", "募集背景", "会社情報"]);
  });

  it("null セクションは 先頭、未知タイトルは 末尾", () => {
    const out = sortJobDescriptionSections([
      { title: "未知", body: "x" },
      { title: null, body: "intro" },
      { title: "仕事内容", body: "work" },
    ]);
    expect(out.map((s) => s.title)).toEqual([null, "仕事内容", "未知"]);
  });
});
