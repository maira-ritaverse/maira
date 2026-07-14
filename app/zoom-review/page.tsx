/**
 * /zoom-review — Zoom Marketplace のレビュアー向けテストガイド(公開ページ、認証なし)
 *
 * Zoom の審査プロセスで「アプリのテスト方法」を求められた際に、レビュアーが
 * ログイン前に確認できる公開ドキュメント。 日英併記でスクショなしでも動線が
 * 追えるように構成する。
 *
 * ・login credentials(実際のメール・パスワード)はこのページには載せない。
 *   Zoom Marketplace のレビュースレッドから別途送る。
 * ・URL や scope 情報は公開されて問題ない情報のみ。
 */
import { AlertTriangle, CheckCircle2, ExternalLink, Info, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Zoom App Review Test Guide - Maira",
  description:
    "Step-by-step guide for Zoom Marketplace reviewers to test Maira's Zoom integration.",
};

export const dynamic = "force-static";

export default function ZoomReviewGuidePage() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://maira.pro";
  const base = siteUrl.replace(/\/$/, "");

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white p-6">
      <div className="mb-6 flex items-center gap-2 text-slate-800">
        <ShieldCheck className="size-6 text-emerald-600" aria-hidden />
        <h1 className="text-2xl font-bold">Zoom App Review Test Guide</h1>
      </div>

      <p className="mb-6 text-sm text-slate-600">
        This page is a public guide for Zoom Marketplace reviewers. Login credentials are provided
        separately via the review thread.
        <br />
        (このページは Zoom Marketplace
        のレビュアー向けの公開ガイドです。ログイン情報はレビュースレッドで別途送付されます。)
      </p>

      <div className="mb-6 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="mb-1 flex items-center gap-1 font-semibold">
          <Info className="size-4" aria-hidden />
          Product summary / 製品概要
        </div>
        <p>
          <strong>Maira</strong> is a SaaS platform for Japanese recruitment agencies. Agents host
          Zoom meetings with job seekers; Maira automatically ingests the Cloud Recording via
          Zoom&rsquo;s webhook, transcribes it, and drafts a summary. This helps agents spend less
          time on note-taking and more time counseling.
        </p>
      </div>

      <Section number={1} title="Login to Maira / Maira にログイン">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            Open{" "}
            <a href={`${base}/login`} className="text-primary underline">
              {base}/login
            </a>
          </li>
          <li>
            Enter the email address and password provided in the Zoom Marketplace review thread.
          </li>
          <li>
            You will land on the agent dashboard at{" "}
            <code className="rounded bg-slate-100 px-1">/agency</code>.
          </li>
        </ol>
      </Section>

      <Section number={2} title="Navigate to Integrations / 連携設定へ移動">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Click the gear icon (Settings) in the top-right corner.</li>
          <li>
            From the settings menu, choose <strong>Integrations (連携・アドオン)</strong>.
          </li>
          <li>
            Or directly visit{" "}
            <code className="rounded bg-slate-100 px-1">{base}/agency/settings/integrations</code>
          </li>
        </ol>
      </Section>

      <Section number={3} title="Connect Zoom / Zoom を接続">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Find the &ldquo;Zoom&rdquo; card on the Integrations page.</li>
          <li>
            Click the <strong>&ldquo;Zoom を接続&rdquo; (Connect Zoom)</strong> button.
          </li>
          <li>
            You will be redirected to Zoom&rsquo;s OAuth authorization page. Sign in with{" "}
            <em>your own Zoom test account</em>.
          </li>
          <li>Approve the requested scopes (listed below).</li>
          <li>
            You will be redirected back to Maira&rsquo;s Integrations page with a green &ldquo;Zoom
            に接続しました&rdquo; (Connected to Zoom) banner.
          </li>
        </ol>

        <div className="mt-3 rounded border bg-slate-50 p-3 text-xs">
          <div className="mb-1 font-semibold">Requested OAuth scopes</div>
          <ul className="ml-4 list-disc space-y-0.5 font-mono">
            <li>cloud_recording:read:list_user_recordings</li>
            <li>cloud_recording:read:recording</li>
            <li>user:read:user</li>
            <li>meeting:read:meeting</li>
            <li>meeting:read:list_meetings</li>
            <li>meeting:write:meeting</li>
            <li>meeting:update:meeting</li>
            <li>meeting:delete:meeting</li>
          </ul>
        </div>
      </Section>

      <Section number={4} title="Test Cloud Recording ingestion / 録画取込のテスト">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Using your own Zoom account, start a meeting with cloud recording enabled.</li>
          <li>Speak briefly (10-30 seconds), then end the meeting.</li>
          <li>
            After Zoom finishes processing the cloud recording (usually 1-5 minutes), Zoom will POST
            a <code className="rounded bg-slate-100 px-1">recording.completed</code> webhook event
            to Maira at:
            <div className="mt-1 rounded bg-white p-2 font-mono text-[11px]">
              {base}/api/webhooks/zoom/recording
            </div>
          </li>
          <li>
            Return to Maira. Under the <strong>&ldquo;キャリア棚卸し&rdquo; (Career Intake)</strong>{" "}
            section, a new entry with status{" "}
            <em>
              &ldquo;external_pending&rdquo; → &ldquo;uploaded&rdquo; → &ldquo;transcribed&rdquo;
            </em>{" "}
            will appear as our pickup job processes it.
          </li>
        </ol>
      </Section>

      <Section number={5} title="Create a Zoom meeting from Maira / Maira から Zoom 会議を作成">
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            Important — the &ldquo;面談を予約&rdquo; button only appears on the client&nbsp;
            <em>detail</em> page, not on the client list page
          </div>
          <p className="mb-2">
            If you use browser Find (Ctrl/Cmd+F) on the list page (
            <code className="rounded bg-white/70 px-1">/agency/clients</code>), you will get{" "}
            <strong>0 matches</strong>. That is expected — you must open a specific client first by
            clicking on the row of one of the seeded dummy clients (テスト太郎 / サンプル花子 /
            デモ一郎).
          </p>
          <p className="mb-2">
            The <strong>Calendar page</strong> (
            <code className="rounded bg-white/70 px-1">/agency/calendar</code>) is not for creating
            Zoom meetings — it only creates manual (offline) calendar entries. Zoom meetings can
            only be created from a client detail page.
          </p>
        </div>

        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Open the client list at{" "}
            <code className="rounded bg-slate-100 px-1">{base}/agency/clients</code>.
          </li>
          <li>
            <strong>Click on the row</strong> of any of the pre-seeded clients:
            <span className="ml-1 rounded bg-slate-100 px-1 font-medium">テスト 太郎</span>,{" "}
            <span className="rounded bg-slate-100 px-1 font-medium">サンプル 花子</span>, or{" "}
            <span className="rounded bg-slate-100 px-1 font-medium">デモ 一郎</span>. The whole row
            is clickable and will navigate to the client&rsquo;s detail page (URL becomes{" "}
            <code className="rounded bg-slate-100 px-1">/agency/clients/&lt;client-id&gt;</code>).
          </li>
          <li>
            On the detail page, look at the <strong>top-right</strong> area. You will see a button
            labeled <strong>&ldquo;面談を予約&rdquo; (Schedule Meeting)</strong>. Click it.
          </li>
          <li>
            A dialog opens. Choose <strong>&ldquo;Zoom&rdquo;</strong> as the location, enter a
            title and date/time.
          </li>
          <li>
            Click <strong>&ldquo;保存&rdquo; (Save)</strong>.
          </li>
          <li>
            Maira calls Zoom&rsquo;s{" "}
            <code className="rounded bg-slate-100 px-1">POST /users/me/meetings</code> using your
            OAuth token, and the meeting URL is saved to the client&rsquo;s meeting history (visible
            on the same detail page under &ldquo;面談履歴 / Meeting history&rdquo;).
          </li>
        </ol>

        <div className="mt-3 rounded border bg-slate-50 p-3 text-xs text-slate-700">
          <div className="mb-1 font-semibold">
            If &ldquo;面談を予約&rdquo; is disabled or missing
          </div>
          <p>
            It means Zoom is not yet connected. Go back to{" "}
            <code className="rounded bg-white px-1">/agency/settings/integrations</code> and finish
            Step 3 first. When connected, the dialog will show &ldquo;Zoom&rdquo; as a selectable
            option.
          </p>
        </div>
      </Section>

      <Section number={6} title="Disconnect / 連携解除">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Return to Integrations page.</li>
          <li>
            Click <strong>&ldquo;切断&rdquo; (Disconnect)</strong> on the Zoom card.
          </li>
          <li>Maira revokes and deletes the stored OAuth tokens.</li>
        </ol>
      </Section>

      <div className="mt-8 rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <div className="mb-1 font-semibold">If you encounter an issue</div>
        <p className="mb-2">
          Please contact us at{" "}
          <a href="mailto:admin@maira.pro" className="text-primary underline">
            admin@maira.pro
          </a>{" "}
          with a screenshot. We respond within 24 hours (JST business days).
        </p>
        <div className="mb-1 font-semibold">Regarding Error 240 (previous review)</div>
        <p>
          The redirect URI / scope registration between the Marketplace app and our production
          deployment has been reconciled. You can verify the current callback URL:
        </p>
        <code className="mt-1 block rounded bg-white p-2 font-mono text-[11px]">
          Redirect URL: {base}/api/integrations/zoom/callback
        </code>
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
        <CheckCircle2 className="size-3 text-emerald-500" aria-hidden />
        <span>All Zoom-related traffic uses TLS 1.2+.</span>
        <span>·</span>
        <span>OAuth tokens are stored AES-256-GCM encrypted.</span>
      </div>

      <div className="mt-8 flex justify-between border-t pt-4 text-xs text-slate-500">
        <a
          href="https://maira.pro/privacy"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          <ExternalLink className="size-3" aria-hidden />
          Privacy Policy
        </a>
        <a
          href="https://maira.pro/terms"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          <ExternalLink className="size-3" aria-hidden />
          Terms of Service
        </a>
      </div>
    </main>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded border border-slate-200 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
          {number}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
