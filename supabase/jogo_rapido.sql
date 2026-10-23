-- Jogo rápido (aplicado no banco em 23/10/2026).
--
-- Além da partida marcada ponto a ponto, dá para registrar só o resultado: escolhe os dois
-- jogadores, diz quem venceu e a vitória vai direto para o ranking (1 ponto, como qualquer vitória).
-- A partida fica salva como jogo único (regra_jogos = 1, 1 x 0 em jogos), sem pontos, com rapido = true.
--
-- Quem registra recebe uma chave que fica só no aparelho dele: com ela, pode desfazer o registro
-- nos 2 minutos seguintes (para corrigir quem venceu ou um toque sem querer). Depois disso, só um admin apaga.

alter table public.partidas
  add column if not exists rapido boolean not null default false;
comment on column public.partidas.rapido is 'true: jogo rápido, registrado só com o vencedor (sem pontos).';

-- chave (hash) de quem registrou cada jogo rápido. Ninguém lê pelo site; só as funções abaixo.
create table if not exists public.partidas_rapido_chave (
  partida_id bigint primary key references public.partidas (id) on delete cascade,
  chave_hash text not null,
  criada_em timestamptz not null default now()
);
alter table public.partidas_rapido_chave enable row level security;
revoke all on table public.partidas_rapido_chave from anon, authenticated;
comment on table public.partidas_rapido_chave is 'Hash da chave do aparelho que registrou cada jogo rápido (para desfazer em até 2 minutos). Só as funções do jogo rápido leem.';

-- registrar_jogo_rapido: p_vencedor = 1 (jogador_a venceu) ou 2 (jogador_b venceu). Devolve o id da partida.
create or replace function public.registrar_jogo_rapido(
  p_jogador_a bigint, p_jogador_b bigint, p_vencedor smallint, p_chave text)
returns bigint language plpgsql security definer set search_path to '' as $$
declare
  v_id bigint;
begin
  if p_chave is null or char_length(p_chave) < 20 then
    raise exception 'chave_invalida';
  end if;
  if p_vencedor is null or p_vencedor not in (1, 2) then
    raise exception 'vencedor_invalido';
  end if;
  if p_jogador_a is null or p_jogador_b is null or p_jogador_a = p_jogador_b
     or (select count(*) from public.jogadores where id in (p_jogador_a, p_jogador_b) and ativo) <> 2 then
    raise exception 'jogador_invalido';
  end if;
  -- quem está na partida ao vivo não está jogando outra
  if exists (select 1 from public.partida_ao_vivo
              where id = 1 and ativa and atualizada_em >= now() - interval '20 minutes'
                and (jogador_a in (p_jogador_a, p_jogador_b) or jogador_b in (p_jogador_a, p_jogador_b))) then
    raise exception 'em_partida';
  end if;
  -- toque repetido: a mesma dupla acabou de registrar um jogo rápido
  if exists (select 1 from public.partidas
              where rapido and criado_em > now() - interval '15 seconds'
                and least(jogador_a, jogador_b) = least(p_jogador_a, p_jogador_b)
                and greatest(jogador_a, jogador_b) = greatest(p_jogador_a, p_jogador_b)) then
    raise exception 'repetida';
  end if;
  insert into public.partidas (jogador_a, jogador_b, jogos_a, jogos_b, pontos_a, pontos_b,
                               regra_pontos, regra_vantagem, regra_direto, regra_jogos, rapido)
    values (p_jogador_a, p_jogador_b,
            case when p_vencedor = 1 then 1 else 0 end, case when p_vencedor = 2 then 1 else 0 end,
            0, 0, 1, false, null, 1, true)
    returning id into v_id;
  insert into public.partidas_rapido_chave (partida_id, chave_hash)
    values (v_id, encode(extensions.digest(p_chave, 'sha256'), 'hex'));
  -- guarda só as chaves recentes
  delete from public.partidas_rapido_chave where criada_em < now() - interval '1 day';
  return v_id;
end;
$$;
revoke all on function public.registrar_jogo_rapido(bigint, bigint, smallint, text) from public;
grant execute on function public.registrar_jogo_rapido(bigint, bigint, smallint, text) to anon, authenticated;

-- desfazer_jogo_rapido: só o aparelho que registrou, e só nos 2 primeiros minutos
create or replace function public.desfazer_jogo_rapido(p_id bigint, p_chave text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_criado timestamptz;
begin
  select p.criado_em into v_criado
    from public.partidas p
    join public.partidas_rapido_chave k on k.partida_id = p.id
   where p.id = p_id and p.rapido
     and k.chave_hash = encode(extensions.digest(coalesce(p_chave, ''), 'sha256'), 'hex');
  if v_criado is null then
    raise exception 'sem_permissao';
  end if;
  if v_criado < now() - interval '2 minutes' then
    raise exception 'tempo_esgotado';
  end if;
  delete from public.partidas where id = p_id;
end;
$$;
revoke all on function public.desfazer_jogo_rapido(bigint, text) from public;
grant execute on function public.desfazer_jogo_rapido(bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
