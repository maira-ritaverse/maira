/**
 * 求職者本人の連携(client_records)表示用の型定義
 *
 * エージェント側で扱う ClientRecord(lib/clients/types.ts)とは別物。
 * 本人側 UI は client_records の中から「自分が必要とする列だけ」を camelCase に
 * 整えて受け取る形にし、エージェント内部メモ(notes)などは含めない。
 */

import type { ClientLinkStatus } from "@/lib/clients/types";

/**
 * 連携1件(本人視点)
 *
 * 含めない列:
 *   - notes:エージェント内部メモ。本人から見える行内に存在するが UI には出さない
 *   - status:エージェント側の業務進捗(initial_meeting 等)。本人 UI では意味がない
 *   - assigned_member_id:担当アドバイザーID。display_name の引き出し経路が無く
 *     表示できないため省く
 *
 * organizationName / graceDays:
 *   Phase 4 で organizations に本人 select 用ポリシーを追加したため、本人 UI でも
 *   組織名を引ける。P3 で「申請時の猶予期間(N 日)」をダイアログに出すために、
 *   organizations.revoke_grace_days もここに引いて Connection に詰める。RLS で
 *   見えない場合は null になりうるが、当事者の行であれば対応する organization も
 *   同じ条件で見える設計。
 *
 * revokeRequestedAt / revokeDeadline:
 *   P3 で「解除申請中」セクションを描画するために必要。linked / revoked 状態では
 *   両方 null。revoke_requested 状態では DB 側の申請 RPC で打刻されているはず。
 */
export type Connection = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  graceDays: number | null;
  linkStatus: ClientLinkStatus;
  linkedAt: string | null;
  revokedAt: string | null;
  revokeRequestedAt: string | null;
  revokeDeadline: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 連携を状態別にグルーピングしたコレクション。
 *
 * UI(/app/connections)で「招待中 / 連携中 / 解除申請中 / 解除済み」のセクションを
 * 出すために、サーバー側でバケットに分けて返す。unlinked は本人から見える経路が
 * 無いため含まれない。
 *
 * revokeRequested は P3 で追加。本人申請中の連携で、申請後も deadline までは
 * エージェントへの開示が継続する(時刻条件付き RLS / RPC で担保)。
 */
export type ConnectionsByStatus = {
  invited: Connection[];
  linked: Connection[];
  revokeRequested: Connection[];
  revoked: Connection[];
};
