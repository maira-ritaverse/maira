import { generateText } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";

/**
 * 漢字住所から現住所フリガナ(全角カタカナ、町名まで)を AI 生成する。
 *
 * プロフィール(書類なし)由来の履歴書作成では、client_record に住所フリガナの
 * 元データが無いため、漢字住所から読みを推定して補完する用途。
 *
 * ベストエフォート:失敗・不正出力(カタカナ以外の混入)時は null を返す。
 * 呼び出し側は null のときフリガナ空のまま作成を続行する(作成自体は止めない)。
 */
export async function generateAddressKana(address: string): Promise<string | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  try {
    const { text } = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system:
        "あなたは日本の住所のフリガナを返すアシスタントです。入力住所の読みを全角カタカナで、" +
        "町名まで(番地・建物名・部屋番号は除く)返します。説明・記号・スペースは付けず、" +
        "カタカナのみを1行で返してください。読めない固有名詞は無理に読まず省きます。",
      prompt: `住所: ${trimmed}\nフリガナ(全角カタカナ、町名まで):`,
      // 作成フローを長時間ブロックしないよう、リトライを抑えて 8 秒でタイムアウトさせる。
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8000),
    });
    const kana = text.trim().replace(/\s+/g, "");
    // 生成が不安定な場合の保険:カタカナ(長音符・中黒を含む ゠-ヿ)以外が
    // 混ざったら採用しない。
    if (!kana || !/^[゠-ヿ]+$/.test(kana)) return null;
    return kana.slice(0, 200);
  } catch {
    return null;
  }
}
