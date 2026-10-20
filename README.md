# Placar Disputa Elsys

Placar de tênis de mesa no estilo fliperama, com tela de CRT antiga: pixels que tremem de vez em quando, flashes vermelho e verde, linhas de varredura e fonte de 8 bits.

## O que ele faz

- **Perfil:** ao abrir o site, cada pessoa cria o perfil com o apelido que usa na mesa e um PIN de 4 números, ou entra com o perfil que já tem. Na aba **Perfil** ela vê o próprio apelido (e pode mudar), quantas partidas jogou, venceu e perdeu, a posição no ranking, os confrontos contra cada adversário e as últimas partidas.
- **Partida:** qualquer pessoa logada escolhe os dois jogadores, define quem saca no 1º ponto e toca em **INICIAR**. Um toque no placar do jogador marca ponto para ele; DESFAZER PONTO corrige o último. Mostra jogos ganhos (melhor de 3) e status (igualdade, ponto de jogo, vencedor).
- **Regras:** o jogo vai até 11 pontos com vantagem de 2, e o saque é de quem fez o último ponto.
- **Ranking:** cada vitória vale 1 ponto (PTS). Empates são decididos pelo saldo de jogos e depois pelos pontos feitos. Quando uma partida é salva, todo mundo que estava acompanhando vai direto para o ranking e o vencedor aparece com um +1 piscando por 15 segundos.
- **Histórico:** todos os confrontos entre duplas, no formato `JÚLIO 3 x 1 FÁBIO` (quantas partidas cada um venceu contra o outro), com o total de pontos de cada um no ranking geral. Dá para filtrar por jogador.

## Como usar

Abra o `index.html` no navegador. Não precisa instalar nada.

A tela ocupa a janela inteira e se reorganiza conforme o tamanho e a orientação:

- **Em pé (celular, tablet, TV na vertical):** os dois jogadores ficam um em cima do outro, com os botões − e + ao lado dos números.
- **Deitada (TV, notebook, monitor):** o cabeçalho vira uma linha só, os jogadores ficam lado a lado e o status divide a barra de baixo com os botões. No ranking, a tabela e as últimas partidas ficam lado a lado.
- **Telas baixas (celular deitado):** as raquetes, o subtítulo e o rodapé saem para o placar caber inteiro.

Textos, números e botões crescem e encolhem com a tela, e os botões nunca ficam menores que o tamanho mínimo de toque.

### Publicar no GitHub Pages

1. No repositório, vá em **Settings › Pages**.
2. Em **Source**, escolha **Deploy from a branch**, a branch `main` e a pasta `/ (root)`.
3. Depois de alguns minutos o placar fica disponível no endereço que o GitHub mostrar.

## Partida ao vivo

Só existe uma partida em andamento por vez.

- Quem toca em **INICIAR** vira o marcador: no aparelho dele, **um toque no placar do jogador marca o ponto dele**. **DESFAZER PONTO** tira o último ponto marcado.
- Enquanto a partida rola, todo mundo que abre o site vê o placar ao vivo, com a bolinha vermelha piscando e o selo **AO VIVO**. O placar muda na hora em que o marcador toca no botão. Ninguém mais consegue iniciar outra partida.
- Nas abas Jogadores e Ranking aparece uma faixa **AO VIVO** com o placar; tocar nela volta para a partida.
- Se o marcador recarregar a página no mesmo aparelho, ele continua no controle.
- A partida termina quando o marcador toca em **SALVAR NO RANKING** ou em **ENCERRAR**. Se ninguém marcar ponto por 20 minutos, aparece para todos o botão **LIBERAR PLACAR**.

## Onde os dados ficam

Jogadores, partidas e a partida ao vivo ficam num banco [Supabase](https://supabase.com) compartilhado (projeto `placar-disputa-elsys`). O site usa o tempo real do Supabase para mostrar mudanças na hora; se a conexão de tempo real cair, ele consulta o banco a cada 2 segundos.

- **Cadastrar jogador** e **registrar partida** ficam salvos para todos.
- **Remover jogador** tira o nome da lista e do ranking para todos, mas as partidas dele continuam no histórico.
- A **partida ao vivo** fica na tabela `partida_ao_vivo`. Só o aparelho que iniciou consegue mudar o placar, pelas funções do banco (`iniciar_partida`, `atualizar_partida`, `encerrar_partida`, `liberar_partida_parada`).
- Pelo site ninguém consegue editar nomes, apagar ou registrar partidas fora da partida ao vivo, nem zerar o ranking. Isso é feito no painel do Supabase, em **Table Editor**.

Cada pessoa entra com apelido e PIN. O PIN é guardado só como hash (bcrypt) numa tabela que o site não consegue ler, e 5 PINs errados seguidos bloqueiam o perfil por 5 minutos. É um PIN de 4 números, então serve para separar os perfis, não para proteger nada importante. Apelidos que já existiam antes dos perfis podem ser assumidos por quem criar o perfil com o mesmo apelido primeiro.

### Tabelas

| Tabela | O que guarda |
| --- | --- |
| `jogadores` | `id`, `nome` (até 10 letras, maiúsculas, único entre os ativos), `ativo`, `criado_em` |
| `partidas` | `jogador_a`, `jogador_b`, `jogos_a`, `jogos_b` (quem fez 2 venceu), `pontos_a`, `pontos_b`, `criado_em` |
| `partida_ao_vivo` | Linha única com a partida em andamento: jogadores, `pontos` (quem fez cada ponto do jogo atual), jogos e pontos já fechados, `ativa` |
| `partida_ao_vivo_dono` | Chave secreta do aparelho que iniciou. Ninguém lê pelo site |
| `jogadores_acesso` | Hash do PIN de cada perfil e tentativas erradas. Ninguém lê pelo site |
| `sessoes` | Logins abertos (hash do token guardado no aparelho). Ninguém lê pelo site |

Funções de perfil: `criar_perfil`, `entrar`, `meu_perfil`, `renomear_perfil`, `sair` e `iniciar_partida_logado` (iniciar partida exige estar logado).

O endereço do banco e a chave pública ficam no topo do `app.js`. A chave pública pode ficar no código: ela só permite o que as regras do banco liberam.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Estrutura da tela |
| `style.css` | Visual arcade e efeitos de CRT |
| `app.js` | Lógica do placar, cadastro e ranking |

Fontes: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) e [VT323](https://fonts.google.com/specimen/VT323), via Google Fonts.
