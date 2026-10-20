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

Jogadores, ranking e histórico ficam salvos no `localStorage` do navegador. Cada computador tem o seu próprio ranking. Limpar os dados do navegador apaga tudo.

Na primeira abertura aparecem 4 jogadores e um ranking de exemplo. Para apagar, use o botão **APAGAR** na aba Jogadores.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Estrutura da tela |
| `style.css` | Visual arcade e efeitos de CRT |
| `app.js` | Lógica do placar, cadastro e ranking |

Fontes: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) e [VT323](https://fonts.google.com/specimen/VT323), via Google Fonts.
