-- Placar sem login: qualquer pessoa joga; PIN só para os admins.
--
-- PARTE 1 já está no banco (aplicada em 21/10/2026): criar_jogador, admin_renomear e admin_definir_pin.
-- PARTE 2 falta rodar: admin_excluir_perfil (sem ela, o botão EXCLUIR JOGADOR avisa que a ação não está ativa).
-- Rode a PARTE 2 no SQL Editor do Supabase, projeto placar-disputa-elsys, depois do merge do site novo.

-- ===================== PARTE 1 (já aplicada) =====================

-- Cadastro rápido de jogador, sem PIN.
create or replace function public.criar_jogador(p_nome text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_nome text := upper(btrim(coalesce(p_nome, '')));
  v_id bigint;
begin
  if char_length(v_nome) < 1 or char_length(v_nome) > 10 then
    return jsonb_build_object('ok', false, 'erro', 'apelido_invalido');
  end if;
  if exists (select 1 from public.jogadores where nome = v_nome and ativo) then
    return jsonb_build_object('ok', false, 'erro', 'apelido_em_uso');
  end if;
  insert into public.jogadores (nome) values (v_nome) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'nome', v_nome);
end;
$$;
revoke all on function public.criar_jogador(text) from public;
grant execute on function public.criar_jogador(text) to anon, authenticated;

-- Admin muda o apelido de um jogador (o próprio admin também pode mudar o dele).
create or replace function public.admin_renomear(p_token text, p_id bigint, p_nome text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_nome text := upper(btrim(coalesce(p_nome, '')));
  v_eu bigint := public.sessao_jogador(p_token);
begin
  perform public.admin_checar(p_token, case when p_id = v_eu then null else p_id end, false);
  if char_length(v_nome) < 1 or char_length(v_nome) > 10 then raise exception 'apelido_invalido'; end if;
  if exists (select 1 from public.jogadores where nome = v_nome and ativo and id <> p_id) then raise exception 'apelido_em_uso'; end if;
  update public.jogadores set nome = v_nome where id = p_id and ativo;
  if not found then raise exception 'nao_encontrado'; end if;
  return jsonb_build_object('ok', true, 'nome', v_nome);
end;
$$;
revoke all on function public.admin_renomear(text, bigint, text) from public;
grant execute on function public.admin_renomear(text, bigint, text) to anon, authenticated;

-- Só o dono: define ou troca o PIN de alguém, para ele entrar na área admin.
create or replace function public.admin_definir_pin(p_token text, p_id bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.admin_checar(p_token, p_id, true);
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then raise exception 'pin_invalido'; end if;
  if not exists (select 1 from public.jogadores where id = p_id and ativo) then raise exception 'nao_encontrado'; end if;
  insert into public.jogadores_acesso (jogador_id, pin_hash)
    values (p_id, extensions.crypt(p_pin, extensions.gen_salt('bf')))
    on conflict (jogador_id) do update set pin_hash = excluded.pin_hash, falhas = 0, bloqueado_ate = null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_definir_pin(text, bigint, text) from public;
grant execute on function public.admin_definir_pin(text, bigint, text) to anon, authenticated;

-- ===================== PARTE 2 (rodar no SQL Editor) =====================

-- Excluir jogador: sai da lista e do ranking; as partidas dele ficam no histórico.
create or replace function public.admin_excluir_perfil(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.admin_checar(p_token, p_id, false);
  if exists (select 1 from public.partida_ao_vivo where id = 1 and ativa and p_id in (jogador_a, jogador_b)) then
    raise exception 'em_partida';
  end if;
  update public.jogadores set ativo = false where id = p_id and ativo;
  if not found then raise exception 'nao_encontrado'; end if;
  delete from public.admins where jogador_id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_excluir_perfil(text, bigint) from public;
grant execute on function public.admin_excluir_perfil(text, bigint) to anon, authenticated;

-- O site novo não cria mais PIN para jogador comum. Fecha a função antiga
-- (rode só depois que o site novo estiver no ar; o antigo ainda usa).
revoke execute on function public.criar_perfil(text, text) from public, anon, authenticated;
