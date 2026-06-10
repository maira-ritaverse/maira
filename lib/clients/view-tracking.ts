import { createClient } from "@/lib/supabase/server";

/**
 * クライアント詳細画面の「見た」記録(新着バッジ用)
 *
 * 詳細画面 page.tsx の認可確認(client.organizationId = role.organization.id)
 * を通った後に呼び出すこと。RLS は user_id = auth.uid()
 * AND organization_id = current_user_organization_id() を要求するため、
 * organizationId は必ず「認可確認に使った自組織 ID」を渡す。
 *
 * 失敗時の方針:
 *   client_view_states への upsert 失敗は致命ではない(次に開いたとき
 *   記録されれば新着バッジが消える)。ただし「常に新着のままになる」UX を
 *   避けるため、エラーは throw せず警告ログのみ出して、呼び出し側のレンダリングを
 *   止めない。並列 Promise.all に乗せる前提なので await はするが、エラーは
 *   ハンドリング済みなので Promise.all の他要素を巻き込まない。
 *
 * onConflict: PK 相当の (user_id, client_record_id) で upsert。
 * last_viewed_at はサーバ時刻ではなくクライアント(Server Component)側で
 * 生成した new Date().toISOString() を使う。理由:後で本人データ updated_at と
 * 比較するときに「両方ともアプリ層から見た時計」で揃えたほうが齟齬が少ない。
 * (本人データの updated_at は DB のトリガで now() を入れているため厳密には
 * 別ソースだが、サーバ間の時計ズレは無視できる範囲。)
 */
export async function recordClientViewed(params: {
  userId: string;
  clientRecordId: string;
  organizationId: string;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("client_view_states").upsert(
    {
      user_id: params.userId,
      client_record_id: params.clientRecordId,
      organization_id: params.organizationId,
      last_viewed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,client_record_id" },
  );

  if (error) {
    // RLS で弾かれた場合 / 組織 ID ズレ / 接続不調などはここに来る。
    // 致命ではないので throw しない。クライアント詳細自体は引き続き描画する。
    console.warn("Failed to record client viewed:", error.message);
  }
}
