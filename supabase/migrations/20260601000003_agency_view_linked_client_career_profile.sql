-- ============================================
-- エージェント企業のメンバーが、リンク済みクライアントの career_profile を
-- 閲覧できるようにする SELECT ポリシー追加
--
-- 用途:
--   診断結果(career_profile.diagnosis)を、エージェントのクライアント詳細画面で
--   表示できるようにする。診断は職種マッチングの起点になる情報のため、
--   求職者が連携を承諾(link_status='linked')している間に限り共有する。
--
-- セキュリティ設計:
-- - SELECT のみ追加(INSERT/UPDATE/DELETE は本人のみ、既存ポリシー維持)。
-- - link_status='linked' のクライアントに限定。invited/revoked/unlinked は対象外。
-- - 同一 organization の所属メンバーのみ。他社のクライアントは見えない。
-- - 求職者が連携を解除すると revoked になり、本ポリシーから外れる
--   (一時的な閲覧でなく「現在の連携状態」がアクセス条件)。
-- - RLS は行単位なので、技術的には career_profile の全フィールド
--   (棚卸し summary 等)も読める。UI/コード側で diagnosis 部分のみを
--   描画することで運用上の二重防御を行う。
-- - 本格暗号化(AES-256-GCM、ユーザー鍵)導入後は、エージェントは復号できないため
--   このポリシーは「メタデータレベルの可視性のみ」を提供する形になる。
-- ============================================

create policy "Org members can view linked client career profile"
  on public.career_profiles for select
  using (
    user_id in (
      select linked_user_id from public.client_records
      where linked_user_id is not null
        and link_status = 'linked'
        and organization_id in (
          select organization_id from public.organization_members
          where user_id = auth.uid()
        )
    )
  );
