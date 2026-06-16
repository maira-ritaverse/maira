import { describe, expect, it } from "vitest";

import { createOAuthState, verifyOAuthState } from "./oauth-state";

describe("OAuth state token", () => {
  it("create → verify は ok=true で同じ uid/provider を返す", () => {
    const s = createOAuthState("user-1", "zoom");
    const v = verifyOAuthState(s);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.uid).toBe("user-1");
      expect(v.payload.provider).toBe("zoom");
      expect(typeof v.payload.nonce).toBe("string");
    }
  });

  it("形式不正は malformed", () => {
    expect(verifyOAuthState("not-a-state")).toEqual({ ok: false, reason: "malformed" });
  });

  it("署名改竄は bad_signature", () => {
    const s = createOAuthState("user-1", "google");
    const tampered = s.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(verifyOAuthState(tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("ペイロード改竄(uid 差し替え)は bad_signature", () => {
    const s = createOAuthState("user-1", "zoom");
    const [body, sig] = s.split(".");
    const bogus = Buffer.from(
      JSON.stringify({ uid: "evil", provider: "zoom", nonce: "x", iat: Date.now() }),
    ).toString("base64url");
    expect(verifyOAuthState(`${bogus}.${sig}`)).toEqual({ ok: false, reason: "bad_signature" });
    expect(body).toBeTruthy();
  });

  it("TTL 超過は expired", () => {
    const s = createOAuthState("user-1", "zoom");
    // 11 分後を渡す
    const v = verifyOAuthState(s, Date.now() + 11 * 60 * 1000);
    expect(v).toEqual({ ok: false, reason: "expired" });
  });
});
