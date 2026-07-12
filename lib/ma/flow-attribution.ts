/**
 * Flow ダッシュボード用の CV attribution 集計。
 *
 * ma_conversion_events.attributed_flow_ids / last_touch_flow_id を参照して、
 * ある Flow が「何件の CV に貢献したか」を event_key ごとに返す。
 *
 * 集計軸:
 *   ・last_touch:単一帰属(この Flow が最後に到達した = 直接寄与)
 *   ・any_touch :複数帰属(このFlow が過去 30 日以内に絡んだ全 CV)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type FlowAttributionRow = {
  event_key: string;
  last_touch_count: number;
  any_touch_count: number;
};

/**
 * 指定 Flow が貢献した CV を event_key 別に集計。
 * ・org チェックは呼び出し側の責務(RLS + ここでも organizationId で絞る)
 */
export async function getFlowAttribution(
  supabase: SupabaseClient,
  organizationId: string,
  flowId: string,
): Promise<FlowAttributionRow[]> {
  // last_touch:主要指標。この Flow が最後に到達した CV
  const { data: lastTouchRows } = await supabase
    .from("ma_conversion_events")
    .select("event_key")
    .eq("organization_id", organizationId)
    .eq("last_touch_flow_id", flowId);

  // any_touch:貢献の広い側。attributed_flow_ids に含まれる全 CV
  const { data: anyTouchRows } = await supabase
    .from("ma_conversion_events")
    .select("event_key")
    .eq("organization_id", organizationId)
    .contains("attributed_flow_ids", [flowId]);

  const lastTouch = new Map<string, number>();
  for (const r of (lastTouchRows ?? []) as Array<{ event_key: string }>) {
    lastTouch.set(r.event_key, (lastTouch.get(r.event_key) ?? 0) + 1);
  }
  const anyTouch = new Map<string, number>();
  for (const r of (anyTouchRows ?? []) as Array<{ event_key: string }>) {
    anyTouch.set(r.event_key, (anyTouch.get(r.event_key) ?? 0) + 1);
  }

  const keys = new Set<string>([...lastTouch.keys(), ...anyTouch.keys()]);
  const result: FlowAttributionRow[] = [];
  for (const k of keys) {
    result.push({
      event_key: k,
      last_touch_count: lastTouch.get(k) ?? 0,
      any_touch_count: anyTouch.get(k) ?? 0,
    });
  }
  // event_key の英語キーではソートしにくいので、last_touch DESC → any_touch DESC で並べる
  result.sort((a, b) => {
    if (b.last_touch_count !== a.last_touch_count) {
      return b.last_touch_count - a.last_touch_count;
    }
    return b.any_touch_count - a.any_touch_count;
  });
  return result;
}

/** CV event_key の日本語ラベル(既知のもの) */
export const CONVERSION_EVENT_LABELS: Record<string, string> = {
  application_submitted: "応募完了",
  meeting_confirmed: "面談確定",
  interview_done: "面接完了",
  interview_started: "面接開始",
  offer_received: "内定受領",
  offer_accepted: "内定承諾",
  onboarded: "入社",
  declined: "辞退",
};

export function labelForConversionEvent(key: string): string {
  return CONVERSION_EVENT_LABELS[key] ?? key;
}
