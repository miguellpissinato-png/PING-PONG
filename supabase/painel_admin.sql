-- Painel admin do Placar Disputa Elsys.
-- Rodar uma vez no projeto placar-disputa-elsys (SQL Editor do Supabase).
--
-- dono (BUMBLEBEE): limpa histórico, exclui perfis, reseta PIN e é o único que adiciona e tira admins.
-- admin: limpa histórico, exclui perfis e reseta PIN, mas não mexe no dono nem em outros admins
--        e não adiciona nem tira admins.

create table public.admins (
  jogador_id bigint primary key references public.jogadores(id),
  dono boolean not null default false,
  criado_em timestamptz not null default now()
);
create unique index admins_um_dono on public.admins (dono) where dono;
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
comment on table public.admins is 'Admins do placar. dono = BUMBLEBEE: único que adiciona e tira admins. Só as funções admin_* leem.';

insert into public.admins (jogador_id, dono)
select id, true from public.jogadores where nome = 'BUMBLEBEE' and ativo;

-- A função antiga deixava qualquer visitante tirar jogador da lista. Agora só pelo painel admin.
drop function if exists public.remover_jogador(bigint);

-- papel de um jogador: 'dono', 'admin' ou null
create or replace function public.papel_de(p_jogador bigint)
returns text language sql stable security definer set search_path to '' as $$
  select case when a.dono then 'dono' else 'admin' end from public.admins a where a.jogador_id = p_jogador;
$$;
revoke all on function public.papel_de(bigint) from public, anon, authenticated;

create or replace function public.meu_perfil(p_token text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select case when j.id is null then jsonb_build_object('ok', false)
              else jsonb_build_object('ok', true, 'id', j.id, 'nome', j.nome, 'papel', public.papel_de(j.id)) end
    from (select public.sessao_jogador(p_token) as id) s
    left join public.jogadores j on j.id = s.id;
$$;

-- Confere quem chama e se pode mexer no alvo. Retorna o papel de quem chama ou levanta erro.
create or replace function public.admin_checar(p_token text, p_alvo bigint, p_so_dono boolean)
returns text language plpgsql stable security definer set search_path to '' as $$
declare
  v_eu bigint := public.sessao_jogador(p_token);
  v_papel text;
  v_alvo text;
begin
  if v_eu is null then raise exception 'sem_sessao'; end if;
  v_papel := public.papel_de(v_eu);
  if v_papel is null or (p_so_dono and v_papel <> 'dono') then raise exception 'sem_permissao'; end if;
  if p_alvo is not null then
    if p_alvo = v_eu then raise exception 'proprio_perfil'; end if;
    v_alvo := public.papel_de(p_alvo);
    if v_alvo = 'dono' or (v_alvo = 'admin' and v_papel <> 'dono') then raise exception 'alvo_protegido'; end if;
  end if;
  return v_papel;
end;
$$;
revoke all on function public.admin_checar(text, bigint, boolean) from public, anon, authenticated;

-- Lista para o painel
create or replace function public.admin_painel(p_token text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_papel text;
begin
  v_papel := public.admin_checar(p_token, null, false);
  return jsonb_build_object(
    'ok', true, 'papel', v_papel,
    'partidas', (select count(*) from public.partidas),
    'jogadores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'nome', j.nome, 'papel', public.papel_de(j.id),
        'tem_pin', a.jogador_id is not null,
        'bloqueado', coalesce(a.bloqueado_ate > now(), false),
        'partidas', (select count(*) from public.partidas p where p.jogador_a = j.id or p.jogador_b = j.id)
      ) order by j.nome)
      from public.jogadores j left join public.jogadores_acesso a on a.jogador_id = j.id
      where j.ativo), '[]'::jsonb));
end;
$$;

-- Excluir perfil: sai da lista e do ranking, PIN e logins apagados. As partidas ficam no histórico.
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
  delete from public.jogadores_acesso where jogador_id = p_id;
  update public.sessoes set encerrada = true where jogador_id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Resetar acesso: apaga o PIN e desconecta. A pessoa cria um PIN novo em "Criar perfil" com o mesmo apelido.
create or replace function public.admin_resetar_acesso(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.admin_checar(p_token, p_id, false);
  if not exists (select 1 from public.jogadores where id = p_id and ativo) then raise exception 'nao_encontrado'; end if;
  delete from public.jogadores_acesso where jogador_id = p_id;
  update public.sessoes set encerrada = true where jogador_id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Limpar histórico: de um jogador (p_id) ou de todos (p_id null).
create or replace function public.admin_limpar_historico(p_token text, p_id bigint default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_n int;
begin
  perform public.admin_checar(p_token, null, false);
  if p_id is null then
    delete from public.partidas where true;
  else
    delete from public.partidas where jogador_a = p_id or jogador_b = p_id;
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'apagadas', v_n);
end;
$$;

-- Só o dono adiciona e tira admins.
create or replace function public.admin_definir_admin(p_token text, p_id bigint, p_admin boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform public.admin_checar(p_token, p_id, true);
  if p_admin then
    if not exists (select 1 from public.jogadores where id = p_id and ativo) then raise exception 'nao_encontrado'; end if;
    if not exists (select 1 from public.jogadores_acesso where jogador_id = p_id) then raise exception 'sem_pin'; end if;
    insert into public.admins (jogador_id) values (p_id) on conflict do nothing;
  else
    delete from public.admins where jogador_id = p_id and not dono;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_painel(text) from public;
revoke all on function public.admin_excluir_perfil(text, bigint) from public;
revoke all on function public.admin_resetar_acesso(text, bigint) from public;
revoke all on function public.admin_limpar_historico(text, bigint) from public;
revoke all on function public.admin_definir_admin(text, bigint, boolean) from public;
grant execute on function public.admin_painel(text) to anon, authenticated;
grant execute on function public.admin_excluir_perfil(text, bigint) to anon, authenticated;
grant execute on function public.admin_resetar_acesso(text, bigint) to anon, authenticated;
grant execute on function public.admin_limpar_historico(text, bigint) to anon, authenticated;
grant execute on function public.admin_definir_admin(text, bigint, boolean) to anon, authenticated;
