/**
 * 自撮り画像 → 履歴書証明写真風に変換(OpenAI Images Edit)
 *
 * - SDK 不使用、bare fetch で OpenAI Images API を叩く
 * - model = gpt-image-1
 * - 縦長(1024x1536)で生成 → 後段 sharp で 450x600 にトリミング
 *
 * コスト目安(2026 時点):
 *   - quality=low    : ~$0.02 / 枚
 *   - quality=medium : ~$0.07 / 枚
 *   - quality=high   : ~$0.19 / 枚
 *
 * 現状は quality=medium(クオリティと費用のバランス)。
 */

const IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";

const PHOTO_PROMPT = [
  "Convert this casual selfie photo into a Japanese formal resume photo (証明写真).",
  "Requirements:",
  "- Replace the background with a plain solid light-gray or off-white background (no patterns or shadows behind the subject).",
  "- Keep the person's facial identity, expression, hair, skin tone, and clothing colors as natural and realistic as possible — do not change the person's appearance.",
  "- Show head and shoulders only (chest up), facing forward, neutral or slight smile, eyes open and looking at the camera.",
  "- Clean, professional lighting; remove harsh shadows.",
  "- Output portrait orientation suitable for a Japanese resume photo (3:4 aspect ratio).",
  "- Do not add any glasses, logos, accessories, jewelry, text, watermarks, or any element that is not in the original image.",
].join(" ");

export type AiEnhanceResult =
  | { ok: true; pngBuffer: Buffer; promptUsed: string }
  | { ok: false; reason: "not_configured" | "api_error" | "no_image"; message: string };

export async function aiEnhanceSelfie(input: {
  /** 元画像(JPEG/PNG)。stream-friendly に Blob で受ける */
  imageBlob: Blob;
  filename: string;
  quality?: "low" | "medium" | "high";
}): Promise<AiEnhanceResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      message: "OPENAI_API_KEY が未設定です。",
    };
  }

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", input.imageBlob, input.filename);
  form.append("prompt", PHOTO_PROMPT);
  form.append("size", "1024x1536"); // 縦長 = 履歴書の 3:4
  form.append("quality", input.quality ?? "medium");
  form.append("n", "1");

  let res: Response;
  try {
    res = await fetch(IMAGES_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "api_error", message: `fetch 失敗: ${msg}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "api_error",
      message: `OpenAI ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  } | null;
  const entry = json?.data?.[0];
  if (!entry) {
    return { ok: false, reason: "no_image", message: "OpenAI から画像が返りませんでした" };
  }

  // gpt-image-1 は base64 を返す
  if (entry.b64_json) {
    return {
      ok: true,
      pngBuffer: Buffer.from(entry.b64_json, "base64"),
      promptUsed: PHOTO_PROMPT,
    };
  }
  // 念のため url にも対応(将来の挙動変更に備え)
  if (entry.url) {
    const dl = await fetch(entry.url);
    if (!dl.ok) {
      return { ok: false, reason: "api_error", message: `画像ダウンロード失敗: ${dl.status}` };
    }
    const buf = Buffer.from(await dl.arrayBuffer());
    return { ok: true, pngBuffer: buf, promptUsed: PHOTO_PROMPT };
  }
  return {
    ok: false,
    reason: "no_image",
    message: "OpenAI から base64 / URL いずれも返りませんでした",
  };
}
