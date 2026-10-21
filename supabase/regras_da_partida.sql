-- Regras definidas a cada partida (aplicado no banco em 21/10/2026).
--
-- Antes: todo jogo ia até 11 com vantagem de 2 e a partida era melhor de 3, fixo no sistema.
-- Agora quem inicia a partida escolhe:
--   regra_pontos   pontos para vencer um jogo (qualquer número a partir de 1)
--   regra_vantagem true = empatou perto do fim, precisa abrir 2 pontos; false = quem chegar primeiro vence
--   regra_direto   vitória direta: quem fizer esse número de pontos antes de o adversário marcar
--                  o primeiro vence na hora (null = desligada). Ex.: 3 direto, senão vai até 5.
--   regra_jogos    jogos que é preciso vencer para levar a partida (1 = jogo único, 2 = melhor de 3...)
--
-- Compatível com a versão anterior do site: quem chama iniciar_partida sem as regras
-- continua jogando 11 pontos, vantagem de 2, melhor de 3.

-- partida ao vivo
alter table public.partida_ao_vivo
  add column if not exists regra_pontos integer not null default 11,
  add column if not exists regra_vantagem boolean not null default true,
  add column if not exists regra_direto integer,
  add column if not exists regra_jogos integer not null default 2;

alter table public.partida_ao_vivo
  drop constraint if exists partida_ao_vivo_jogos_a_check,
  drop constraint if exists partida_ao_vivo_jogos_b_check,
  drop constraint if exists partida_ao_vivo_pts_a_check,
  drop constraint if exists partida_ao_vivo_pts_b_check,
  drop constraint if exists partida_ao_vivo_pontos_check;

alter table public.partida_ao_vivo
  add constraint ao_vivo_regras_check check (regra_pontos >= 1 and regra_jogos >= 1 and (regra_direto is null or regra_direto >= 1)),
  add constraint ao_vivo_jogos_check check (jogos_a >= 0 and jogos_b >= 0 and jogos_a <= regra_jogos and jogos_b <= regra_jogos),
  add constraint ao_vivo_pts_check check (pts_a >= 0 and pts_b >= 0),
  -- limite técnico só contra abuso; nenhum jogo de verdade chega perto
  add constraint ao_vivo_pontos_check check (cardinality(pontos) <= 20000 and pontos <@ array[1::smallint, 2::smallint]);

comment on column public.partida_ao_vivo.regra_pontos is 'Pontos para vencer um jogo.';
comment on column public.partida_ao_vivo.regra_vantagem is 'true: no empate perto do fim, vence quem abrir 2 pontos.';
comment on column public.partida_ao_vivo.regra_direto is 'Vitória direta ao fazer esse número de pontos com o adversário zerado (null = desligada).';
comment on column public.partida_ao_vivo.regra_jogos is 'Jogos que é preciso vencer para levar a partida (1 = jogo único, 2 = melhor de 3).';

-- partidas salvas (as antigas ficam como 11 pontos, vantagem de 2, melhor de 3)
alter table public.partidas
  add column if not exists regra_pontos integer not null default 11,
  add column if not exists regra_vantagem boolean not null default true,
  add column if not exists regra_direto integer,
  add column if not exists regra_jogos integer not null default 2;

alter table public.partidas
  drop constraint if exists partidas_jogos_a_check,
  drop constraint if exists partidas_jogos_b_check,
  drop constraint if exists partidas_pontos_a_check,
  drop constraint if exists partidas_pontos_b_check,
  drop constraint if exists partidas_um_vencedor;

alter table public.partidas
  add constraint partidas_regras_check check (regra_pontos >= 1 and regra_jogos >= 1 and (regra_direto is null or regra_direto >= 1)),
  add constraint partidas_numeros_check check (jogos_a >= 0 and jogos_b >= 0 and pontos_a >= 0 and pontos_b >= 0
                                               and jogos_a <= regra_jogos and jogos_b <= regra_jogos),
  add constraint partidas_um_vencedor check ((jogos_a = regra_jogos) <> (jogos_b = regra_jogos));

comment on table public.partidas is 'Partidas encerradas, com as regras usadas em cada uma. Qualquer visitante lê e registra; ninguém edita ou apaga pelo site.';

-- iniciar_partida agora recebe as regras (com os valores antigos como padrão)
drop function if exists public.iniciar_partida(bigint, bigint, smallint, text);

create or replace function public.iniciar_partida(
  p_jogador_a bigint, p_jogador_b bigint, p_primeiro smallint, p_chave text,
  p_regra_pontos integer default 11, p_regra_vantagem boolean default true,
  p_regra_direto integer default null, p_regra_jogos integer default 2)
returns timestamptz language plpgsql security definer set search_path to '' as $$
declare
  v_inicio timestamptz;
begin
  if p_chave is null or char_length(p_chave) < 20 then
    raise exception 'chave_invalida';
  end if;
  if p_jogador_a = p_jogador_b
     or (select count(*) from public.jogadores where id in (p_jogador_a, p_jogador_b) and ativo) <> 2 then
    raise exception 'jogador_invalido';
  end if;
  if coalesce(p_regra_pontos, 0) < 1 or coalesce(p_regra_jogos, 0) < 1
     or (p_regra_direto is not null and p_regra_direto < 1) then
    raise exception 'regra_invalida';
  end if;
  insert into public.partida_ao_vivo (id, jogador_a, jogador_b, ativa)
    values (1, p_jogador_a, p_jogador_b, false)
    on conflict (id) do nothing;
  -- só abre se não houver partida ativa (ou se a ativa estiver parada há mais de 20 minutos)
  update public.partida_ao_vivo
     set jogador_a = p_jogador_a, jogador_b = p_jogador_b, primeiro = coalesce(p_primeiro, 1),
         pontos = '{}', jogos_a = 0, jogos_b = 0, pts_a = 0, pts_b = 0,
         regra_pontos = p_regra_pontos, regra_vantagem = coalesce(p_regra_vantagem, true),
         regra_direto = p_regra_direto, regra_jogos = p_regra_jogos,
         iniciada_em = now(), atualizada_em = now(), ativa = true
   where id = 1 and (not ativa or atualizada_em < now() - interval '20 minutes')
   returning iniciada_em into v_inicio;
  if v_inicio is null then
    raise exception 'partida_em_andamento';
  end if;
  insert into public.partida_ao_vivo_dono (id, chave) values (1, p_chave)
    on conflict (id) do update set chave = excluded.chave;
  return v_inicio;
end;
$$;
revoke all on function public.iniciar_partida(bigint, bigint, smallint, text, integer, boolean, integer, integer) from public;
grant execute on function public.iniciar_partida(bigint, bigint, smallint, text, integer, boolean, integer, integer) to anon, authenticated;

-- encerrar_partida guarda as regras junto com o resultado
create or replace function public.encerrar_partida(p_chave text, p_salvar boolean, p_jogos_a smallint, p_jogos_b smallint, p_pontos_a integer, p_pontos_b integer)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v public.partida_ao_vivo;
begin
  if not exists (select 1 from public.partida_ao_vivo_dono where id = 1 and chave = p_chave) then
    raise exception 'sem_permissao';
  end if;
  select * into v from public.partida_ao_vivo where id = 1 and ativa;
  if not found then
    raise exception 'partida_encerrada';
  end if;
  if p_salvar then
    insert into public.partidas (jogador_a, jogador_b, jogos_a, jogos_b, pontos_a, pontos_b,
                                 regra_pontos, regra_vantagem, regra_direto, regra_jogos)
      values (v.jogador_a, v.jogador_b, p_jogos_a, p_jogos_b, p_pontos_a, p_pontos_b,
              v.regra_pontos, v.regra_vantagem, v.regra_direto, v.regra_jogos);
  end if;
  update public.partida_ao_vivo set ativa = false, atualizada_em = now() where id = 1;
  update public.partida_ao_vivo_dono set chave = 'encerrada-' || md5(random()::text) where id = 1;
end;
$$;
