import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiFetch, getErrorMessage } from "./client-fetch";

/**
 * fetch をモックして apiFetch の振る舞いをテストする。
 * 環境は node(vitest default)で fetch は global にある(undici 由来 / Node 18+)。
 */

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockResponse(
  body: unknown,
  init: { status?: number; ok?: boolean; isText?: boolean } = {},
) {
  const status = init.status ?? 200;
  const ok = init.ok ?? status < 400;
  const text = init.isText ? (body as string) : body === undefined ? "" : JSON.stringify(body);
  return {
    ok,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe("apiFetch — success cases", () => {
  it("JSON body を返す(200)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ hello: "world" }),
    );
    const r = await apiFetch<{ hello: string }>("/x");
    expect(r).toEqual({ hello: "world" });
  });

  it("空ボディは undefined", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(undefined),
    );
    const r = await apiFetch("/x");
    expect(r).toBeUndefined();
  });

  it("json オプションで body を自動シリアライズ + Content-Type 自動付与", async () => {
    const spy = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await apiFetch("/x", { method: "POST", json: { a: 1 } });
    const callInit = spy.mock.calls[0][1] as RequestInit;
    expect(callInit.method).toBe("POST");
    expect(callInit.body).toBe(JSON.stringify({ a: 1 }));
    expect((callInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("headers は明示分が優先される(Content-Type の上書きはしない契約)", async () => {
    const spy = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await apiFetch("/x", { method: "POST", json: { a: 1 }, headers: { "X-Custom": "1" } });
    const callInit = spy.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>)["X-Custom"]).toBe("1");
    // Content-Type は json 指定時に自動付与される
    expect((callInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("apiFetch — error cases", () => {
  it("HTTP 4xx は ApiClientError を throw(server error 取り出し)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ error: "bad request" }, { status: 400 }),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      serverError: "bad request",
    });
  });

  it("HTTP 500 + 空ボディは fallback メッセージ", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(undefined, { status: 500 }),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      message: "HTTP 500",
    });
  });

  it("ネットワーク失敗は ApiClientError(status=0)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 0,
    });
  });

  it("テキスト本文(非 JSON)もエラー時にメッセージ化", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse("Internal Error", { status: 500, isText: true }),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      serverError: "Internal Error",
    });
  });
});

describe("getErrorMessage", () => {
  it("ApiClientError の serverError を優先", () => {
    expect(
      getErrorMessage(new ApiClientError("fallback", { status: 500, serverError: "actual" })),
    ).toBe("actual");
  });

  it("ApiClientError の serverError なしは message", () => {
    expect(getErrorMessage(new ApiClientError("oops", { status: 500 }))).toBe("oops");
  });

  it("通常の Error は message", () => {
    expect(getErrorMessage(new Error("hi"))).toBe("hi");
  });

  it("string や object は '不明なエラー'", () => {
    expect(getErrorMessage("foo")).toBe("不明なエラー");
    expect(getErrorMessage({})).toBe("不明なエラー");
    expect(getErrorMessage(null)).toBe("不明なエラー");
  });
});
