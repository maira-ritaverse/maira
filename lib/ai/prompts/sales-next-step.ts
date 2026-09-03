/**
 * 営業「次アクション」提案プロンプト。
 *
 * 議事録の履歴 + 現在のステージ + 営業プレイブックを踏まえ、
 * 「次はこうすべき」という具体的な次アクションを提案する。出力はテキスト本文。
 */
import { SALES_PLAYBOOK } from "@/lib/sales/playbook";

const SYSTEM = `あなたは Myaira の営業を支援するセールスコーチです。
営業プレイブックと、これまでのミーティング議事録・現在のステージを踏まえ、
「次に取るべき具体的なアクション」を日本語で提案します。

# 出力形式(この見出しをこの順で)
【現状の見立て】
【次アクション】(具体的・すぐ実行できる・できれば期限つきで 2〜4 個)
【確認・準備すること】
【想定される懸念と返し方】
【推奨タイミング】

# ルール
1. 議事録に書かれた事実だけを根拠にする。書かれていない事実を創作しない。推測は「(推測)」と明記。
2. プレイブックのボトルネック(特に CSV 取込・意思決定)を前に進めることを優先する。
3. 出力は本文のみ。前置き・解説・マークダウンの見出し記号(#)は不要。`;

export type NextStepMeeting = {
  meetingNo: number;
  stageLabel: string | null;
  date: string | null;
  minutes: string;
};

export function buildSalesNextStepPrompt(args: {
  companyName: string;
  stageLabel: string;
  stageDescription: string;
  meetings: NextStepMeeting[];
}): { system: string; prompt: string } {
  const history = args.meetings
    .filter((m) => m.minutes.trim().length > 0)
    .map(
      (m) =>
        `## ${m.meetingNo}回目${m.stageLabel ? `(${m.stageLabel})` : ""}${m.date ? ` ${m.date}` : ""}\n${m.minutes.trim()}`,
    )
    .join("\n\n");

  const prompt = `# 営業プレイブック
${SALES_PLAYBOOK}

# この商談
会社:${args.companyName}
現在のステージ:${args.stageLabel} … ${args.stageDescription}

# これまでのミーティング議事録(新しい順)
${history || "(まだ議事録がありません)"}

上記を踏まえ、この商談の次アクションを提案してください。`;

  return { system: SYSTEM, prompt };
}
