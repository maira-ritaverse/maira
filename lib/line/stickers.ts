/**
 * よく使う 無料 スタンプ の キュレーション リスト
 *
 * LINE 公式 の デフォルト スタンプ (アカウント 作成時 から 使える 無料 スタンプ)。
 * 詳細: https://developers.line.biz/ja/docs/messaging-api/sticker-list/
 *
 * UI の スタンプ ピッカー で 6 〜 12 個 表示 する 想定。
 * CDN: https://stickershop.line-scdn.net/stickershop/v1/sticker/{stickerId}/android/sticker.png
 */
export type CuratedSticker = {
  packageId: string;
  stickerId: string;
  label: string;
};

/**
 * Package 446 (Brown & Cony's Big Day Out) — 公式 無料 デフォルト。
 * 全 開発者アカウントで 送信可。 stickerId 1989〜2027。
 */
export const COMMON_STICKERS: CuratedSticker[] = [
  { packageId: "446", stickerId: "1988", label: "Brown よろしく" },
  { packageId: "446", stickerId: "1989", label: "Brown 笑顔" },
  { packageId: "446", stickerId: "1990", label: "Cony OK" },
  { packageId: "446", stickerId: "2001", label: "Brown ありがとう" },
  { packageId: "446", stickerId: "2002", label: "Cony ありがとう" },
  { packageId: "446", stickerId: "2005", label: "Brown 喜び" },
  { packageId: "446", stickerId: "2007", label: "Cony 元気" },
  { packageId: "446", stickerId: "2008", label: "Cony おやすみ" },
  { packageId: "789", stickerId: "10855", label: "おじぎ" },
  { packageId: "789", stickerId: "10856", label: "ファイト" },
  { packageId: "789", stickerId: "10857", label: "ありがとう" },
  { packageId: "789", stickerId: "10858", label: "また連絡します" },
];

export const STICKER_CDN_BASE = "https://stickershop.line-scdn.net/stickershop/v1/sticker";

export function getStickerImageUrl(stickerId: string): string {
  return `${STICKER_CDN_BASE}/${stickerId}/android/sticker.png`;
}
