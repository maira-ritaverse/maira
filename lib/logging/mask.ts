/**
 * ログ 出力 で PII を マスク する ヘルパー。
 *
 * 監査 Batch 2 L3 対応: 従来 は console.warn / console.error で email を
 * そのまま 出力 して いた 箇所 が あり、 Vercel Function Logs や 将来 の
 * ログ 収集 SaaS に 平文 で 流れる リスク が あった。 個人 情報 保護 法 上 の
 * 利用 目的 通知 範囲 外 で 保存 される 可能性 が ある ため、 マスク する。
 *
 * 実装: a***@example.com 形式。 ドメイン は 保持 (デリバリー 障害 の 追跡 で
 * ドメイン 単位 の 集計 が 必要 な ため)。 ローカル 部 は 1 文字 だけ 残す。
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
