"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * LINE 友達 一覧 + 紐付け 操作 (Client Component)
 *
 * タブ:未紐付け / 紐付け済 / 解除
 * 紐付け 操作:
 *   ・各 友達 行 に セレクト + 「紐付け」ボタン
 *   ・client_record を 選んで POST /api/agency/line/user-links/manual
 *
 * 連携コード 発行:
 *   ・client_record を 選び 「コード 発行」→ 6 桁 コード を 表示 (24 時間有効)
 *   ・エージェントが その コード を 求職者 に LINE で 案内 → 求職者 が LINE で 入力 → 自動紐付け
 */
type LinkRow = {
  id: string;
  lineUserId: string;
  clientRecordId: string | null;
  clientName: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  linkedAt: string | null;
  linkMethod: "manual" | "code" | "liff_login" | "auto_name_match" | null;
  unfollowedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Tab = "unlinked" | "linked" | "unfollowed";

type Props = {
  clientOptions: Array<{ id: string; name: string }>;
};

export function LineUsersClient({ clientOptions }: Props) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unlinked");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/user-links");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { links: LinkRow[] };
      setLinks(json.links);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/agency/line/user-links", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { links: LinkRow[] };
        if (active) setLinks(json.links);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, []);

  if (loading) return <p className="text-muted-foreground text-sm">読み込み中...</p>;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const filtered = links.filter((l) => {
    if (l.unfollowedAt) return tab === "unfollowed";
    if (l.clientRecordId) return tab === "linked";
    return tab === "unlinked";
  });

  const unfollowedCount = links.filter((l) => l.unfollowedAt).length;
  const linkedCount = links.filter((l) => l.clientRecordId && !l.unfollowedAt).length;
  const unlinkedCount = links.filter((l) => !l.clientRecordId && !l.unfollowedAt).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === "unlinked"} onClick={() => setTab("unlinked")}>
          未紐付け ({unlinkedCount})
        </TabButton>
        <TabButton active={tab === "linked"} onClick={() => setTab("linked")}>
          紐付け済 ({linkedCount})
        </TabButton>
        <TabButton active={tab === "unfollowed"} onClick={() => setTab("unfollowed")}>
          解除 ({unfollowedCount})
        </TabButton>
        <BulkRefreshButton onDone={reload} />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">該当する 友達 は ありません。</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((link) => (
            <LinkRowItem
              key={link.id}
              link={link}
              clientOptions={clientOptions}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-foreground text-background" : "hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function LinkRowItem({
  link,
  clientOptions,
  onChange,
}: {
  link: LinkRow;
  clientOptions: Array<{ id: string; name: string }>;
  onChange: () => void;
}) {
  const [selectedClientId, setSelectedClientId] = useState<string>(link.clientRecordId ?? "");
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const onLink = async () => {
    if (!selectedClientId) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agency/line/user-links/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: link.lineUserId,
          clientRecordId: selectedClientId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/agency/line/user-links/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: link.lineUserId,
          clientRecordId: null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onIssueCode = async () => {
    // L3: 連打 防止 (詳細 は line-link-code-button の コメント 参照)
    if (busy || !selectedClientId) return;
    setBusy(true);
    setActionError(null);
    setIssuedCode(null);
    try {
      const res = await fetch("/api/agency/line/link-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRecordId: selectedClientId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { code: string };
      setIssuedCode(json.code);
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      // 1 秒 クール ダウン
      setTimeout(() => setBusy(false), 1000);
    }
  };

  // LINE 友達 を 元 に 新規 CRM 顧客 を 作成 して 自動 リンク
  const onCreateClient = async () => {
    if (
      !window.confirm(
        `「${link.displayName ?? "(名前なし)"}」 を CRM の 新規 顧客 として 追加 します。 よろしい ですか?`,
      )
    )
      return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/agency/line/user-links/${encodeURIComponent(link.lineUserId)}/create-client`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        {link.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.pictureUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full bg-slate-200 object-cover"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-full bg-slate-200" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{link.displayName ?? "(名前なし)"}</p>
            <span className="text-muted-foreground text-[10px]">
              {new Date(link.createdAt).toLocaleDateString("ja-JP")}
            </span>
          </div>
          <p className="text-muted-foreground truncate font-mono text-[10px]">{link.lineUserId}</p>

          {link.clientRecordId ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                {link.clientName ?? "(クライアント名なし)"}
              </span>
              {link.linkMethod && (
                <span className="text-muted-foreground text-[10px]">
                  ({linkMethodLabel(link.linkMethod)})
                </span>
              )}
              <Button size="sm" variant="outline" onClick={onUnlink} disabled={busy}>
                解除
              </Button>
            </div>
          ) : link.unfollowedAt ? (
            <p className="text-muted-foreground mt-2 text-xs">
              ブロック / 友達解除 ({new Date(link.unfollowedAt).toLocaleString("ja-JP")})
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="border-input bg-background flex-1 rounded-md border px-2 py-1.5 text-xs"
                >
                  <option value="">クライアント を 選択...</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={onLink} disabled={busy || !selectedClientId}>
                  紐付け
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onIssueCode}
                  disabled={busy || !selectedClientId}
                  title="求職者 に LINE で 入力 して もらう コード"
                >
                  コード 発行
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onCreateClient}
                  disabled={busy}
                  title="この LINE 友達 を 元に CRM に新規 顧客 を 作成"
                >
                  CRM に 追加
                </Button>
              </div>
              {issuedCode && (
                <p className="text-xs">
                  連携コード:
                  <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 font-mono font-bold tracking-widest text-amber-900">
                    {issuedCode}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    (24 時間 有効、 求職者 が LINE で 送信 すると 自動紐付け)
                  </span>
                </p>
              )}
            </div>
          )}

          {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
        </div>
      </div>
    </Card>
  );
}

function linkMethodLabel(m: "manual" | "code" | "liff_login" | "auto_name_match"): string {
  if (m === "manual") return "手動紐付け";
  if (m === "code") return "連携コード";
  if (m === "liff_login") return "LIFF ログイン";
  return "自動 マッチ";
}

/**
 * 一括 プロフィール 再取得 ボタン。
 * 「(連携前 友達)」 等 プレースホルダ 名前 の 友達 を 全部 LINE API で 取り直す。
 */
function BulkRefreshButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ target: number; updated: number; failed: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (
      !window.confirm(
        "プレースホルダ 名前 の 友達 を 全部 LINE API で 取り直します。 数秒 かかります。",
      )
    )
      return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agency/line/refresh-profile/all", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; target: number; updated: number; failed: number }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message ? body.message : "error" in body ? body.error : "失敗";
        throw new Error(msg);
      }
      setResult({ target: body.target, updated: body.updated, failed: body.failed });
      onDone();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      {result && (
        <span className="text-[10px] text-emerald-700">
          対象 {result.target} 件 → 更新 {result.updated} / 失敗 {result.failed}
        </span>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
      <Button size="sm" variant="outline" onClick={onClick} disabled={running}>
        <RefreshCw className={`mr-1 size-3 ${running ? "animate-spin" : ""}`} aria-hidden />
        {running ? "取得中..." : "プロフィール 一括 取得"}
      </Button>
    </div>
  );
}
