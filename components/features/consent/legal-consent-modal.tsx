"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { NDA_DISCLOSER_NAME, NDA_PREAMBLE, NDA_SECTIONS, NDA_TITLE } from "@/lib/nda/nda-content";
import { TERMS_LAST_UPDATED, TERMS_SECTIONS, TERMS_TITLE } from "@/lib/terms/terms-content";

type Props = {
  /** NDA の同意が必要か(未同意 or バージョン更新)。 */
  requireNda: boolean;
  /** 利用規約の同意が必要か(未同意 or バージョン更新)。 */
  requireTerms: boolean;
  /** NDA を旧バージョンで同意済みか(更新の見出し切替に使う)。 */
  hasPriorNda: boolean;
  /** 利用規約を旧バージョンで同意済みか(同上)。 */
  hasPriorTerms: boolean;
  /** この閲覧者が代表署名できる(=組織の管理者)か。false ならメンバー向けの待機表示。 */
  canSign: boolean;
};

/**
 * 法的合意(NDA + 利用規約)の同意ゲートモーダル。
 *
 * UX:
 *   - 画面をブロックする overlay。両方(または未同意のもの)に同意するまで dismiss 不可。
 *   - 管理者:必要な書類の全文をスクロール表示 → 文面の下に同意チェックをまとめて配置 →
 *     所在地・氏名(タイプ署名)を入力して同意。チェック / 入力が揃うまでボタンは無効。
 *   - 管理者以外:管理者の同意待ち表示(署名フォームは出さない)。
 *   - 同意成功 → router.refresh() でレイアウト側の判定を再評価 → モーダルが消える。
 *   - 同意時に署名済みの控え(PDF)が 1 通にまとめて署名者の登録メールに送付される。
 */
export function LegalConsentModal({
  requireNda,
  requireTerms,
  hasPriorNda,
  hasPriorTerms,
  canSign,
}: Props) {
  const router = useRouter();
  const [signerName, setSignerName] = useState("");
  const [orgAddress, setOrgAddress] = useState("");
  const [ndaChecked, setNdaChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表示中の書類のチェックが揃っているか。表示していない書類は判定対象外。
  const ndaReady = !requireNda || ndaChecked;
  const termsReady = !requireTerms || termsChecked;
  const canSubmit =
    Boolean(signerName.trim()) &&
    Boolean(orgAddress.trim()) &&
    ndaReady &&
    termsReady &&
    !submitting;

  const handleAccept = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const json: {
        signerName: string;
        orgAddress: string;
        agreedNda?: true;
        agreedTerms?: true;
      } = {
        signerName: signerName.trim(),
        orgAddress: orgAddress.trim(),
      };
      if (requireNda) json.agreedNda = true;
      if (requireTerms) json.agreedTerms = true;
      await apiFetch("/api/agency/consent/accept", { method: "POST", json });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  };

  // 見出し:更新のみ(旧版同意済み)か、新規かで文言を変える。
  const bothPrior = hasPriorNda && hasPriorTerms;
  const heading = bothPrior ? "同意が必要な書類が更新されました" : "ご利用にあたっての同意";

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="bg-background flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border p-6 shadow-xl">
        <h2 id="consent-title" className="text-xl font-bold">
          {heading}
        </h2>

        {!canSign ? (
          // 管理者以外:代表署名待ち
          <div className="mt-3 text-sm">
            <p>
              本サービスのご利用には、組織を代表して{NDA_DISCLOSER_NAME}
              との秘密保持契約(NDA)および利用規約への同意が必要です。組織の
              <strong>管理者</strong>
              が同意するまで、この画面はご利用いただけません。
            </p>
            <p className="text-muted-foreground mt-2">
              お手数ですが、組織の管理者にログインのうえ同意手続きを行うようご連絡ください。管理者が不在などでお困りの場合は
              <Link
                href="/support"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                サポート
              </Link>
              までお問い合わせください。
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mt-2 text-sm">
              本サービスを通じて求職者・クライアントの秘密情報を取り扱うにあたり、以下の内容に組織を代表してご同意ください。同意すると、署名済みの控え(PDF)をご登録のメールアドレスに送付します。
            </p>

            {/* 書類の全文(スクロール)。チェックは文面の下にまとめる。 */}
            <div className="bg-muted/30 mt-4 flex-1 space-y-6 overflow-y-auto rounded border p-4 text-xs leading-relaxed">
              {requireNda && (
                <div>
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
              )}

              {requireNda && requireTerms && <hr className="border-border" />}

              {requireTerms && (
                <div>
                  <p className="text-center text-sm font-bold">{TERMS_TITLE}</p>
                  <p className="text-muted-foreground mt-1 text-center text-[10px]">
                    最終更新日:{TERMS_LAST_UPDATED}
                  </p>
                  {TERMS_SECTIONS.map((s) => (
                    <div key={s.heading} className="mt-3">
                      <p className="font-semibold">{s.heading}</p>
                      {s.paragraphs.map((p, i) => (
                        <p key={i} className="mt-0.5 whitespace-pre-wrap">
                          {p}
                        </p>
                      ))}
                      {s.bullets && (
                        <ul className="mt-1 ml-4 list-disc space-y-0.5">
                          {s.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 同意チェック(文面の下にまとめて配置) */}
            <div className="mt-4 space-y-2 border-t pt-4">
              {requireNda && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ndaChecked}
                    onChange={(e) => setNdaChecked(e.target.checked)}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <span>上記の秘密保持契約(NDA)の内容を確認し、組織を代表して同意します。</span>
                </label>
              )}
              {requireTerms && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={termsChecked}
                    onChange={(e) => setTermsChecked(e.target.checked)}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <span>上記の利用規約の内容を確認し、組織を代表して同意します。</span>
                </label>
              )}
            </div>

            {/* 所在地(利用組織の住所)+ 署名(氏名) */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="consent-org-address">所在地(利用組織の住所)</Label>
              <Input
                id="consent-org-address"
                value={orgAddress}
                onChange={(e) => setOrgAddress(e.target.value)}
                disabled={submitting}
                maxLength={200}
                placeholder="例:〒100-0001　東京都千代田区千代田1-1"
                autoComplete="street-address"
              />
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor="consent-signer-name">署名(氏名)</Label>
              <Input
                id="consent-signer-name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                disabled={submitting}
                maxLength={100}
                placeholder="例:山田 太郎"
                autoComplete="name"
              />
              <p className="text-muted-foreground text-[11px]">
                氏名の入力をもって電子署名とみなします。
              </p>
            </div>

            {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

            {!canSubmit && !submitting && (
              <p className="text-muted-foreground mt-3 text-[11px]">
                同意するには、上記のチェックをすべて入れ、所在地と氏名を入力してください。
              </p>
            )}

            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void handleAccept()} disabled={!canSubmit}>
                {submitting ? "送信中…" : "同意する"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
