/**
 * 面談予約 API 用のバリデーション
 *
 * UI から渡ってくる JSON を最小限の制約だけで弾く。
 * - title:最大 100 文字
 * - agenda:最大 4000 文字(暗号化後 DB に積むのでこの上限で運用)
 * - durationMinutes:5 分以上 360 分(6 時間)以下
 * - startsAt:ISO 8601 形式、過去 1 時間より未来
 */
import { z } from "zod";

export const createMeetingSchema = z.object({
  provider: z.enum(["zoom", "google_meet"]),
  clientRecordId: z.string().uuid(),
  title: z.string().min(1).max(100),
  agenda: z.string().max(4000).optional().or(z.literal("")),
  startsAt: z
    .string()
    .datetime({ offset: true })
    .refine(
      (s) => {
        const t = new Date(s).getTime();
        const now = Date.now();
        // 過去 1 時間より新しい(タイムゾーンずれ吸収のため少し緩めに)
        return t > now - 60 * 60 * 1000;
      },
      { message: "startsAt は過去より未来である必要があります" },
    ),
  durationMinutes: z.number().int().min(5).max(360),
});

export type CreateMeetingPayload = z.infer<typeof createMeetingSchema>;
