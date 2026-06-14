/**
 * MA 機能のデータ取得・更新ヘルパー
 *
 * 設計方針:
 *   - 暗号化されたフィールド(件名・本文)は API ルート / cron 内でのみ復号する。
 *     この queries.ts では「シナリオ一覧」「同意ログ」など暗号化と無関係の部分を扱う。
 *   - 取得関数は RLS により自組織分のみを返す(SECURITY DEFINER ヘルパー経由)。
 *   - 書き込み関数は organization_id を呼び出し側から受け取り、API ルートで
 *     getUserRole の結果を渡してもらう(認可は API ルート側で行う)。
 */

import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type {
  ConsentLogEntry,
  ConsentStatus,
  MAFeature,
  RecordSendLogInput,
  ScenarioActivation,
  ScenarioPreset,
  ScenarioSendStats,
  ScenarioView,
  SendLog,
  TemplateView,
} from "./types";

// ============================================
// シナリオ一覧
// ============================================

/**
 * プリセット 7 件 + 自組織の有効化レコードを LEFT JOIN して返す。
 *
 * UI ではこれを 1 件 1 枚のシナリオカードとして表示する。
 * 並び順はプリセットの sort_order(audience でグルーピング表示する想定)。
 */
export async function listScenarioViews(organizationId: string): Promise<ScenarioView[]> {
  const supabase = await createClient();

  // プリセット全件取得(認証済みなら誰でも SELECT 可)
  const { data: presetsRaw, error: presetsErr } = await supabase
    .from("ma_scenario_presets")
    .select(
      "id, key, audience, channel, name, description, trigger_event, default_trigger_days, sort_order",
    )
    .order("sort_order", { ascending: true });

  if (presetsErr) {
    throw new Error(`プリセット取得に失敗しました: ${presetsErr.message}`);
  }
  if (!presetsRaw) return [];

  // 自組織のシナリオ有効化レコード(RLS で organization_id フィルタは自動)
  const { data: activationsRaw, error: actErr } = await supabase
    .from("ma_scenarios")
    .select("id, organization_id, preset_id, is_active, trigger_days_override")
    .eq("organization_id", organizationId);

  if (actErr) {
    throw new Error(`シナリオ有効化状態の取得に失敗しました: ${actErr.message}`);
  }

  // preset_id → activation の Map で O(1) 結合
  const activationByPreset = new Map<string, ScenarioActivation>();
  for (const a of activationsRaw ?? []) {
    activationByPreset.set(a.preset_id, {
      id: a.id,
      organizationId: a.organization_id,
      presetId: a.preset_id,
      isActive: a.is_active,
      triggerDaysOverride: a.trigger_days_override,
    });
  }

  return presetsRaw.map((p) => {
    const preset: ScenarioPreset = {
      id: p.id,
      key: p.key,
      audience: p.audience,
      channel: p.channel,
      name: p.name,
      description: p.description,
      triggerEvent: p.trigger_event,
      defaultTriggerDays: p.default_trigger_days,
      sortOrder: p.sort_order,
    };
    const activation = activationByPreset.get(p.id) ?? null;
    const effectiveTriggerDays = activation?.triggerDaysOverride ?? p.default_trigger_days;
    return { preset, activation, effectiveTriggerDays };
  });
}

// ============================================
// シナリオ有効化(upsert)
// ============================================

/**
 * シナリオの有効化状態 / 日数上書きを更新する。
 *
 * 該当行が存在しなければ作る(upsert)。is_active と trigger_days_override は
 * 両方 optional で「指定された値だけ更新」する。
 *
 * 認可は API ルート側で済ませている前提(RLS は admin INSERT/UPDATE で守る)。
 */
export async function upsertScenarioActivation(params: {
  organizationId: string;
  presetId: string;
  isActive?: boolean;
  triggerDaysOverride?: number | null;
}): Promise<ScenarioActivation> {
  const supabase = await createClient();

  // 既存行を引く(upsert ではなく manual に upsert したい:
  // 一部フィールドのみ更新したいケースに対応するため)
  const { data: existing, error: selectErr } = await supabase
    .from("ma_scenarios")
    .select("id, organization_id, preset_id, is_active, trigger_days_override")
    .eq("organization_id", params.organizationId)
    .eq("preset_id", params.presetId)
    .maybeSingle();

  if (selectErr) {
    throw new Error(`シナリオ有効化状態の確認に失敗しました: ${selectErr.message}`);
  }

  if (existing) {
    const updates: Record<string, boolean | number | null> = {};
    if (params.isActive !== undefined) updates.is_active = params.isActive;
    if (params.triggerDaysOverride !== undefined)
      updates.trigger_days_override = params.triggerDaysOverride;

    if (Object.keys(updates).length === 0) {
      // 更新項目なし → そのまま返す
      return {
        id: existing.id,
        organizationId: existing.organization_id,
        presetId: existing.preset_id,
        isActive: existing.is_active,
        triggerDaysOverride: existing.trigger_days_override,
      };
    }

    const { data: updated, error: updErr } = await supabase
      .from("ma_scenarios")
      .update(updates)
      .eq("id", existing.id)
      .select("id, organization_id, preset_id, is_active, trigger_days_override")
      .single();

    if (updErr || !updated) {
      throw new Error(`シナリオ更新に失敗しました: ${updErr?.message ?? "Unknown"}`);
    }
    return {
      id: updated.id,
      organizationId: updated.organization_id,
      presetId: updated.preset_id,
      isActive: updated.is_active,
      triggerDaysOverride: updated.trigger_days_override,
    };
  }

  // 新規作成。is_active は指定されていなければ false(プリセットのまま停止状態)。
  const { data: inserted, error: insErr } = await supabase
    .from("ma_scenarios")
    .insert({
      organization_id: params.organizationId,
      preset_id: params.presetId,
      is_active: params.isActive ?? false,
      trigger_days_override: params.triggerDaysOverride ?? null,
    })
    .select("id, organization_id, preset_id, is_active, trigger_days_override")
    .single();

  if (insErr || !inserted) {
    throw new Error(`シナリオ作成に失敗しました: ${insErr?.message ?? "Unknown"}`);
  }
  return {
    id: inserted.id,
    organizationId: inserted.organization_id,
    presetId: inserted.preset_id,
    isActive: inserted.is_active,
    triggerDaysOverride: inserted.trigger_days_override,
  };
}

// ============================================
// 同意ログ
// ============================================

/**
 * 指定機能の「現在有効な同意」を返す。
 *
 * 「有効な同意」= revoked_at IS NULL の中で accepted_at が最新の 1 件。
 * UI ではこれを使って「同意済みかどうか」と「ヘッダの有効化ログ」を表示する。
 *
 * accepted_by_member_id は organization_members → users → display_name を
 * SECURITY DEFINER 関数経由で名前展開する想定だが、Phase C-1 では
 * member id をそのまま返し、UI でフォールバック表示する。
 */
export async function getActiveConsent(
  organizationId: string,
  feature: MAFeature,
): Promise<ConsentStatus> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ma_consent_log")
    .select("id, accepted_at, accepted_by_member_id, consent_version, revoked_at")
    .eq("organization_id", organizationId)
    .eq("feature", feature)
    .is("revoked_at", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`同意状態の取得に失敗しました: ${error.message}`);
  }

  if (!data) {
    return {
      feature,
      isActive: false,
      acceptedAt: null,
      acceptedByMemberName: null,
      consentVersion: null,
    };
  }

  return {
    feature,
    isActive: true,
    acceptedAt: data.accepted_at,
    acceptedByMemberName: null,
    consentVersion: data.consent_version,
  };
}

/**
 * 同意ログを新規追加する。
 *
 * 既存の有効同意があっても新しい行を作る(追記モデル)。
 * 「最新の有効同意」だけが getActiveConsent で取れる仕組み。
 */
export async function recordConsent(params: {
  organizationId: string;
  acceptedByMemberId: string;
  feature: MAFeature;
  consentVersion: string;
}): Promise<ConsentLogEntry> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ma_consent_log")
    .insert({
      organization_id: params.organizationId,
      feature: params.feature,
      consent_version: params.consentVersion,
      accepted_by_member_id: params.acceptedByMemberId,
    })
    .select(
      "id, organization_id, feature, consent_version, accepted_at, accepted_by_member_id, revoked_at, revoked_by_member_id",
    )
    .single();

  if (error || !data) {
    throw new Error(`同意ログ追加に失敗しました: ${error?.message ?? "Unknown"}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    feature: data.feature,
    consentVersion: data.consent_version,
    acceptedAt: data.accepted_at,
    acceptedByMemberId: data.accepted_by_member_id,
    revokedAt: data.revoked_at,
    revokedByMemberId: data.revoked_by_member_id,
  };
}

// ============================================
// 送信履歴(復号して画面表示用)
// ============================================

/**
 * 自組織の送信履歴を取得する(復号済み)。
 *
 * 監査用途で UI に表示する想定。デフォルトで最新 100 件、シナリオ別 / ステータス別の
 * 絞り込みオプションを受け付ける。
 *
 * 復号は API ルート / Server Component 内でのみ行う(Web クライアントには平文を返さない)。
 */
export async function listSendLogs(
  organizationId: string,
  opts?: {
    scenarioId?: string;
    status?: SendLog["status"];
    limit?: number;
  },
): Promise<SendLog[]> {
  const supabase = await createClient();

  let query = supabase
    .from("ma_send_logs")
    .select(
      "id, organization_id, scenario_id, recipient_client_record_id, recipient_email, encrypted_subject, encrypted_body, sent_at, status, error_message, resend_message_id",
    )
    .eq("organization_id", organizationId)
    .order("sent_at", { ascending: false })
    .limit(opts?.limit ?? 100);

  if (opts?.scenarioId) query = query.eq("scenario_id", opts.scenarioId);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) {
    throw new Error(`送信履歴の取得に失敗しました: ${error.message}`);
  }
  if (!data) return [];

  // 各行の subject/body を並列に復号
  const decrypted = await Promise.all(
    data.map(async (row) => {
      const subject = row.encrypted_subject
        ? ((await decryptField(row.encrypted_subject)) ?? "")
        : "";
      const body = row.encrypted_body ? ((await decryptField(row.encrypted_body)) ?? "") : "";
      const log: SendLog = {
        id: row.id,
        organizationId: row.organization_id,
        scenarioId: row.scenario_id,
        recipientClientRecordId: row.recipient_client_record_id,
        recipientEmail: row.recipient_email,
        subject,
        body,
        sentAt: row.sent_at,
        status: row.status,
        errorMessage: row.error_message,
        resendMessageId: row.resend_message_id,
      };
      return log;
    }),
  );
  return decrypted;
}

// ============================================
// シナリオ別 送信実績サマリ(カード表示用)
// ============================================

/**
 * 直近 N 日のシナリオ別 status カウントを返す。
 *
 * 件数集計のみで本文の復号は行わないため、ホットパス(MA トップ画面)で
 * 安価に呼べる。返り値はサーバーコンポーネント側で「Map<scenarioId, stats>」に整える。
 *
 * RLS により自組織分のみ集計対象になる(明示的に organization_id でも絞る)。
 */
export async function getScenarioSendStats(
  organizationId: string,
  daysWindow = 30,
): Promise<ScenarioSendStats[]> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - daysWindow * 86400 * 1000).toISOString();

  // 件数だけ欲しいので scenario_id と status だけ取る。
  // PostgREST には集計関数がないため、行を取得してアプリ側でカウントする。
  // 100 件上限の logs テーブルと違い、ここは集計目的なので全件を見る必要がある。
  const { data, error } = await supabase
    .from("ma_send_logs")
    .select("scenario_id, status")
    .eq("organization_id", organizationId)
    .gte("sent_at", cutoff);

  if (error) {
    throw new Error(`送信実績の集計に失敗しました: ${error.message}`);
  }
  if (!data) return [];

  // scenario_id ごとに sent/failed/skipped を 0 初期化してカウント
  const acc = new Map<string, ScenarioSendStats>();
  for (const row of data) {
    let s = acc.get(row.scenario_id);
    if (!s) {
      s = { scenarioId: row.scenario_id, sent: 0, failed: 0, skipped: 0 };
      acc.set(row.scenario_id, s);
    }
    if (row.status === "sent") s.sent++;
    else if (row.status === "failed") s.failed++;
    else if (row.status === "skipped") s.skipped++;
  }
  return Array.from(acc.values());
}

// ============================================
// テンプレート(件名・本文、暗号化)
// ============================================

/**
 * シナリオに紐づくテンプレートを取得する(編集 UI 用、復号済み)。
 *
 * テンプレートが未作成(初回編集)の場合は subject/body=null で返す。
 * scenarioId はクライアントから渡される値だが、RLS により自組織分以外は
 * SELECT 段階で弾かれるため、ここでの追加チェックは行わない。
 *
 * 復号は API ルート / cron 側でのみ行う設計。クライアントには平文で返す。
 */
export async function getTemplateForScenario(
  organizationId: string,
  scenarioId: string,
): Promise<TemplateView | null> {
  const supabase = await createClient();

  // ma_scenarios + ma_scenario_presets を join し、組織所有の確認も兼ねる。
  // ma_templates は左外部結合(未作成のシナリオでも preset 情報は返したい)。
  const { data: scenarioRow, error: scenarioErr } = await supabase
    .from("ma_scenarios")
    .select("id, organization_id, preset:ma_scenario_presets(name, description, audience, channel)")
    .eq("id", scenarioId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (scenarioErr) {
    throw new Error(`シナリオ情報の取得に失敗しました: ${scenarioErr.message}`);
  }
  if (!scenarioRow) return null;

  // PostgREST の Resource Embedding は対象が単一行でも配列で返るケースがある。
  // どちらにも対応できるよう型を 1 段絞り込む。
  const presetRaw = scenarioRow.preset as unknown;
  const preset =
    presetRaw && typeof presetRaw === "object"
      ? Array.isArray(presetRaw)
        ? (presetRaw[0] as
            | {
                name: string;
                description: string;
                audience: TemplateView["presetAudience"];
                channel: TemplateView["presetChannel"];
              }
            | undefined)
        : (presetRaw as {
            name: string;
            description: string;
            audience: TemplateView["presetAudience"];
            channel: TemplateView["presetChannel"];
          })
      : undefined;

  if (!preset) {
    throw new Error("シナリオに紐づくプリセットが見つかりません");
  }

  // テンプレート本体(暗号化済み)を取得
  const { data: templateRow, error: templateErr } = await supabase
    .from("ma_templates")
    .select("encrypted_subject, encrypted_body, updated_at")
    .eq("scenario_id", scenarioId)
    .maybeSingle();

  if (templateErr) {
    throw new Error(`テンプレート取得に失敗しました: ${templateErr.message}`);
  }

  // 復号(null/空文字はそのまま素通り)。
  // encryptField/decryptField は null/undefined/"" を変えずに返す契約なので、
  // unwrap した後の型は string | null として扱える。
  const subject = templateRow?.encrypted_subject
    ? await decryptField(templateRow.encrypted_subject)
    : null;
  const body = templateRow?.encrypted_body ? await decryptField(templateRow.encrypted_body) : null;

  return {
    scenarioId,
    presetName: preset.name,
    presetDescription: preset.description,
    presetAudience: preset.audience,
    presetChannel: preset.channel,
    subject,
    body,
    updatedAt: templateRow?.updated_at ?? null,
  };
}

/**
 * テンプレートの件名・本文を暗号化して保存する(insert or update)。
 *
 * 既存行があれば update、なければ insert。RLS で admin のみ書き込み可。
 * encryptField は呼び出しごとに IV を新規生成するため、毎回の保存で
 * 暗号文は変わる(平文が同じでも安全に保存できる)。
 */
export async function upsertTemplate(params: {
  organizationId: string;
  scenarioId: string;
  subject: string;
  body: string;
  updatedByMemberId: string;
}): Promise<void> {
  const supabase = await createClient();

  // 暗号化は並列でよい(独立した処理)
  const [encryptedSubject, encryptedBody] = await Promise.all([
    encryptField(params.subject),
    encryptField(params.body),
  ]);

  // upsert は scenario_id の unique 制約を使う。
  // updated_at は trigger が自動更新するため明示しない。
  const { error } = await supabase.from("ma_templates").upsert(
    {
      organization_id: params.organizationId,
      scenario_id: params.scenarioId,
      encrypted_subject: encryptedSubject,
      encrypted_body: encryptedBody,
      updated_by_member_id: params.updatedByMemberId,
    },
    { onConflict: "scenario_id" },
  );

  if (error) {
    throw new Error(`テンプレート保存に失敗しました: ${error.message}`);
  }
}

// ============================================
// 送信ログ(Edge Function から service_role で書き込む想定)
// ============================================

/**
 * 送信ログを 1 行追加する。
 *
 * このヘルパーは Web アプリ側からも(将来「テスト送信」ボタン用)、
 * Deno Edge Function 側からも使えるよう、暗号化と insert の両方をここで完結させる。
 * ただし RLS の都合で:
 *   - Edge Function 側は service_role キーで bypass
 *   - Web アプリ側から呼ぶ場合は「テスト送信 API ルート」で admin 認可した上で
 *     service_role クライアントを別途用意する必要がある(MVP では Edge Function 経由のみ)
 *
 * encryptField は呼び出しごとに IV を新規生成するため、同じ平文でも別の暗号文になる。
 */
export async function recordSendLog(input: RecordSendLogInput): Promise<void> {
  const supabase = await createClient();

  const [encryptedSubject, encryptedBody] = await Promise.all([
    encryptField(input.subject),
    encryptField(input.body),
  ]);

  const { error } = await supabase.from("ma_send_logs").insert({
    organization_id: input.organizationId,
    scenario_id: input.scenarioId,
    recipient_client_record_id: input.recipientClientRecordId,
    recipient_email: input.recipientEmail,
    encrypted_subject: encryptedSubject,
    encrypted_body: encryptedBody,
    status: input.status,
    error_message: input.errorMessage ?? null,
    resend_message_id: input.resendMessageId ?? null,
  });

  if (error) {
    // 送信ログの保存失敗はクリティカルだが、呼び出し側のメール送信処理自体は
    // 既に成功している可能性がある。メッセージにそれを示唆して throw する。
    throw new Error(`送信ログの保存に失敗しました: ${error.message}`);
  }
}

/**
 * 現在有効な同意を「撤回」する(revoked_at を埋める)。
 *
 * 撤回後、cron 側はこの機能の自動配信を行わない(送信前に getActiveConsent でチェック)。
 */
export async function revokeConsent(params: {
  organizationId: string;
  revokedByMemberId: string;
  feature: MAFeature;
}): Promise<void> {
  const supabase = await createClient();

  // 現在有効な同意行を全部 revoked にする(理論上 1 件のはずだが念のため複数許容)
  const { error } = await supabase
    .from("ma_consent_log")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_member_id: params.revokedByMemberId,
    })
    .eq("organization_id", params.organizationId)
    .eq("feature", params.feature)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`同意撤回に失敗しました: ${error.message}`);
  }
}
