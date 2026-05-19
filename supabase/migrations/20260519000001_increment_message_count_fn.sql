-- ============================================
-- conversations.message_count を増加させる関数
--
-- 並行更新時の整合性を保つため、update 文を1つの関数で扱う。
-- security invoker のため、呼び出し元の RLS ポリシーがそのまま効く。
-- ============================================
create or replace function public.increment_conversation_message_count(
  conversation_id_param uuid
)
returns void
language plpgsql
security invoker
as $$
begin
  update public.conversations
  set
    message_count = message_count + 1,
    last_message_at = now(),
    updated_at = now()
  where id = conversation_id_param;
end;
$$;

comment on function public.increment_conversation_message_count(uuid) is
  '会話のmessage_countを1増やす(並行更新セーフ)';
