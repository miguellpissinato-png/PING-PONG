# Placar Disputa Elsys

Placar de tênis de mesa no estilo fliperama, com tela de CRT antiga: pixels que tremem de vez em quando, flashes vermelho e verde, linhas de varredura e fonte de 8 bits.

## O que ele faz

- **Partida:** escolha os dois jogadores, defina quem saca no 1º ponto e toque em **INICIAR**.
- **Placar:** botões + e − para cada jogador, jogos ganhos (melhor de 3) e status (igualdade, ponto de jogo, vencedor).
- **Regras:** o jogo vai até 11 pontos com vantagem de 2, e o saque é de quem fez o último ponto.
- **Jogadores:** cadastre e remova apelidos (até 10 letras).
- **Ranking:** ordenado por vitórias, depois saldo de jogos, depois pontos feitos, com as últimas 5 partidas.

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

## Onde os dados ficam

Jogadores e partidas ficam num banco [Supabase](https://supabase.com) compartilhado (projeto `placar-disputa-elsys`). Todo mundo que abre o site vê a mesma lista de jogadores e o mesmo ranking, e a tela se atualiza sozinha a cada 8 segundos.

- **Cadastrar jogador** e **registrar partida** ficam salvos para todos.
- **Remover jogador** tira o nome da lista e do ranking para todos, mas as partidas dele continuam no histórico.
- A **partida em andamento** (os pontos de cada jogo) fica só no aparelho que está marcando. Ela vai para o banco quando alguém fecha a melhor de 3 e toca em **SALVAR NO RANKING**.
- Pelo site ninguém consegue editar nomes, apagar partidas ou zerar o ranking. Isso é feito no painel do Supabase, em **Table Editor**.

O site não tem login: qualquer pessoa com o link pode cadastrar e remover jogadores. Um jogador removido por engano pode ser recuperado no painel, mudando `ativo` para `true` na tabela `jogadores`.

### Tabelas

| Tabela | O que guarda |
| --- | --- |
| `jogadores` | `id`, `nome` (até 10 letras, maiúsculas, único entre os ativos), `ativo`, `criado_em` |
| `partidas` | `jogador_a`, `jogador_b`, `jogos_a`, `jogos_b` (quem fez 2 venceu), `pontos_a`, `pontos_b`, `criado_em` |

O endereço do banco e a chave pública ficam no topo do `app.js`. A chave pública pode ficar no código: ela só permite o que as regras do banco liberam.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Estrutura da tela |
| `style.css` | Visual arcade e efeitos de CRT |
| `app.js` | Lógica do placar, cadastro e ranking |

Fontes: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) e [VT323](https://fonts.google.com/specimen/VT323), via Google Fonts.
