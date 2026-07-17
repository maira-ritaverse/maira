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
 * 現状は quality=high + input_fidelity=high。
 * medium だと 顔 の 同一 性 を 保てない 報告 が あり、 顔 保持 を 優先 して
 * high に 切り替え。
 */

const IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";

// プロンプト設計の方針:
//   ・最初 に 「OUTPUT は 日本 の 証明 写真 (= passport-style ID photo)」 と 役割 / 出力 形式 を 明示
//   ・「TIGHT head-and-shoulders crop」 を 何度 も 強調。 腕 / 手 / 胴体 は 必ず 切る
//   ・PRESERVE / RE-FRAME / DO NOT の 3 セクション で 「顔 保持 + フレーム 変更 + 禁止 項」 を 整理
//   ・「顔 保持」 と 「腕 / 胴体 を 切る」 が 矛盾 し ない よう、 服 は 「肩 から 上 の 見え る 部分 のみ 保持」 と 限定
//   ・失敗 定義 ( = 別人 化 / 腕 が 写る ) を 末尾 に 並べ、 モデル に 「再 確認」 さ せる
//
// style="business" の 場合 の 追加 方針 (BUSINESS_ATTIRE ブロック):
//   ・服装 を ビジネス フォーマル (ジャケット + 見た目 の 性別 に 応じた インナー) に 差し替え
//   ・「見た目 の 性別」 を モデル が 判定 して 分岐:
//       - 男性: 濃紺 or 黒 の スーツ ジャケット + 白 ワイシャツ + 濃色 の ネクタイ
//       - 女性: 濃紺 or 黒 の テーラード ジャケット + 白 ブラウス (ネクタイ なし が 一般的)
//   ・顔 / 髪 / 肌 の 保持 ルール は そのまま 維持 (むしろ 服装 変更 で 顔 崩れ が
//     起き やすい ため、 preserve セクション を さらに 強調)
const PRESERVE_PROMPT = [
  "You are a professional Japanese ID-photo retoucher.",
  "The OUTPUT must be an official Japanese resume photo (証明写真 / passport-style ID photo).",
  "Even though the input may be a casual half-body selfie, the OUTPUT MUST be re-cropped and re-framed into the strict Japanese resume photo format. Casual posing (arms crossed, half body, hands visible) MUST NOT appear in the output.",
  "",
  "OUTPUT FORMAT — MANDATORY (this is the most important section):",
  "- TIGHT head-and-shoulders framing ONLY. The top of the head is near the top of the frame; the bottom edge of the frame cuts off just below the shoulders (around collarbone level).",
  "- Arms, hands, crossed arms, torso, chest area below the collarbone, waist — none of these may appear in the output. The output is a HEAD-AND-SHOULDERS SHOT, not a half-body shot.",
  "- Subject centered, facing directly forward (no tilt, no profile).",
  "- Neutral closed-mouth expression. No teeth showing, no big smile.",
  "- Both eyes open, looking straight at the camera lens.",
  "- Background: plain solid light-gray (around #E8E8E8) or off-white. No patterns, no shadows, no objects, no walls visible.",
  "- Lighting: soft, even, professional studio lighting. No harsh face shadows. Keep natural skin tone.",
  "- Aspect ratio: portrait, 3:4.",
  "",
  "PRESERVE EXACTLY (the output face must be the SAME PERSON):",
  "- Facial identity, bone structure, face shape, face proportions, perceived weight.",
  "- Skin tone, skin texture, freckles, moles, scars, acne, birthmarks.",
  "- Eye shape, eye color, eyelid shape, eyebrows, eyelashes.",
  "- Nose shape, mouth shape, lip shape, lip color, teeth.",
  "- Hair color, hair style, hairline, hair length, hair texture.",
  "- Ears and earlobes.",
  "- Facial hair (beard, mustache, stubble) if present.",
  "- Makeup level and style if present.",
  "- Age, gender, ethnicity.",
  "- The COLOR and STYLE of the visible upper clothing (collar / lapel area only — do not invent new garments, do not change jacket color).",
  "",
  "DO NOT:",
  "- Do not show arms, hands, crossed arms, torso, chest area below the collarbone. Japanese resume photos NEVER show arms.",
  "- Do not redraw, regenerate, smooth, beautify, slim, plump, or sculpt the face. The output face MUST be visibly the same person.",
  "- Do not change the person's age, gender, ethnicity, perceived weight, or facial features.",
  "- Do not add glasses, accessories, jewelry, hats, ties, scarves, logos, text, or watermarks that are not in the original.",
  "- Do not remove glasses, earrings, or clothing that ARE in the original.",
  "- Do not change the color of the clothing.",
  "",
  "FAILURE CONDITIONS (if any of these are true, the task has failed):",
  "- The output shows arms, hands, or torso below the shoulders.",
  "- The output face is visibly a different person from the input.",
  "- The background is not a plain solid light-gray or off-white.",
  "- The framing is not a tight head-and-shoulders shot.",
].join("\n");

// style="business": 元服装を 保持 する 制約 を 外し、 見た目 の 性別 に 応じた
// ビジネス フォーマル に 差し替える プロンプト。 顔 保持 ルール は そのまま。
const BUSINESS_PROMPT = [
  "You are a professional Japanese ID-photo retoucher.",
  "The OUTPUT must be an official Japanese resume photo (証明写真 / passport-style ID photo) where the subject is wearing BUSINESS FORMAL ATTIRE, regardless of what the subject was wearing in the input.",
  "Even though the input is a casual selfie (T-shirt, hoodie, casual jacket, blouse, etc.), the OUTPUT MUST show the subject in Japanese business formal attire suitable for a resume photo.",
  "",
  "BUSINESS ATTIRE — CHOOSE BASED ON THE SUBJECT'S APPARENT GENDER:",
  "- Male-presenting subject: dark navy or charcoal-black business suit jacket (single-breasted, notched lapel), white dress shirt, conservative dark solid tie (navy, dark blue, dark red, or dark gray). Standard Japanese salaryman resume photo look.",
  "- Female-presenting subject: dark navy or charcoal-black tailored business jacket, plain white blouse or shell underneath (crew or v-neck, no ruffles). NO tie by default. Neat, conservative Japanese office attire.",
  "- Ambiguous / cannot tell: default to the male-presenting attire above.",
  "- Do NOT invent unusual accessories (pocket square, brooch, name badge, boutonniere, etc.).",
  "- The attire must look clean, well-pressed, and neutral in color (no bright reds, yellows, pastels).",
  "",
  "OUTPUT FORMAT — MANDATORY:",
  "- TIGHT head-and-shoulders framing ONLY. The top of the head is near the top of the frame; the bottom edge of the frame cuts off just below the shoulders (around collarbone level).",
  "- Arms, hands, crossed arms, torso below the collarbone, waist — none of these may appear.",
  "- Subject centered, facing directly forward (no tilt, no profile).",
  "- Neutral closed-mouth expression. No teeth showing, no big smile.",
  "- Both eyes open, looking straight at the camera lens.",
  "- Background: plain solid light-gray (around #E8E8E8) or off-white. No patterns, no shadows, no objects.",
  "- Lighting: soft, even, professional studio lighting. No harsh face shadows. Keep natural skin tone.",
  "- Aspect ratio: portrait, 3:4.",
  "",
  "PRESERVE EXACTLY (the output face must be the SAME PERSON — this is the most important rule):",
  "- Facial identity, bone structure, face shape, face proportions, perceived weight.",
  "- Skin tone, skin texture, freckles, moles, scars, acne, birthmarks.",
  "- Eye shape, eye color, eyelid shape, eyebrows, eyelashes.",
  "- Nose shape, mouth shape, lip shape, lip color, teeth.",
  "- Hair color, hair style, hairline, hair length, hair texture.",
  "- Ears and earlobes.",
  "- Facial hair (beard, mustache, stubble) if present.",
  "- Makeup level and style if present.",
  "- Age, gender, ethnicity.",
  "",
  "DO NOT:",
  "- Do not redraw, regenerate, smooth, beautify, slim, plump, or sculpt the face. The output face MUST be visibly the same person.",
  "- Do not change the person's age, gender, ethnicity, perceived weight, or facial features.",
  "- Do not add glasses if the original doesn't have them, and do not remove glasses if the original has them.",
  "- Do not add hats, jewelry (beyond small stud earrings if already present), scarves, name badges, logos, text, or watermarks.",
  "- Do not use bright non-business colors (red, yellow, pink, pastel) for the jacket or tie.",
  "",
  "FAILURE CONDITIONS:",
  "- The output shows arms, hands, or torso below the shoulders.",
  "- The output face is visibly a different person from the input.",
  "- The subject is not wearing business formal attire.",
  "- The attire is bright, casual, or has non-business patterns.",
].join("\n");

/** どの スタイル で 生成 する か。 preserve = 元 服装 を 保つ (従来 挙動)。 business = ビジネス フォーマル に 差し替え。 */
export type EnhanceStyle = "preserve" | "business";

function promptFor(style: EnhanceStyle): string {
  return style === "business" ? BUSINESS_PROMPT : PRESERVE_PROMPT;
}

export type AiEnhanceResult =
  | { ok: true; pngBuffer: Buffer; promptUsed: string }
  | { ok: false; reason: "not_configured" | "api_error" | "no_image"; message: string };

export async function aiEnhanceSelfie(input: {
  /** 元画像(JPEG/PNG)。stream-friendly に Blob で受ける */
  imageBlob: Blob;
  filename: string;
  quality?: "low" | "medium" | "high";
  /**
   * 生成スタイル。
   * - "preserve" (既定): 元 の 服装 を 保つ (背景 と フレーミング のみ 証明写真 化)
   * - "business":       元 服装 に かかわらず ビジネス フォーマル に 差し替える
   *                     (見た目 の 性別 に 応じて 男性 = スーツ+ネクタイ、
   *                      女性 = スーツ+ブラウス を AI が 自動 選択)
   */
  style?: EnhanceStyle;
}): Promise<AiEnhanceResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "not_configured",
      message: "OPENAI_API_KEY が未設定です。",
    };
  }

  const promptToUse = promptFor(input.style ?? "preserve");
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", input.imageBlob, input.filename);
  form.append("prompt", promptToUse);
  form.append("size", "1024x1536"); // 縦長 = 履歴書の 3:4
  // quality を high に 上げて モデル の 表現 余裕 を 増やし、
  // 顔 の 同一 性 / 細部 保持 を 改善 する ( コスト は medium の 約 2.7 倍 )。
  form.append("quality", input.quality ?? "high");
  // input_fidelity = high で 元 画像 へ の 忠実 度 を 最大 化。
  // 「顔 が 別人 に なる」 問題 の 主因 で、 この パラメータ が 一番 効く。
  form.append("input_fidelity", "high");
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
      promptUsed: promptToUse,
    };
  }
  // 念のため url にも対応(将来の挙動変更に備え)
  if (entry.url) {
    const dl = await fetch(entry.url);
    if (!dl.ok) {
      return { ok: false, reason: "api_error", message: `画像ダウンロード失敗: ${dl.status}` };
    }
    const buf = Buffer.from(await dl.arrayBuffer());
    return { ok: true, pngBuffer: buf, promptUsed: promptToUse };
  }
  return {
    ok: false,
    reason: "no_image",
    message: "OpenAI から base64 / URL いずれも返りませんでした",
  };
}
