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

// プロンプト設計の方針:
//   ・「Convert / Transform」 等 の 強い 動詞 は AI が 顔 まで 作り 直して しまう ため 避ける
//   ・「Retouch only / Do not redraw the face」 を 役割 と して 最初 に 宣言
//   ・「Same person」 「Preserve EXACT face」 を 繰り返し 強調 する
//   ・変える もの ( 背景 / ライティング / クロップ ) と 変え ない もの ( 顔 / 服 ) を
//     セクション 分け して 明示
//   ・末尾 に DO NOT セクション を 置き、 顔 の 美化 / 別人 化 / アクセサリ 追加 を 禁止
const PHOTO_PROMPT = [
  "You are a professional Japanese ID-photo retoucher.",
  "RETOUCH ONLY the background, lighting, and framing of this selfie so it looks like an official Japanese resume photo (証明写真).",
  "DO NOT redraw, regenerate, beautify, or alter the face in any way. The output must show the SAME PERSON as the input, visibly identical and recognizable.",
  "",
  "PRESERVE EXACTLY (must remain unchanged from the input):",
  "- Facial identity, bone structure, face shape, and proportions.",
  "- Skin tone, skin texture, freckles, moles, scars, acne, and birthmarks.",
  "- Eye shape, eye color, eyelid shape, eyebrows, eyelashes.",
  "- Nose shape, mouth shape, lip shape and color, teeth.",
  "- Hair color, hair style, hairline, hair length, and hair texture.",
  "- Ears and earlobes.",
  "- Facial hair (beard, mustache, stubble) if present.",
  "- Makeup level and style if present.",
  "- Age, gender, and ethnicity.",
  "- Existing clothing (color, style, neckline). Do not invent, remove, or change garments.",
  "",
  "CHANGE ONLY:",
  "- Background: replace with a clean plain solid light-gray (about #E8E8E8) or off-white. Remove all patterns, objects, and shadows behind the subject.",
  "- Framing: crop to head and shoulders (chest up), face centered, looking straight at the camera.",
  "- Expression: keep neutral or very slight closed-mouth smile if already present; do not exaggerate.",
  "- Lighting: soft, even, professional studio lighting. Remove harsh shadows on the face but keep natural skin tones.",
  "- Aspect ratio: portrait, 3:4, suitable for a Japanese resume photo.",
  "",
  "DO NOT:",
  "- Do not smooth, beautify, slim, plump, or sculpt the face.",
  "- Do not change the person's age, gender, ethnicity, or perceived weight.",
  "- Do not add glasses, accessories, jewelry, hats, ties, collars, logos, text, or watermarks that are not in the original.",
  "- Do not remove glasses, accessories, or clothing that ARE in the original.",
  "- Do not generate a different person. If the output face looks like a different person, the task has failed.",
].join("\n");

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
