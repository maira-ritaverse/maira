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
 * organizationName:
 *   Phase 4 で organizations に「求職者が当事者の client_records 行に対応する
 *   organization のみ select 可」ポリシーを追加したため、本人 UI でも組織名を
 *   引けるようになった。RLS で見えない場合は null になりうるが、当事者の行で
 *   あれば対応する organization も同じ条件で見える設計。
 */
export type Connection = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  linkStatus: ClientLinkStatus;
  linkedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 連携を状態別にグルーピングしたコレクション。
 *
 * UI(/app/connections)で「招待中 / 連携中 / 解除済み」のセクションを出すために、
 * サーバー側で 3 つに分けて返す。unlinked は本人から見える経路が無いため
 * 含まれない(Phase 2 RLS は invited と linked の本人 select のみ許可)。
 */
export type ConnectionsByStatus = {
  invited: Connection[];
  linked: Connection[];
  revoked: Connection[];
};
