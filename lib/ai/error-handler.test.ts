import { describe, it, expect } from "vitest";
import { aiErrorToStatusCode, categorizeAIError } from "./error-handler";

/**
 * AI エラーの分類とユーザー向け文言テスト。
 *
 * 「技術的詳細をユーザー文言に含めない(秘密漏洩防止)」が設計の核。
 * カテゴリ分岐は包括的に網羅し、retryable / status code とのマッピングが
 * 想定通りであることを担保する。秘密漏洩のリスクが高い auth は外部に
 * 「API Key 失効」を漏らさず 503 で返す契約を明示テスト。
 */

describe("categorizeAIError — カテゴリ分類", () => {
  it("rate limit エラー → retryable", () => {
    const r = categorizeAIError(new Error("Rate limit exceeded"));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("API Key / authentication / unauthorized は auth カテゴリ", () => {
    expect(categorizeAIError(new Error("Invalid API key")).category).toBe("auth");
    expect(categorizeAIError(new Error("authentication failed")).category).toBe("auth");
    expect(categorizeAIError(new Error("401 unauthorized")).category).toBe("auth");
  });

  it("auth は retryable=false(リトライしても解決しない)", () => {
    expect(categorizeAIError(new Error("API key invalid")).retryable).toBe(false);
  });

  it("context / token → input_too_long(再試行しても無駄)", () => {
    expect(categorizeAIError(new Error("Context length exceeded")).category).toBe("input_too_long");
    expect(categorizeAIError(new Error("Token limit reached")).category).toBe("input_too_long");
    expect(categorizeAIError(new Error("token limit")).retryable).toBe(false);
  });

  it("policy / usage policy 違反", () => {
    expect(categorizeAIError(new Error("Usage policy violation")).category).toBe("policy");
    expect(categorizeAIError(new Error("Policy issue")).category).toBe("policy");
  });

  it("timeout(エラー名 or メッセージ)", () => {
    expect(categorizeAIError(new Error("Request timeout")).category).toBe("timeout");
    const err = new Error("");
    err.name = "TimeoutError";
    expect(categorizeAIError(err).category).toBe("timeout");
  });

  it("network エラー(エラー名 or メッセージ)", () => {
    expect(categorizeAIError(new Error("Network error")).category).toBe("network");
    expect(categorizeAIError(new Error("fetch failed")).category).toBe("network");
    const err = new Error("");
    err.name = "NetworkError";
    expect(categorizeAIError(err).category).toBe("network");
  });

  it("5xx サーバーエラー", () => {
    expect(categorizeAIError(new Error("Internal Server Error")).category).toBe("server_error");
    expect(categorizeAIError(new Error("503 service unavailable")).category).toBe("server_error");
    expect(categorizeAIError(new Error("502 bad gateway")).category).toBe("server_error");
  });

  it("分類不能は 'unknown' / retryable=true(初期は気軽に再試行)", () => {
    const r = categorizeAIError(new Error("Something random"));
    expect(r.category).toBe("unknown");
    expect(r.retryable).toBe(true);
  });

  it("Error でない値も String() 化して分類", () => {
    expect(categorizeAIError("rate limit").category).toBe("rate_limit");
    expect(categorizeAIError(null).category).toBe("unknown"); // 'null' 文字列に該当なし
    expect(categorizeAIError({ message: "x" }).category).toBe("unknown");
  });

  it("大文字小文字を無視して分類(message.toLowerCase 経由)", () => {
    expect(categorizeAIError(new Error("RATE LIMIT")).category).toBe("rate_limit");
    expect(categorizeAIError(new Error("API KEY INVALID")).category).toBe("auth");
  });
});

describe("categorizeAIError — ユーザー文言の秘密漏洩防止", () => {
  it("auth エラーでも 'API Key' という単語を含まない", () => {
    // 「API Key が失効した」など技術詳細をユーザー向けには出さない契約
    const r = categorizeAIError(new Error("Invalid API key xxx"));
    expect(r.userMessage).not.toContain("API Key");
    expect(r.userMessage).not.toContain("API key");
    expect(r.userMessage).not.toContain("api key");
    expect(r.userMessage).not.toContain("xxx"); // 内部文字列を漏らさない
  });

  it("rate_limit でも 'rate limit' を含まない(日本語に翻訳済み)", () => {
    const r = categorizeAIError(new Error("Rate limit exceeded"));
    expect(r.userMessage.toLowerCase()).not.toContain("rate");
    expect(r.userMessage.toLowerCase()).not.toContain("limit");
  });

  it("全カテゴリの userMessage が非空", () => {
    const errors = [
      new Error("rate limit"),
      new Error("API key"),
      new Error("token limit"),
      new Error("policy"),
      new Error("timeout"),
      new Error("network"),
      new Error("500 server"),
      new Error("xyz unknown"),
    ];
    for (const err of errors) {
      expect(categorizeAIError(err).userMessage.length).toBeGreaterThan(0);
    }
  });
});

describe("aiErrorToStatusCode", () => {
  it("rate_limit → 429", () => {
    expect(aiErrorToStatusCode("rate_limit")).toBe(429);
  });

  it("auth → 503(API Key 失効を外部に漏らさない設計)", () => {
    // 401 ではなく 503 で「上流サービス利用不可」として返す。
    // クライアントから auth エラーかどうか判別できないようにする。
    expect(aiErrorToStatusCode("auth")).toBe(503);
  });

  it("input_too_long / policy → 400(クライアント起因)", () => {
    expect(aiErrorToStatusCode("input_too_long")).toBe(400);
    expect(aiErrorToStatusCode("policy")).toBe(400);
  });

  it("server_error / network / timeout → 502(上流原因)", () => {
    expect(aiErrorToStatusCode("server_error")).toBe(502);
    expect(aiErrorToStatusCode("network")).toBe(502);
    expect(aiErrorToStatusCode("timeout")).toBe(502);
  });

  it("unknown → 500", () => {
    expect(aiErrorToStatusCode("unknown")).toBe(500);
  });
});
