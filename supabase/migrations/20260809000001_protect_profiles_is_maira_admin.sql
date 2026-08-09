-- =====================================================================
-- C1 (CRITICAL): profiles.is_maira_admin の自己昇格を防ぐ
--
-- 背景(監査 C1):
--   profiles の UPDATE ポリシーは
--     create policy "Users can update own profile"
--       on public.profiles for update using (auth.uid() = id);
--   のみで、WITH CHECK も列制限も無い(20260518000003_setup_rls.sql)。
--   RLS は行レベルの制御なので、自分の行であれば任意の列を書ける。
--   結果、任意の認証ユーザーが公開 anon key + 自分の JWT で
--     PATCH /rest/v1/profiles?id=eq.<自分> { "is_maira_admin": true }
--   を投げるだけで運営管理者(platform admin)に昇格でき、/api/admin/** 全機能
--   (他組織 PII の復号・ユーザー/組織削除・課金・監査ログ)と、
--   is_maira_admin=true を条件にした各 RLS ポリシー
--   (platform_announcements / platform_ai_quotas / contact_messages /
--    roi_simulations)への越境アクセスが解錠される。
--
-- 対策:
--   is_maira_admin は運営(service_role)だけが管理する列。正規フロー(アプリの
--   コード / SECURITY DEFINER RPC)で更新する箇所は一切存在しない(grep 済)。
--   そこで既存の enforce_client_records_link_immutable と同型の BEFORE UPDATE
--   トリガーで、end-user の JWT(authenticated / anon)からの is_maira_admin
--   変更だけを遮断する。service_role / postgres(ダッシュボード等の運営操作)は通す。
--   加えて列レベル権限も REVOKE して多層防御にする。
--
-- account_type について:
--   account_type は accept_invitation(SECURITY DEFINER)が「seeker →
--   organization_member」昇格で更新する。DEFINER 内でも auth.role() は呼び出し元の
--   'authenticated' になるため、ここで account_type をブロックすると招待受諾が壊れる。
--   また account_type の自己書き換えは organization_members 行が別途必要で越境
--   アクセスにならない(requireOrgMember は members 行を見る)ため、本マイグレーションの
--   対象からは外す。
-- =====================================================================

create or replace function public.enforce_profiles_privilege_columns_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role / postgres(運営のダッシュボード・psql・service client 経由)は
  -- 運営管理のため通す。実際の攻撃経路である end-user の JWT からの直 UPDATE
  -- (authenticated / anon)だけを遮断する。
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- is_maira_admin は運営のみが管理する列。ここが無いと任意ユーザーが自分の行に
  -- is_maira_admin=true を書いて運営管理者に昇格できる(C1)。
  if new.is_maira_admin is distinct from old.is_maira_admin then
    raise exception 'is_maira_admin は直接更新できません(運営のみ変更可)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_profiles_privilege_columns_immutable() is
  'profiles.is_maira_admin を end-user の直 UPDATE から保護(運営昇格 C1 対策)。service_role / postgres は通す。';

drop trigger if exists trg_profiles_privilege_columns_immutable on public.profiles;
create trigger trg_profiles_privilege_columns_immutable
  before update on public.profiles
  for each row
  execute function public.enforce_profiles_privilege_columns_immutable();

-- 多層防御:列レベルの UPDATE 権限も剥奪する。
-- authenticated / anon が is_maira_admin 列を書こうとした時点で権限エラーになる。
-- (is_maira_admin を含まない通常の profiles 更新は影響を受けない。SECURITY DEFINER
--  RPC は所有者権限で走るため影響しない。service_role からの更新も残す。)
revoke update (is_maira_admin) on public.profiles from authenticated, anon;
