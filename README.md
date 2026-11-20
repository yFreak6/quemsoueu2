# Quem Sou Eu?

Jogo web multiplayer em tempo real: cada jogador tem o nome de um personagem colado na testa, vê o personagem de todos **menos o próprio** e precisa descobrir quem é.

Stack: React 18 + Three.js (React Three Fiber) + Tailwind no cliente; Node + Express + Socket.io no servidor. Sons sintetizados com a Web Audio API (nenhum arquivo de áudio).

## Como jogar

1. Na tela inicial só existem **Criar Sala** e **Juntar à Sala** (ambas pedem nickname).
2. O **Host** é um jogador comum (tem boneco, personagem, vidas e turnos). Ele cadastra, edita e remove personagens e vê quantos já tem.
2b. O Host pode **adicionar e remover bots** no lobby (jogadores controlados pelo servidor, até 10 no total). Bots não enviam sugestão: recebem personagem da lista do host e jogam pelas mesmas regras. Se só houver bots na sala, o personagem do Host também sai da lista (por isso ela precisa de um nome a mais).
2c. **Correção de nome tolerante**: aceita erros de digitação, letras trocadas e grafias parecidas (ex.: "Epstein" ≈ "Episten"), sempre com o nome completo. **Caderneta**: é limpa automaticamente a cada nova partida (e preservada ao recarregar a página).
3. Cada outro jogador envia **uma** sugestão de personagem antes do início. Ninguém vê as sugestões dos outros nem a lista do host.
4. Ao iniciar, o servidor sorteia uma sugestão para o Host e distribui a lista do host entre os demais, sem repetição.
5. Em cada turno de 30 s o jogador tem só duas ações: **Chutar** (nome completo; tolera acento, maiúscula, pontuação e pequenos erros de digitação) ou **Passar a Vez** (encerra na hora e passa para a direita). Esgotar o tempo passa a vez sem perder vida. Chute errado custa uma vida; sem vidas, o jogador é eliminado e pulado. Vence quem acertar primeiro.

## Rodar

```bash
npm run install:all
npm run dev          # servidor :3001 + cliente Vite
npm test             # 52 testes do servidor
npm run build && npm start   # produção: o servidor serve client/dist
```

Há `Dockerfile` pronto para deploy. Para testar vários jogadores no mesmo navegador, use abas diferentes (a sessão fica em `sessionStorage`).

## Arquitetura

- `server/game/Room.js`: regras do jogo, sem dependência de socket. Tudo é decidido no servidor (sorteio, distribuição, ordem, tempo, chutes, vidas, eliminações, vitória). `viewFor(jogador)` monta a visão personalizada: o próprio personagem **nunca** é enviado (só após eliminação ou fim da partida).
- `server/game/fuzzy.js`: normalização + distância de Levenshtein.
- `server/net/gameServer.js`: eventos Socket.io. `server/server.js`: HTTP + estáticos.
- Prazo do turno é um horário absoluto do servidor (`deadline`), então recarregar ou reconectar não reinicia o relógio. Cada turno tem um `turnId`: cliques duplicados ou atrasados são rejeitados.
- Se o Host desconecta, a sala espera (60 s no lobby, 5 min em jogo) e fecha; **não há transferência de autoridade**.
- `client/src`: `game/GameContext` (estado e ações), `screens/`, `hud/` (ações, caderneta), `three/` (ambiente, bonecos animados, câmera), `audio/` (efeitos sintetizados).

## Testes

`server/test/room.test.js` (regras) e `server/test/network.test.js` (4 jogadores simulados sobre sockets falsos: criar/entrar/reconectar, sorteio, turnos, visibilidade). O cliente 3D não tem testes automatizados.
