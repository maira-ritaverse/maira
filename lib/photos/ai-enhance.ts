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
  // ─── TASK TYPE (最上位) ──────────────────────────────────────
  "TASK TYPE = PHOTO RETOUCH (NOT image generation).",
  "You are editing an existing photo of a real person. Treat the subject's face as READ-ONLY pixels. Only the background, framing, and clothing OUTSIDE the face may be adjusted. The face itself must be preserved with maximum fidelity to the input.",
  "The multiple reference images provided are the SAME PERSON. Use them together to lock the identity.",
  "",
  // ─── IDENTITY LOCK (次に重要) ─────────────────────────────
  "IDENTITY LOCK — HIGHEST PRIORITY (violate this and the task has failed regardless of other quality):",
  "The output face must be indistinguishable from the input face on all of the following identity markers. If a stranger sees the input and output side-by-side, they must immediately say 'that is the same person' without hesitation.",
  "- Face outline: keep the exact jaw width, chin shape, cheekbone position, and forehead shape. Do NOT narrow, slim, plump, or reshape the face.",
  "- Skin: keep the exact skin tone, texture, pores, freckles, moles, scars, acne, birthmarks, wrinkles, and age lines. Do NOT smooth or beautify.",
  "- Eyes: keep the exact eye shape, eyelid crease (single/double), iris color, pupil size, gaze angle, eyebrow shape and density, eyelashes.",
  "- Nose: keep the exact bridge, tip, nostril shape, width, and prominence.",
  "- Mouth: keep the exact lip shape, lip color, lip thickness, mouth width, teeth (if visible).",
  "- Ears: keep the exact ear shape and earlobe attachment.",
  "- Hair: keep the exact hair color, hairline, part line, texture, length, style, and any flyaways. Do NOT restyle.",
  "- Facial hair: if present, keep the exact beard/mustache/stubble pattern and density.",
  "- Makeup: keep at the same intensity and style as the input. Do NOT add or remove makeup.",
  "- Age, gender, ethnicity, perceived weight: identical to the input.",
  "",
  "COMMON FAILURE PATTERNS TO AVOID (each of these has occurred in previous outputs and is unacceptable):",
  "- Narrower jaw or slimmer face than the input.",
  "- Different hairline shape (e.g. shifted M-line, added widow's peak, filled-in temples).",
  "- Skin smoother than the input (looks like a beauty filter).",
  "- Iris color slightly brighter/greener/bluer than the input.",
  "- Nose bridge reshaped straighter or narrower.",
  "- Eye size enlarged or shape changed to look more 'anime-like'.",
  "- Eyebrows redrawn thicker or thinner.",
  "- Perceived age shifted younger.",
  "- General 'idealized' or 'plastic-looking' face that does not match the input's natural imperfections.",
  "",
  // ─── OUTPUT FORMAT ─────────────────────────────────────
  "OUTPUT FORMAT (apply only after IDENTITY LOCK is satisfied):",
  "- TIGHT head-and-shoulders framing. Top of the head near the top of the frame; bottom edge cuts off just below the shoulders (around collarbone level).",
  "- Arms, hands, crossed arms, torso below the collarbone, waist — none of these may appear.",
  "- Subject centered, facing directly forward (no tilt, no profile).",
  "- Neutral closed-mouth expression matching the input's mouth position. No teeth showing, no big smile.",
  "- Both eyes open, looking straight at the camera lens.",
  "- Background: plain solid light-gray (around #E8E8E8) or off-white. No patterns, no shadows, no objects, no walls visible.",
  "- Lighting: soft, even, professional studio lighting. No harsh face shadows. Keep natural skin tone from the input (do not brighten or warm the skin).",
  "- Aspect ratio: portrait, 3:4.",
  "",
  // ─── DO NOT ─────────────────────────────────────
  "DO NOT:",
  "- Do not show arms, hands, crossed arms, torso, chest area below the collarbone. Japanese resume photos NEVER show arms.",
  "- Do not redraw, regenerate, smooth, beautify, slim, plump, or sculpt the face. The output face MUST be visibly the same person.",
  "- Do not change the person's age, gender, ethnicity, perceived weight, or facial features.",
  "- Do not add glasses, accessories, jewelry, hats, ties, scarves, logos, text, or watermarks that are not in the original.",
  "- Do not remove glasses, earrings, or clothing that ARE in the original.",
  "- Do not change the color or style of the visible clothing (collar/lapel area).",
  "",
  // ─── FAILURE CONDITIONS ─────────────────────────────
  "FAILURE CONDITIONS (if any of these are true, the task has failed):",
  "- The output shows arms, hands, or torso below the shoulders.",
  "- The output face is visibly a different person from the input.",
  "- Any of the COMMON FAILURE PATTERNS above are present.",
  "- The background is not a plain solid light-gray or off-white.",
  "- The framing is not a tight head-and-shoulders shot.",
].join("\n");

// style="business": 元服装を 保持 する 制約 を 外し、 見た目 の 性別 に 応じた
// ビジネス フォーマル に 差し替える プロンプト。 顔 保持 ルール は preserve と
// 同型 で 最上位 に 配置 (服装 差替 で 顔 崩れ が 起き やすい ため、 むしろ
// 強調)。
const BUSINESS_PROMPT = [
  // ─── TASK TYPE (最上位) ──────────────────────────────────────
  "TASK TYPE = PHOTO RETOUCH WITH CLOTHING REPLACEMENT (NOT image generation).",
  "You are editing an existing photo of a real person. Treat the subject's face as READ-ONLY pixels. Only the background, framing, and the clothing (jacket / shirt / tie / blouse) may be adjusted. The face itself must be preserved with maximum fidelity to the input.",
  "The multiple reference images provided are the SAME PERSON. Use them together to lock the identity.",
  "",
  // ─── IDENTITY LOCK ──────────────────────────────────────
  "IDENTITY LOCK — HIGHEST PRIORITY (violate this and the task has failed regardless of clothing quality):",
  "The output face must be indistinguishable from the input face on all of the following identity markers. If a stranger sees the input and output side-by-side, they must immediately say 'that is the same person' without hesitation.",
  "- Face outline: keep the exact jaw width, chin shape, cheekbone position, and forehead shape. Do NOT narrow, slim, plump, or reshape the face.",
  "- Skin: keep the exact skin tone, texture, pores, freckles, moles, scars, acne, birthmarks, wrinkles, and age lines. Do NOT smooth or beautify.",
  "- Eyes: keep the exact eye shape, eyelid crease (single/double), iris color, pupil size, gaze angle, eyebrow shape and density, eyelashes.",
  "- Nose: keep the exact bridge, tip, nostril shape, width, and prominence.",
  "- Mouth: keep the exact lip shape, lip color, lip thickness, mouth width, teeth (if visible).",
  "- Ears: keep the exact ear shape and earlobe attachment.",
  "- Hair: keep the exact hair color, hairline, part line, texture, length, style, and any flyaways. Do NOT restyle.",
  "- Facial hair: if present, keep the exact beard/mustache/stubble pattern and density.",
  "- Makeup: keep at the same intensity and style as the input. Do NOT add or remove makeup.",
  "- Age, gender, ethnicity, perceived weight: identical to the input.",
  "",
  "COMMON FAILURE PATTERNS TO AVOID:",
  "- Narrower jaw or slimmer face than the input (very common when replacing clothing).",
  "- Different hairline shape (e.g. shifted M-line, added widow's peak, filled-in temples).",
  "- Skin smoother than the input (looks like a beauty filter).",
  "- Iris color slightly brighter/greener/bluer than the input.",
  "- Nose bridge reshaped straighter or narrower.",
  "- Eye size enlarged or shape changed to look more 'anime-like'.",
  "- Eyebrows redrawn thicker or thinner.",
  "- Perceived age shifted younger.",
  "- General 'idealized' or 'plastic-looking' face that does not match the input's natural imperfections.",
  "",
  // ─── BUSINESS ATTIRE (この タスク の 差別化 ポイント) ──
  "BUSINESS ATTIRE — CHOOSE BASED ON THE SUBJECT'S APPARENT GENDER (apply only to the clothing region, NEVER touch the face region):",
  "- Male-presenting subject: dark navy or charcoal-black business suit jacket (single-breasted, notched lapel), white dress shirt, conservative dark solid tie (navy, dark blue, dark red, or dark gray). Standard Japanese salaryman resume photo look.",
  "- Female-presenting subject: dark navy or charcoal-black tailored business jacket, plain white blouse or shell underneath (crew or v-neck, no ruffles). NO tie by default. Neat, conservative Japanese office attire.",
  "- Ambiguous / cannot tell: default to the male-presenting attire above.",
  "- Do NOT invent unusual accessories (pocket square, brooch, name badge, boutonniere, etc.).",
  "- The attire must look clean, well-pressed, and neutral in color (no bright reds, yellows, pastels).",
  "",
  // ─── OUTPUT FORMAT ─────────────────────────────────────
  "OUTPUT FORMAT (apply only after IDENTITY LOCK is satisfied):",
  "- TIGHT head-and-shoulders framing. Top of the head near the top of the frame; bottom edge cuts off just below the shoulders (around collarbone level).",
  "- Arms, hands, crossed arms, torso below the collarbone, waist — none of these may appear.",
  "- Subject centered, facing directly forward (no tilt, no profile).",
  "- Neutral closed-mouth expression matching the input's mouth position. No teeth showing, no big smile.",
  "- Both eyes open, looking straight at the camera lens.",
  "- Background: plain solid light-gray (around #E8E8E8) or off-white. No patterns, no shadows, no objects.",
  "- Lighting: soft, even, professional studio lighting. No harsh face shadows. Keep natural skin tone from the input (do not brighten or warm the skin).",
  "- Aspect ratio: portrait, 3:4.",
  "",
  // ─── DO NOT ─────────────────────────────────────
  "DO NOT:",
  "- Do not redraw, regenerate, smooth, beautify, slim, plump, or sculpt the face. The output face MUST be visibly the same person.",
  "- Do not change the person's age, gender, ethnicity, perceived weight, or facial features.",
  "- Do not add glasses if the original doesn't have them, and do not remove glasses if the original has them.",
  "- Do not add hats, jewelry (beyond small stud earrings if already present), scarves, name badges, logos, text, or watermarks.",
  "- Do not use bright non-business colors (red, yellow, pink, pastel) for the jacket or tie.",
  "",
  // ─── FAILURE CONDITIONS ─────────────────────────────
  "FAILURE CONDITIONS:",
  "- The output shows arms, hands, or torso below the shoulders.",
  "- The output face is visibly a different person from the input.",
  "- Any of the COMMON FAILURE PATTERNS above are present.",
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

  // gpt-image-1 の /images/edits は image フィールド を 複数回 送る と
  // 「同じ 被写体 の 複数 参照 画像」 として 扱う (公式 仕様、 最大 16 枚)。
  // ユーザー は 通常 1 枚 しか 持って いない ため 同じ 画像 を 3 回 送って
  // 「この 顔 で 確定」 という シグナル を 強める (identity anchoring)。
  //
  // OpenAI の 課金 は 出力 画像 単位 の ため、 入力 を 増やして も コスト は 増えない。
  // 効果 は 個別 差 が ある が、 プロンプト の IDENTITY LOCK と 併せて 別人化 を
  // 目立ちにくく する 効果 が 期待 できる。
  //
  // Blob は fetch で 消費 される と 再利用 できない ため、 arrayBuffer で 一度
  // 読んでから 3 つ の File インスタンス に 複製 する。
  const imageBytes = await input.imageBlob.arrayBuffer();
  const imageMime = input.imageBlob.type || "image/png";
  const REFERENCE_COUNT = 3;
  for (let i = 0; i < REFERENCE_COUNT; i++) {
    const copy = new File([imageBytes], input.filename, { type: imageMime });
    form.append("image", copy);
  }

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
