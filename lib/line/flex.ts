/**
 * LINE Flex Message ビルダー
 *
 * 公式仕様:
 *   https://developers.line.biz/ja/reference/messaging-api/#flex-message
 *
 * 設計判断:
 *   - JSON 構造 を 関数 で 包んで、 上位 で 型安全 に 求人 / 日程 等 を 渡せる ように する
 *   - 全 Flex 仕様 を 型 化 する と 重い ので 「使う 部分集合」だけ 型 定義
 *   - 値 検証 は LINE 側 に 任せる (送信失敗 を 上位で キャッチ)
 *
 * Phase 2 で 提供:
 *   - 求人紹介 カード (画像 + 給与 + ボタン)
 *
 * Phase 3 で 追加 予定:
 *   - 日程選択 (Quick Reply / postback)
 *   - 推薦文 / 簡易レポート 等
 */

/** Flex メッセージ の トップ レベル (LineMessage に 入る もの) */
export type LineFlexMessage = {
  type: "flex";
  altText: string; // 通知欄 / 履歴 で 見える 短い 説明 (Push の バッジ にも 使われる)
  contents: FlexContainer;
};

/** Flex container (bubble or carousel) */
export type FlexContainer = FlexBubble | FlexCarousel;

export type FlexBubble = {
  type: "bubble";
  size?: "nano" | "micro" | "kilo" | "mega" | "giga";
  hero?: FlexImage;
  header?: FlexBox;
  body?: FlexBox;
  footer?: FlexBox;
  styles?: {
    body?: { backgroundColor?: string };
    footer?: { backgroundColor?: string };
  };
};

export type FlexCarousel = {
  type: "carousel";
  contents: FlexBubble[]; // 最大 12 個
};

export type FlexBox = {
  type: "box";
  layout: "vertical" | "horizontal" | "baseline";
  contents: FlexComponent[];
  spacing?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  paddingAll?: string;
};

export type FlexComponent = FlexText | FlexBox | FlexImage | FlexButton | FlexSeparator;

export type FlexText = {
  type: "text";
  text: string;
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  weight?: "regular" | "bold";
  color?: string; // 例: "#06C755"
  align?: "start" | "center" | "end";
  wrap?: boolean;
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
};

export type FlexImage = {
  type: "image";
  url: string; // HTTPS、 最大 1024 × 1024
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | "full";
  aspectRatio?: string; // 例: "20:13"
  aspectMode?: "cover" | "fit";
};

export type FlexButton = {
  type: "button";
  action: FlexAction;
  style?: "primary" | "secondary" | "link";
  color?: string;
  height?: "sm" | "md";
};

export type FlexSeparator = {
  type: "separator";
  margin?: "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
};

export type FlexAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText?: string }
  | { type: "message"; label: string; text: string };

// ============================================================
// プリセット ビルダー
// ============================================================

/**
 * 求人紹介 カード (Bubble)
 * UI: hero 画像 + 役職 + 会社/勤務地 + 年収 + 「詳細を見る」「興味あり」ボタン
 *
 * URL は LIFF を 優先 (Phase 4 で 設定済 なら)、 無ければ 通常 URL に フォールバック。
 */
export type JobShareCardArgs = {
  jobId: string;
  position: string;
  companyName: string;
  location: string | null;
  salaryText: string | null; // 例: "500-800 万円"
  heroImageUrl: string | null;
  /** 詳細ページ URL (LIFF or 通常 URL) */
  detailUrl: string;
  /** 「興味あり」ボタン (postback で 受信) */
  interestPostbackData?: string;
};

export function buildJobShareCard(args: JobShareCardArgs): LineFlexMessage {
  const bodyContents: FlexComponent[] = [
    {
      type: "text",
      text: args.position,
      weight: "bold",
      size: "xl",
      wrap: true,
    },
    {
      type: "text",
      text: [args.companyName, args.location].filter(Boolean).join(" / "),
      size: "sm",
      color: "#888888",
      margin: "sm",
      wrap: true,
    },
  ];

  if (args.salaryText) {
    bodyContents.push({
      type: "text",
      text: args.salaryText,
      weight: "bold",
      color: "#06C755",
      margin: "md",
    });
  }

  const footerContents: FlexComponent[] = [
    {
      type: "button",
      style: "primary",
      color: "#06C755",
      height: "sm",
      action: {
        type: "uri",
        label: "詳細を見る",
        uri: args.detailUrl,
      },
    },
  ];

  if (args.interestPostbackData) {
    footerContents.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: {
        type: "postback",
        label: "興味あり",
        data: args.interestPostbackData,
        displayText: "「興味あり」を 送信 しました",
      },
    });
  }

  const bubble: FlexBubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: bodyContents,
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: footerContents,
    },
  };

  if (args.heroImageUrl) {
    bubble.hero = {
      type: "image",
      url: args.heroImageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    };
  }

  return {
    type: "flex",
    altText: `求人のご案内: ${args.position} (${args.companyName})`,
    contents: bubble,
  };
}

/**
 * 面談 日程候補 を Quick Reply (postback) で 送信。
 *
 * Quick Reply は どの メッセージ にも 付けられる が、 本文 と セット に なる ように
 * テキスト メッセージ + Quick Reply 形式 で 返す (便利関数)。
 *
 * data 仕様:
 *   ・"line_meeting_proposal:{proposalId}:{slotIndex}"  — 該当 候補 確定
 *   ・"line_meeting_other:{proposalId}"                 — 別の日時 を 希望
 */
import type { LineMessage, LineQuickReplyItem } from "./api";

export type MeetingCandidateForLine = {
  startsAt: string; // ISO
  endsAt: string; // ISO
};

export function buildMeetingProposalMessage(
  proposalId: string,
  candidates: MeetingCandidateForLine[],
  introText: string,
): LineMessage {
  const items: LineQuickReplyItem[] = candidates.slice(0, 12).map((c, i) => ({
    type: "action",
    action: {
      type: "postback",
      label: formatSlotLabel(c.startsAt),
      data: `line_meeting_proposal:${proposalId}:${i}`,
      displayText: `${formatSlotLabel(c.startsAt)} を 選択 しました`,
    },
  }));

  // 「別の日時」も 追加 (12 個 を 超えない 範囲 で)
  if (items.length < 13) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: "別の日時",
        data: `line_meeting_other:${proposalId}`,
        displayText: "別の日時 を 希望",
      },
    });
  }

  return {
    type: "text",
    text: introText,
    quickReply: { items },
  };
}

function formatSlotLabel(iso: string): string {
  const d = new Date(iso);
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  // LINE Quick Reply は label 最大 20 字
  return `${mm}/${dd} (${"日月火水木金土"[d.getDay()]}) ${hh}:${mi}`;
}

/**
 * 複数 求人 を カルーセル で 送信 (最大 12 件 / 1 メッセージ)。
 */
export function buildJobShareCarousel(jobs: JobShareCardArgs[]): LineFlexMessage {
  if (jobs.length === 0) {
    throw new Error("jobs must contain at least one item");
  }
  if (jobs.length === 1) {
    return buildJobShareCard(jobs[0]);
  }
  const bubbles = jobs.slice(0, 12).map((j) => {
    const card = buildJobShareCard(j);
    return card.contents as FlexBubble;
  });

  return {
    type: "flex",
    altText: `求人 ${jobs.length} 件 の ご案内`,
    contents: {
      type: "carousel",
      contents: bubbles,
    },
  };
}
