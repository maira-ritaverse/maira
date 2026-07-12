/**
 * /agency/settings/integrations/zoom-diagnostic
 *
 * Zoom 連携の状況を一目で確認するための診断ページ。
 *
 * 「本番で Zoom Marketplace の審査を通したがちゃんと動いているのか」を判断するため、
 * 以下 4 種類のチェックを表示する:
 *   1. 環境変数(CLIENT_ID / SECRET / WEBHOOK_SECRET / SITE_URL の設定有無)
 *   2. このユーザーの Zoom 接続状態(OAuth 完了しているか、スコープが足りているか)
 *   3. Webhook 受信履歴(過去 30 日で recording.completed を受け取った件数)
 *   4. 録画取込パイプラインの状況(pending / uploaded / failed の内訳)
 *
 * 平文 secret は絶対に表示しない(booleans のみ)。
 */
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { getZoomConnectionStatus } from "@/lib/integrations/connection-status";
import { getZoomConfig } from "@/lib/integrations/zoom";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type StatusLine = {
  label: string;
  ok: boolean | "warn";
  detail: string;
  hint?: string;
};

export default async function ZoomDiagnosticPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    redirect("/agency/settings/integrations");
  }

  // ─── 1. 環境変数チェック ──────────────────────────
  const zoomConfig = getZoomConfig();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const isSiteUrlHttps = siteUrl.startsWith("https://");
  const isSiteUrlLocalhost =
    siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1") || siteUrl === "";
  const isSiteUrlPreview = siteUrl.includes("vercel.app");

  const envChecks: StatusLine[] = [
    {
      label: "ZOOM_CLIENT_ID",
      ok: Boolean(process.env.ZOOM_CLIENT_ID),
      detail: process.env.ZOOM_CLIENT_ID ? "設定済み" : "未設定",
      hint: "Zoom Marketplace → OAuth → Client ID をコピーして Vercel の環境変数に登録します。",
    },
    {
      label: "ZOOM_CLIENT_SECRET",
      ok: Boolean(process.env.ZOOM_CLIENT_SECRET),
      detail: process.env.ZOOM_CLIENT_SECRET ? "設定済み" : "未設定",
      hint: "Zoom Marketplace → OAuth → Client Secret を Vercel に登録します。",
    },
    {
      label: "ZOOM_WEBHOOK_SECRET",
      ok: Boolean(process.env.ZOOM_WEBHOOK_SECRET),
      detail: process.env.ZOOM_WEBHOOK_SECRET
        ? "設定済み"
        : "未設定 — Webhook を受け付けられません(致命)",
      hint: "Zoom Marketplace → Feature → Event Subscriptions → Secret Token を Vercel に登録します。これがないと録画完了通知を受け取れません。",
    },
    {
      label: "NEXT_PUBLIC_SITE_URL",
      ok: isSiteUrlHttps && !isSiteUrlLocalhost ? true : "warn",
      detail: siteUrl || "未設定",
      hint: isSiteUrlLocalhost
        ? "localhost または未設定です。 本番の Vercel では https://maira.pro のような公開 URL に設定してください。 これが localhost の場合、Zoom OAuth は必ず Error 240 になります。"
        : !isSiteUrlHttps
          ? "http:// になっています。 Zoom は https のみを許可するので Error 240 になります。"
          : isSiteUrlPreview
            ? "Vercel プレビュー URL のように見えます。 Zoom App にこの URL も Development 側の Redirect URL として登録されている必要があります。"
            : undefined,
    },
  ];

  // ─── 1.5. Error 240 リスク判定 ──────────────────────
  // Zoom OAuth Error 240 は redirect URI / scope の不一致で発生する。
  // 完全な検証は Zoom API を叩く必要があるが、代表的な原因を事前チェックする。
  const err240Reasons: string[] = [];
  if (isSiteUrlLocalhost) {
    err240Reasons.push(
      "NEXT_PUBLIC_SITE_URL が localhost または未設定。 Zoom は公開 URL を要求します。",
    );
  } else if (!isSiteUrlHttps) {
    err240Reasons.push("NEXT_PUBLIC_SITE_URL が http:// です。 https:// が必須。");
  }
  if (!zoomConfig) {
    err240Reasons.push("Zoom 設定が不完全(CLIENT_ID / SECRET / SITE_URL のいずれかが未設定)。");
  }
  const err240Line: StatusLine = {
    label: "Error 240 リスク(Zoom OAuth)",
    ok: err240Reasons.length === 0 ? true : false,
    detail:
      err240Reasons.length === 0
        ? "現状の設定では OAuth に成功するはず"
        : `${err240Reasons.length} 件のリスクを検出`,
    hint:
      err240Reasons.length > 0
        ? `以下を修正してください:\n${err240Reasons.map((r) => `・${r}`).join("\n")}\n\nそれでも Error 240 が出る場合は Zoom Marketplace 側の Redirect URL が上記の Callback URL と 完全一致(末尾スラッシュや大文字小文字も含めて)しているか、 Scopes に上記 8 個が全部登録されているか、を確認してください。`
        : "Zoom Marketplace 側の Redirect URL と Scopes 登録も併せて確認するとより安全です。",
  };
  envChecks.push(err240Line);

  // ─── 2. このユーザーの Zoom 接続状態 ─────────────
  const zoomStatus = await getZoomConnectionStatus(supabase, user.id);
  const connectionChecks: StatusLine[] = [
    {
      label: "OAuth 接続",
      ok: zoomStatus.connected,
      detail: zoomStatus.connected
        ? `接続済み (account_id: ${zoomStatus.accountId?.slice(0, 8)}...)`
        : "未接続",
      hint: zoomStatus.connected
        ? undefined
        : "/agency/settings/integrations の「Zoom を接続」から OAuth を通してください。",
    },
    {
      label: "会議作成スコープ (meeting:write:meeting)",
      ok: zoomStatus.meetingWriteEnabled,
      detail: zoomStatus.meetingWriteEnabled ? "OK" : "不足 — 再認可が必要",
      hint: zoomStatus.meetingWriteEnabled
        ? undefined
        : "Zoom Marketplace 側の App でスコープが揃っているか確認し、設定画面から Zoom を接続し直してください。",
    },
  ];

  // ─── 3. Webhook 受信履歴(過去 30 日) ─────────────
  // service role で全 org 横断(この admin は自組織 owner のため OK)ではなく、
  // 自組織のみに絞り込む。
  const admin = createServiceClient();
  // server component は request ごとに 1 回だけ実行されるので Date.now() は安全。
  // react-hooks/purity は client component 前提のルールなので disable する。
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count: zoomWebhookCount } = await admin
    .from("career_intake_recordings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", role.organization.id)
    .eq("external_source", "zoom")
    .gte("created_at", since);

  const { count: pendingCount } = await admin
    .from("career_intake_recordings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", role.organization.id)
    .eq("external_source", "zoom")
    .eq("status", "external_pending");

  const { count: uploadedCount } = await admin
    .from("career_intake_recordings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", role.organization.id)
    .eq("external_source", "zoom")
    .in("status", ["uploaded", "transcribing", "transcribed", "extracting", "extracted"])
    .gte("created_at", since);

  const { count: failedCount } = await admin
    .from("career_intake_recordings")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", role.organization.id)
    .eq("external_source", "zoom")
    .in("status", ["failed_transcribe", "failed_extract"])
    .gte("created_at", since);

  const webhookOk = (zoomWebhookCount ?? 0) > 0;
  const webhookChecks: StatusLine[] = [
    {
      label: "直近 30 日の Webhook 受信数",
      ok: webhookOk || "warn",
      detail: `${zoomWebhookCount ?? 0} 件`,
      hint: webhookOk
        ? undefined
        : "0 件の場合、以下のどれかが原因:①Zoom Marketplace で Endpoint URL が Verified になっていない ②ZOOM_WEBHOOK_SECRET が Vercel に未設定 ③Event Subscription で 'All Recordings have completed' が有効になっていない ④まだ Zoom で録画付き会議を実施していない",
    },
    {
      label: "取込パイプラインの内訳",
      ok: (pendingCount ?? 0) === 0 && (failedCount ?? 0) === 0 ? true : "warn",
      detail: `pending ${pendingCount ?? 0} / uploaded ${uploadedCount ?? 0} / failed ${failedCount ?? 0}`,
      hint:
        (pendingCount ?? 0) > 0
          ? "pending が長時間残っている場合は /api/internal/career-intake/pickup が動いていない可能性(Vercel Cron の設定を確認)"
          : (failedCount ?? 0) > 0
            ? "failed がある場合はダウンロード URL の期限切れや文字起こしエラーの可能性。 recordings の error 詳細を確認してください。"
            : undefined,
    },
  ];

  const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://maira.pro";
  const oauthCallback = `${publicSiteUrl.replace(/\/$/, "")}/api/integrations/zoom/callback`;
  const webhookEndpoint = `${publicSiteUrl.replace(/\/$/, "")}/api/webhooks/zoom/recording`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SettingsBackLink href="/agency/settings/integrations" />
      <PageHeading
        title="Zoom 連携の診断"
        description="Zoom Marketplace の審査後、実際にちゃんと動いているかを確認します。 4 種類の観点で状況を出します。"
      />

      {/* Zoom Marketplace 側で貼るべき URL */}
      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="mb-2 font-semibold">Zoom Marketplace に登録する URL(コピー用)</div>
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">OAuth Redirect URL:</span>{" "}
            <code className="rounded bg-white px-1 py-0.5">{oauthCallback}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Event Notification Endpoint URL:</span>{" "}
            <code className="rounded bg-white px-1 py-0.5">{webhookEndpoint}</code>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href="https://marketplace.zoom.us/user/build"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            <ExternalLink className="size-3" aria-hidden />
            Zoom Marketplace の管理画面を開く
          </a>
          <a
            href="/zoom-review"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            <ExternalLink className="size-3" aria-hidden />
            レビュアー向けテストガイド(公開ページ)を開く
          </a>
        </div>
      </div>

      <Section title="1. 環境変数(Vercel)" lines={envChecks} />
      <Section
        title={`2. あなたの Zoom 接続 (${zoomConfig ? "config OK" : "config 不完全"})`}
        lines={connectionChecks}
      />
      <Section title="3. Webhook 受信 と 取込パイプライン" lines={webhookChecks} />

      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <div className="mb-1 font-semibold">審査後の Zoom Marketplace 側の確認手順</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>「App Credentials」で Client ID / Secret を確認 → Vercel に貼る</li>
          <li>「Redirect URL for OAuth」に上の URL を入れる</li>
          <li>
            「Feature」→「Event Subscriptions」で <b>Endpoint URL</b> に上の Webhook URL を入れて{" "}
            <b>Save</b> → Verify を押す → 緑チェックが付く
          </li>
          <li>
            Secret Token をコピーして Vercel に <code>ZOOM_WEBHOOK_SECRET</code> として登録
          </li>
          <li>Event types で「All Recordings have completed」にチェック</li>
          <li>「Publishable」タブで公開状態を確認(審査済みなら Published)</li>
        </ol>
      </div>
    </div>
  );
}

function Section({ title, lines }: { title: string; lines: StatusLine[] }) {
  return (
    <div className="rounded border">
      <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">{title}</div>
      <ul className="divide-y">
        {lines.map((l) => (
          <li key={l.label} className="p-3">
            <div className="flex items-start gap-2">
              <div className="mt-0.5">
                {l.ok === true ? (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                ) : l.ok === "warn" ? (
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                ) : (
                  <XCircle className="size-4 text-rose-600" aria-hidden />
                )}
              </div>
              <div className="flex-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs">{l.label}</span>
                  <span className="text-muted-foreground text-xs">{l.detail}</span>
                </div>
                {l.hint && l.ok !== true && (
                  <p className="text-muted-foreground mt-1 text-xs">{l.hint}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
