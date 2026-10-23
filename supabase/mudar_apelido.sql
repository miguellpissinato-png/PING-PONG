-- Qualquer pessoa muda o apelido de um jogador, sem senha (23/10/2026).
--
-- Serve para quem quer trocar o próprio nome. Os admins e o dono ficam de fora:
-- o apelido deles é o login da área admin, então só muda pelo painel admin.
-- Mesmas regras do cadastro: 1 a 10 letras, maiúsculas, sem repetir o apelido de outro jogador da lista.

create or replace function public.renomear_jogador(p_id bigint, p_nome text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_nome text := upper(btrim(coalesce(p_nome, '')));
begin
  if char_length(v_nome) < 1 or char_length(v_nome) > 10 then
    return jsonb_build_object('ok', false, 'erro', 'apelido_invalido');
  end if;
  if not exists (select 1 from public.jogadores where id = p_id and ativo) then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  end if;
  if exists (select 1 from public.admins where jogador_id = p_id) then
    return jsonb_build_object('ok', false, 'erro', 'protegido');
  end if;
  if exists (select 1 from public.jogadores where nome = v_nome and ativo and id <> p_id) then
    return jsonb_build_object('ok', false, 'erro', 'apelido_em_uso');
  end if;
  update public.jogadores set nome = v_nome where id = p_id and ativo;
  return jsonb_build_object('ok', true, 'nome', v_nome);
end;
$$;
revoke all on function public.renomear_jogador(bigint, text) from public;
grant execute on function public.renomear_jogador(bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
