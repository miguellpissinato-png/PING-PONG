# Placar Disputa Elsys

Placar de tênis de mesa no estilo fliperama, com tela de CRT antiga: pixels que tremem de vez em quando, flashes vermelho e verde, linhas de varredura e fonte de 8 bits.

## O que ele faz

- **Sem login para jogar:** o site abre direto na aba Partida. Ninguém precisa de senha: quem não está na lista toca em **+ NOVO JOGADOR** e digita o apelido.
- **Jogadores:** a aba lista todo mundo. Tocar num nome mostra quantas partidas a pessoa jogou, venceu e perdeu, a posição no ranking, os confrontos contra cada adversário e as últimas partidas. **ESTE SOU EU** marca o seu nome neste aparelho (sem senha) e destaca você no ranking. **MUDAR NOME** troca o apelido de qualquer jogador, sem senha (1 a 10 letras, sem repetir outro nome da lista); as partidas e vitórias continuam com ele. O nome de admins e do dono só muda pela área admin, porque é o login deles.
- **Partida:** qualquer pessoa escolhe os dois jogadores, define quem saca no 1º ponto e toca em **INICIAR**. Um toque no placar do jogador marca ponto para ele; dois toques rápidos no mesmo placar tiram 1 ponto dele. DESFAZER PONTO também desfaz o último ponto. Mostra jogos ganhos (quando a partida tem mais de um jogo) e status (igualdade, ponto de jogo, ponto decisivo, vencedor).
- **Dois tipos de partida:** no topo da aba Partida, **COM PONTOS** (marcada ponto a ponto, ao vivo, como sempre) ou **JOGO RÁPIDO** (só quem venceu). Cada aparelho lembra o último tipo usado.
- **Jogo rápido:** escolha os 2 jogadores, toque no lado da mesa de quem venceu (aparece o selo verde VENCEU) e toque em **REGISTRAR VITÓRIA**. A vitória vai direto para o ranking e vale 1 ponto, como qualquer outra. Errou? No ranking aparece **DESFAZER** por 2 minutos, só no aparelho que registrou; ele volta para a mesa com os mesmos jogadores para registrar de novo. Depois disso, só um admin apaga. Nas listas, o jogo rápido aparece como `RAIO venceu TROVÃO` com a etiqueta RÁPIDO.
- **Mesa de preparação:** antes de iniciar, o topo da aba Partida é a mesa vazia. Quem é escolhido aparece no seu lado (1P em cima com a raquete vermelha, 2P embaixo com a preta) e o lado que falta fica tracejado com TOQUE NUM NOME. Com os dois escolhidos, tocar num lado da mesa define quem saca primeiro, e a bolinha vai para lá.
- **Mesa de jogo:** durante a partida, o placar é uma mesa de ping-pong vista de cima, com rede no meio, raquetes vermelha (1P) e preta (2P) e o selo amarelo SAQUE em quem saca. Em pé, o 1P fica em cima e o 2P embaixo, de frente para ele; deitado, a mesa gira e os dois ficam lado a lado. Cada metade da mesa é a área de toque do jogador.
- **Regras de cada partida:** nada é fixo no sistema. Antes de INICIAR, o bloco **REGRAS DA PARTIDA** mostra as regras e o botão **MUDAR** abre:
  - **Pontos para vencer o jogo:** qualquer número a partir de 1 (digitado ou com − e +).
  - **No empate perto do fim:** **VANTAGEM DE 2** (empatou, vence quem abrir 2 pontos) ou **QUEM CHEGAR VENCE**.
  - **Vitória direta:** opcional. Ex.: 3 direto e jogo até 5 = quem fizer 3 pontos antes de o adversário marcar o primeiro vence na hora; se o adversário pontuar, o jogo vai até 5.
  - **Jogos:** jogo único, melhor de 3, melhor de 5...

  Cada aparelho lembra as últimas regras usadas. As regras aparecem no topo do placar ao vivo e no rodapé, e ficam salvas junto com o resultado. O saque é sempre de quem fez o último ponto.
- **Períodos no Ranking e no Histórico:** no topo das duas abas, **GERAL** (todo o histórico, como sempre foi), **HOJE**, **SEMANA** e **MÊS**. Cada período começa do zero, então quem tem poucas vitórias no geral ainda pode liderar o dia, a semana ou o mês. Tudo no horário do aparelho:
  - **HOJE:** da meia-noite até agora.
  - **SEMANA:** de segunda a sexta (dias úteis); zera na segunda às 0h. Partidas no sábado e no domingo não entram na semana (contam no dia, no mês e no geral). No fim de semana, a aba mostra a semana que acabou de terminar.
  - **MÊS:** do dia 1 até o último dia do mês.

  O período escolhido aparece em amarelo (ex.: `SEG 26/10 A SEX 30/10`, `OUTUBRO 2026`) e vale para o pódio, a lista, quem não jogou, as últimas partidas e os confrontos do Histórico. Cada aparelho lembra o último período usado. Cada período tem o seu pato (veja **Pato**).
- **Ranking:** os 3 primeiros aparecem num pódio (2º, 1º com coroa e 3º), com o número de vitórias e de partidas de cada um. Do 4º lugar em diante, uma lista com vitórias e derrotas por extenso e uma barra verde com a parte das partidas que a pessoa venceu. Quem nunca jogou fica separado em AINDA NÃO JOGARAM. Ordem: mais vitórias; empate decidido pelo saldo de jogos e depois pelos pontos feitos. Quando uma partida é salva, todo mundo que estava acompanhando vai direto para o ranking e o vencedor aparece com um +1 piscando por 15 segundos.
- **Pato:** cada período tem os seus patos. Vira pato quem perdeu várias partidas para o mesmo adversário dentro do período sem ganhar dele no período: **GERAL** 5 ou mais (todo o histórico), **MÊS** 4 ou mais, **SEMANA** 3 ou mais, **HOJE** 2 ou mais. Os patos aparecem só no **Ranking**, numa faixa com borda verde e um patinho de borracha logo abaixo dos botões de período, de acordo com o período escolhido: `KAMIKAZE É PATO DO TROVÃO · 2 x 0 hoje` (até 3 patos, quem mais perdeu primeiro). As outras abas não mostram a faixa. Os confrontos do Histórico mostram o patinho do período escolhido, e a página do jogador mostra o pato do geral. Conta partidas com pontos e jogos rápidos e deixa de valer na primeira vitória do pato contra o dono no período. Os mínimos ficam em `PATO_MIN`, no `app.js`.
- **Placar das partidas salvas:** jogo único mostra os pontos (ex.: `3 x 0`); partida de mais de um jogo mostra os jogos (ex.: `2 x 1`).
- **Histórico:** todos os confrontos entre duplas, no formato `JÚLIO 3 x 1 FÁBIO` (quantas partidas cada um venceu contra o outro), com o total de pontos de cada um no período escolhido (no GERAL, o ranking geral). Dá para filtrar por jogador.

- **Tutorial:** na primeira vez que o site abre num aparelho, aparece um passo a passo ilustrado com as abas, como iniciar partida, jogo rápido, 1 toque e 2 toques, partida ao vivo, ranking, histórico e jogadores. Dá para pular e rever depois em **COMO FUNCIONA**, na aba Jogadores. Quem já tinha visto o tutorial antes do jogo rápido vê uma vez só o aviso **NOVIDADE NO PLACAR**, com **VER TUDO** para o tutorial inteiro.

## Como usar

Abra o `index.html` no navegador. Não precisa instalar nada.

A tela ocupa a janela inteira e se reorganiza conforme o tamanho e a orientação:

- **Em pé (celular, tablet, TV na vertical):** os dois jogadores ficam um em cima do outro, com os botões − e + ao lado dos números.
- **Deitada (TV, notebook, monitor):** o cabeçalho vira uma linha só, os jogadores ficam lado a lado e o status divide a barra de baixo com os botões. No ranking, a tabela e as últimas partidas ficam lado a lado.
- **Telas baixas (celular deitado):** as raquetes, o subtítulo e o rodapé saem para o placar caber inteiro.

Textos, números e botões crescem e encolhem com a tela, e os botões nunca ficam menores que o tamanho mínimo de toque.

### Ícone e atalho no celular

O ícone é a mesa de ping-pong vista de cima, em pixel. Ele aparece na aba do navegador e no atalho da tela inicial: no iPhone, abra o site no Safari e toque em **Compartilhar › Adicionar à Tela de Início**; no Android, menu do Chrome **› Adicionar à tela inicial**. O atalho abre o placar em tela cheia, com o nome **Disputa**.

Arquivos: `icon.svg` (desenho original), `icon-512.png`, `icon-192.png`, `apple-touch-icon.png`, `favicon-32.png` e `manifest.webmanifest`.

### Publicar no GitHub Pages

1. No repositório, vá em **Settings › Pages**.
2. Em **Source**, escolha **Deploy from a branch**, a branch `main` e a pasta `/ (root)`.
3. Depois de alguns minutos o placar fica disponível no endereço que o GitHub mostrar.

## Partida ao vivo

Só existe uma partida em andamento por vez.

- Quem toca em **INICIAR** vira o marcador: no aparelho dele, **1 toque no placar do jogador = +1** e **2 toques rápidos no mesmo placar = −1**. O ponto entra 0,3 s depois do toque, o tempo de ver se veio um segundo toque. **DESFAZER PONTO** tira o último ponto marcado.
- Enquanto a partida rola, todo mundo que abre o site vê o placar ao vivo, com a bolinha vermelha piscando e o selo **AO VIVO**. O placar muda na hora em que o marcador toca no botão. Ninguém mais consegue iniciar outra partida.
- Nas abas Jogadores e Ranking aparece uma faixa **AO VIVO** com o placar; tocar nela volta para a partida.
- Se o marcador recarregar a página no mesmo aparelho, ele continua no controle.
- A partida termina quando o marcador toca em **SALVAR NO RANKING** ou em **ENCERRAR**. Se ninguém marcar ponto por 20 minutos, aparece para todos o botão **LIBERAR PLACAR**.

## Painel admin

O jogador **BUMBLEBEE** é o dono do placar. O PIN só existe para os admins: na aba **Jogadores**, o botão **ÁREA ADMIN** pede apelido e PIN e abre o painel.

| Ação | Dono | Admin |
| --- | --- | --- |
| Apagar as partidas de um jogador ou todo o histórico | sim | sim |
| Mudar o apelido de um jogador | sim | sim, menos dono e outros admins (o próprio pode) |
| Excluir jogador (sai da lista e do ranking; as partidas ficam no histórico) | sim | sim, menos dono e admins |
| Definir o PIN de um admin (ao torná-lo admin, ou para trocar) | sim | não |
| Tornar admin e tirar admin | sim | não |

Ninguém mexe no jogador do dono. Ações que apagam pedem confirmação (o botão vira **CONFIRMAR?**). O banco confere o login de admin e o papel em cada ação, então esconder ou mostrar botões no site não muda o que cada um pode fazer.

O SQL do painel está em `supabase/painel_admin.sql`.

## Onde os dados ficam

Jogadores, partidas e a partida ao vivo ficam num banco [Supabase](https://supabase.com) compartilhado (projeto `placar-disputa-elsys`). O site usa o tempo real do Supabase para mostrar mudanças na hora; se a conexão de tempo real cair, ele consulta o banco a cada 2 segundos.

- **Cadastrar jogador** e **registrar partida** ficam salvos para todos.
- A **partida ao vivo** fica na tabela `partida_ao_vivo`. Só o aparelho que iniciou consegue mudar o placar, pelas funções do banco (`iniciar_partida_regras`, `atualizar_partida`, `encerrar_partida`, `liberar_partida_parada`). A antiga `iniciar_partida`, sem regras, continua existindo e inicia com 11 pontos, vantagem de 2 e melhor de 3. O SQL das regras está em `supabase/regras_da_partida.sql`.
- Pelo site, só admins apagam partidas, mudam apelidos ou excluem jogadores (veja **Painel admin**). Qualquer pessoa cadastra jogador, inicia partida e registra jogo rápido (o jogo rápido não aceita quem está na partida ao vivo).

Só admins têm PIN. Ele é guardado só como hash (bcrypt) numa tabela que o site não consegue ler, e 5 PINs errados seguidos bloqueiam o acesso por 5 minutos. Quem não é admin não entra na área admin, mesmo com um PIN antigo.

### Tabelas

| Tabela | O que guarda |
| --- | --- |
| `jogadores` | `id`, `nome` (até 10 letras, maiúsculas, único entre os ativos), `ativo`, `criado_em` |
| `partidas` | `jogador_a`, `jogador_b`, `jogos_a`, `jogos_b` (quem chegou a `regra_jogos` venceu), `pontos_a`, `pontos_b`, regras usadas (`regra_pontos`, `regra_vantagem`, `regra_direto`, `regra_jogos`), `rapido` (jogo rápido: jogo único 1 x 0, sem pontos), `criado_em` |
| `partidas_rapido_chave` | Hash da chave do aparelho que registrou cada jogo rápido, para desfazer em 2 minutos. Ninguém lê pelo site |
| `partida_ao_vivo` | Linha única com a partida em andamento: jogadores, regras da partida, `pontos` (quem fez cada ponto do jogo atual), jogos e pontos já fechados, `ativa` |
| `partida_ao_vivo_dono` | Chave secreta do aparelho que iniciou. Ninguém lê pelo site |
| `jogadores_acesso` | Hash do PIN de cada admin e tentativas erradas. Ninguém lê pelo site |
| `sessoes` | Logins abertos (hash do token guardado no aparelho). Ninguém lê pelo site |
| `admins` | Quem é admin e quem é o dono (BUMBLEBEE). Ninguém lê pelo site |

Funções sem login: `criar_jogador` (só o apelido), `renomear_jogador` (SQL em `supabase/mudar_apelido.sql`), `iniciar_partida_regras`, as da partida ao vivo e as do jogo rápido (`registrar_jogo_rapido`, `desfazer_jogo_rapido`; SQL em `supabase/jogo_rapido.sql`). Login de admin: `entrar`, `meu_perfil` (devolve o papel: dono, admin ou nenhum) e `sair`.

Funções do painel admin: `admin_painel`, `admin_limpar_historico`, `admin_renomear`, `admin_excluir_perfil`, `admin_definir_admin` e `admin_definir_pin` (as duas últimas só do dono). O SQL fica em `supabase/`.

O endereço do banco e a chave pública ficam no topo do `app.js`. A chave pública pode ficar no código: ela só permite o que as regras do banco liberam.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Estrutura da tela |
| `style.css` | Visual arcade e efeitos de CRT |
| `app.js` | Lógica do placar, cadastro e ranking |

Fontes: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) e [VT323](https://fonts.google.com/specimen/VT323), via Google Fonts.
