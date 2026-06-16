import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { publicIntakeSubmitSchema } from "@/lib/intake-forms/types";

/**
 * POST /api/public/intake-forms/[token]
 *
 * 顧客が公開フォームから送信する Endpoint。認証不要。
 * - token から intake_forms を引いて organization_id を解決
 * - is_active が false なら受付停止メッセージ
 * - 入力を validate して client_records に INSERT(link_status='unlinked')
 * - 同メールが既にあれば「お問い合わせを受け付けました」とだけ返す(顧客側に
 *   重複の事実を漏らさない)
 *
 * セキュリティ:
 *   - service role を使うので、RLS をバイパスするのは organization_id 解決後の
 *     1 行 INSERT のみに限定する
 *   - 暗号化対象フィールドは受け付けない(平文の名前・メール・電話・備考のみ)
 *   - 簡易なリクエストサイズ上限(1 KiB 程度の入力に収まる想定)で過大入力を弾く
 */

type RouteParams = { params: Promise<{ token: string }> };

const MAX_BYTES = 16 * 1024;

export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Invalid form URL" }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = publicIntakeSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  // token から intake_form を解決
  const { data: form, error: formErr } = await service
    .from("intake_forms")
    .select("id, organization_id, entry_site, is_active")
    .eq("token", token)
    .maybeSingle();
  if (formErr || !form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  const intakeForm = form as {
    id: string;
    organization_id: string;
    entry_site: string | null;
    is_active: boolean;
  };
  if (!intakeForm.is_active) {
    return NextResponse.json({ error: "このフォームは現在受付を停止しています" }, { status: 410 });
  }

  // 重複メールチェック(同 organization で既存ならスキップして「受付完了」を装う)
  const emailLower = parsed.data.email.toLowerCase();
  const { data: existing } = await service
    .from("client_records")
    .select("id")
    .eq("organization_id", intakeForm.organization_id)
    .ilike("email", emailLower)
    .maybeSingle();

  if (!existing) {
    const desiredLocations = (parsed.data.desiredLocations ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const { error: insErr } = await service.from("client_records").insert({
      organization_id: intakeForm.organization_id,
      // 担当未割当で受け付け(後で admin が割り当てる運用)
      assigned_member_id: null,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      status: "initial_meeting",
      link_status: "unlinked",
      notes: parsed.data.notes || null,
      entry_site: intakeForm.entry_site,
      email_distribution_enabled: true,
      name_kana: parsed.data.nameKana || null,
      prefecture: parsed.data.prefecture || null,
      desired_locations: desiredLocations.length === 0 ? null : desiredLocations,
      desired_annual_income: parsed.data.desiredAnnualIncome ?? null,
      // 受付日は今日
      intake_date: new Date().toISOString().slice(0, 10),
    });
    if (insErr) {
      return NextResponse.json(
        { error: "登録に失敗しました", message: insErr.message },
        { status: 500 },
      );
    }
  }
  // 重複も新規も同じレスポンスを返す(漏洩防止)
  return NextResponse.json({ success: true });
}
