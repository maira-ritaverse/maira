import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listCalendarEvents } from "@/lib/calendar/queries";

/**
 * GET /api/agency/calendar?month=YYYY-MM
 *
 * カレンダー月切替で使用する。指定月の前後 1 週を含む範囲のイベントを返す。
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return NextResponse.json({ error: "Invalid month (expected YYYY-MM)" }, { status: 400 });
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) {
    return NextResponse.json({ error: "Invalid month value" }, { status: 400 });
  }

  // 当月 + 前後 1 週
  const start = new Date(y, m - 1, 1 - 7);
  const end = new Date(y, m, 7);
  const toIsoDate = (d: Date): string => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${day}`;
  };

  const events = await listCalendarEvents({
    organizationId: role.organization.id,
    rangeStart: toIsoDate(start),
    rangeEnd: toIsoDate(end),
  });

  return NextResponse.json({ events });
}
