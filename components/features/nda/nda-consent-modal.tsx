"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { NDA_DISCLOSER_NAME, NDA_PREAMBLE, NDA_SECTIONS, NDA_TITLE } from "@/lib/nda/nda-content";

type Props = {
  /** 旧バージョンに同意済み(true)か完全新規(false)か。文面切替に使う。 */
  hasPrior: boolean;
  /** この閲覧者が代表署名できる(=組織の管理者)か。false ならメンバー向けの待機表示。 */
  canSign: boolean;
};

/**
 * 秘密保持契約(NDA)同意モーダル(エージェント組織の管理者が代表署名)。
 *
 * UX:
 *   - 画面をブロックする overlay。同意するまで dismiss 不可。
 *   - 管理者:NDA 全文を表示 + 氏名入力(タイプ署名)+ 同意チェック → 「同意する」。
 *   - 管理者以外:管理者の同意待ち表示(署名フォームは出さない)。
 *   - 同意成功 → router.refresh() でレイアウト側の判定を再評価 → モーダルが消える。
 *   - 同意時に署名済み NDA(PDF)が署名者の登録メールに送付される。
 */
export function NdaConsentModal({ hasPrior, canSign }: Props) {
  const router = useRouter();
  const [signerName, setSignerName] = useState("");
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!signerName.trim() || !checked) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/agency/nda/accept", {
        method: "POST",
        json: { signerName: signerName.trim(), agreed: true },
      });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nda-title"
    >
      <div className="bg-background flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border p-6 shadow-xl">
        <h2 id="nda-title" className="text-xl font-bold">
          {hasPrior ? "秘密保持契約(NDA)が更新されました" : "秘密保持契約(NDA)への同意"}
        </h2>

        {!canSign ? (
          // 管理者以外:代表署名待ち
          <div className="mt-3 text-sm">
            <p>
              本サービスのご利用には、組織を代表して {NDA_DISCLOSER_NAME} との秘密保持契約(NDA)
              への同意が必要です。組織の<strong>管理者</strong>が同意するまで、この画面はご利用
              いただけません。
            </p>
            <p className="text-muted-foreground mt-2">
              お手数ですが、組織の管理者にログインのうえ同意手続きを行うようご連絡ください。
              管理者が不在などでお困りの場合は{" "}
              <Link
                href="/support"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                サポート
              </Link>{" "}
              までお問い合わせください。
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mt-2 text-sm">
              本サービスを通じて求職者・クライアントの秘密情報を取り扱うにあたり、
              以下の秘密保持契約に組織を代表してご同意ください。同意すると、署名済みの控え(PDF)を
              ご登録のメールアドレスに送付します。
            </p>

            {/* NDA 全文(スクロール) */}
            <div className="bg-muted/30 mt-4 flex-1 overflow-y-auto rounded border p-4 text-xs leading-relaxed">
              <p className="text-center text-sm font-bold">{NDA_TITLE}</p>
              <p className="mt-3">{NDA_PREAMBLE}</p>
              {NDA_SECTIONS.map((s) => (
                <div key={s.heading} className="mt-3">
                  <p className="font-semibold">{s.heading}</p>
                  {s.paragraphs.map((p, i) => (
                    <p key={i} className="mt-0.5 whitespace-pre-wrap">
                      {p}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor="nda-signer-name">署名(氏名)</Label>
              <Input
                id="nda-signer-name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                disabled={submitting}
                placeholder="例:山田 太郎"
                autoComplete="name"
              />
              <p className="text-muted-foreground text-[11px]">
                氏名の入力をもって電子署名とみなします。
              </p>
            </div>

            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={submitting}
                className="mt-1"
              />
              <span>上記の秘密保持契約の内容を確認し、組織を代表して同意します。</span>
            </label>

            {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                onClick={() => void handleAccept()}
                disabled={!signerName.trim() || !checked || submitting}
              >
                {submitting ? "送信中…" : "同意する"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
