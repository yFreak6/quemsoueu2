import assert from 'node:assert/strict';
import test from 'node:test';
import { isGuessCorrect } from '../game/fuzzy.js';
import { GameError, Room } from '../game/Room.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIST = ['Homem-Aranha', 'Batman', 'Super-Homem', 'Goku', 'Naruto'];

/** Sala no lobby: host + N jogadores comuns, todos com sugestão enviada. */
function lobby({ commons = 3, characters = LIST, timings = {}, suggest = true } = {}) {
  const room = new Room('TEST', { timings: { turnMs: 80, resultMs: 20, ...timings } });
  const host = room.createHost('s-host', 'Hosty');
  const others = Array.from({ length: commons }, (_, i) => room.addPlayer(`s${i}`, `Jogador${i}`));
  room.setCharacters(host.id, characters);
  if (suggest) others.forEach((p, i) => room.suggest(p.id, `Sugestao Numero${i}`));
  return { room, host, others, all: [host, ...others] };
}
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code, `esperava ${code}`);

// ---------------------------------------------------------------- chute
test('chute: ignora maiúsculas, acentos, pontuação e espaços', () => {
  assert.ok(isGuessCorrect('CLEOPATRA', 'Cleópatra'));
  assert.ok(isGuessCorrect('  homem   aranha! ', 'Homem-Aranha'));
  assert.ok(isGuessCorrect('darthvader', 'Darth Vader'));
});

test('chute: tolera erros conforme o tamanho e recusa o claramente errado', () => {
  assert.ok(isGuessCorrect('albert einstain', 'Albert Einstein'));
  assert.ok(isGuessCorrect('albrt einstain', 'Albert Einstein')); // 2 erros em nome longo
  assert.ok(isGuessCorrect('batmen', 'Batman'));
  assert.ok(!isGuessCorrect('batgirl', 'Batman'));
  assert.ok(isGuessCorrect('Thar', 'Thor')); // nome curto: 1 erro, primeira letra igual
  assert.ok(!isGuessCorrect('Duke', 'Luke')); // primeira letra diferente em nome curto não vale
  assert.ok(!isGuessCorrect('Ana', 'Ani')); // nome de 3 letras: exato
  assert.ok(!isGuessCorrect('Mussolini', 'Napoleão'));
  assert.ok(!isGuessCorrect('Superman', 'Batman'));
  assert.ok(!isGuessCorrect('a', 'A'));
});

test('chute: palavra isolada ou parte do nome não vale', () => {
  assert.ok(!isGuessCorrect('einstein', 'Albert Einstein'));
  assert.ok(!isGuessCorrect('albert', 'Albert Einstein'));
  assert.ok(!isGuessCorrect('michael', 'Michael Jackson'));
  assert.ok(!isGuessCorrect('homem', 'Homem-Aranha'));
});

test('chute: grafia diferente do nome (Epstein/Episten), letras trocadas e som parecido', () => {
  assert.ok(isGuessCorrect('Epstein', 'Episten')); // o host digitou errado, o jogador acertou a grafia
  assert.ok(isGuessCorrect('Episten', 'Epstein'));
  assert.ok(isGuessCorrect('albert eintsien', 'Albert Einstein')); // letras vizinhas trocadas
  assert.ok(isGuessCorrect('Kleopatra', 'Cleópatra')); // c/k
  assert.ok(isGuessCorrect('Filipe Neto', 'Felipe Neto'));
  assert.ok(isGuessCorrect('Michael Jakson', 'Michael Jackson'));
  assert.ok(isGuessCorrect('Jhonny Depp', 'Johnny Depp'));
  assert.ok(isGuessCorrect('Spiderman', 'Spider-Man'));
  assert.ok(isGuessCorrect('Harry Poter', 'Harry Potter'));
});

test('chute: nomes diferentes continuam errados', () => {
  assert.ok(!isGuessCorrect('Mario', 'Luigi'));
  assert.ok(!isGuessCorrect('Goku', 'Gohan'));
  assert.ok(!isGuessCorrect('Hulk', 'Thor'));
  assert.ok(!isGuessCorrect('Pikachu', 'Raichu'));
  assert.ok(!isGuessCorrect('Napoleão', 'Cleópatra'));
  assert.ok(!isGuessCorrect('Albert Einstein', 'Isaac Newton'));
});

// ---------------------------------------------------------------- salas
test('o host é um jogador: tem boneco, assento 0, personagem e vidas', () => {
  const { room, host } = lobby();
  assert.equal(host.isHost, true);
  assert.equal(host.seat, 0);
  room.start(host.id);
  const v = room.viewFor(host.id);
  assert.equal(v.players.length, 4);
  assert.ok(v.players.every((p) => p.lives === 3));
  assert.ok(room.host.character);
});

test('nickname: vazio, curto, longo, só símbolos e repetido são recusados', () => {
  const room = new Room('T');
  room.createHost('h', 'Host');
  throwsCode(() => room.addPlayer('a', ''), 'NICK_INVALID');
  throwsCode(() => room.addPlayer('a', 'x'), 'NICK_INVALID');
  throwsCode(() => room.addPlayer('a', 'a'.repeat(17)), 'NICK_INVALID');
  throwsCode(() => room.addPlayer('a', '!!!'), 'NICK_INVALID');
  throwsCode(() => room.addPlayer('a', '<b>'), 'NICK_INVALID');
  throwsCode(() => room.addPlayer('a', 'HOST'), 'NICK_TAKEN');
  assert.equal(room.addPlayer('a', '  Ana  Maria ').nickname, 'Ana Maria');
});

test('sala cheia e partida em andamento tornam a sala indisponível', () => {
  const many = Array.from({ length: 12 }, (_, i) => `Personagem ${i}`);
  const { room, host } = lobby({ commons: 9, characters: many }); // 10 jogadores
  throwsCode(() => room.addPlayer('x', 'Extra'), 'ROOM_FULL');
  room.start(host.id);
  throwsCode(() => room.addPlayer('x', 'Extra'), 'ROOM_STARTED');
});

test('lobby: jogador que cai some da lista depois do prazo, e a lista fica sem buracos', async () => {
  const { room, others } = lobby({ timings: { lobbyGraceMs: 30 } });
  room.disconnect('s1');
  assert.equal(room.byId(others[1].id).connected, false);
  await sleep(70);
  assert.equal(room.players.length, 3);
  assert.deepEqual(room.players.map((p) => p.seat), [0, 1, 2]);
  assert.ok(!room.players.some((p) => p.nickname === 'Jogador1'));
  room.destroy();
});

test('reconectar com o token devolve o lugar e cancela a remoção', async () => {
  const { room, others } = lobby({ timings: { lobbyGraceMs: 30 } });
  room.disconnect('s0');
  room.rejoin(others[0].token, 'novo-socket');
  await sleep(60);
  assert.equal(room.players.length, 4);
  assert.equal(room.byId(others[0].id).connected, true);
  throwsCode(() => room.rejoin('token-falso', 'x'), 'SESSION_EXPIRED');
  room.destroy();
});

test('host desconectado: sem transferência de autoridade; volta a tempo ou a sala fecha', async () => {
  const closes = [];
  const a = lobby({ timings: { hostGraceLobbyMs: 40 } });
  a.room.onClose = (r, reason) => closes.push(reason);
  a.room.disconnect('s-host');
  await sleep(20);
  assert.equal(a.room.host.id, a.host.id); // continua sendo o host
  a.room.rejoin(a.host.token, 'novo');
  await sleep(60);
  assert.deepEqual(closes, []); // voltou a tempo

  const b = lobby({ timings: { hostGraceLobbyMs: 30 } });
  b.room.onClose = (r, reason) => closes.push(reason);
  b.room.disconnect('s-host');
  await sleep(70);
  assert.deepEqual(closes, ['host-timeout']);
  assert.equal(b.room.phase, 'closed');
  throwsCode(() => b.room.addPlayer('z', 'Novo'), 'ROOM_CLOSED');
});

test('host que sai encerra a sala; jogador comum que sai apenas deixa a sala', () => {
  const closes = [];
  const { room, host, others } = lobby();
  room.onClose = (r, reason) => closes.push(reason);
  room.leave(others[0].id);
  assert.equal(room.players.length, 3);
  room.leave(host.id);
  assert.deepEqual(closes, ['host-left']);
});

// ---------------------------------------------------------------- personagens e sorteio
test('só o host mexe na lista; duplicados e vazios saem; dá para corrigir e remover', () => {
  const { room, host, others } = lobby({ characters: [] });
  throwsCode(() => room.setCharacters(others[0].id, ['X']), 'NOT_HOST');
  room.setCharacters(host.id, ['Batman', ' batman ', '', '   ', '!!!', 'Goku', 'Vegeta']);
  assert.deepEqual(room.characters, ['Batman', 'Goku', 'Vegeta']);
  room.setCharacters(host.id, ['Batman', 'Gokou', 'Vegeta']); // correção
  assert.deepEqual(room.characters, ['Batman', 'Gokou', 'Vegeta']);
  room.setCharacters(host.id, ['Batman']); // remoção
  assert.equal(room.characters.length, 1);
});

test('só jogadores comuns sugerem; uma sugestão por jogador (trocar substitui); nome inválido é recusado', () => {
  const { room, host, others } = lobby({ suggest: false });
  throwsCode(() => room.suggest(host.id, 'Shrek'), 'NOT_ALLOWED');
  throwsCode(() => room.suggest(others[0].id, '   '), 'INVALID');
  throwsCode(() => room.suggest(others[0].id, '???'), 'INVALID');
  room.suggest(others[0].id, 'Shrek');
  room.suggest(others[0].id, 'Mario');
  assert.equal(room.byId(others[0].id).suggestion, 'Mario');
  assert.equal(room.players.filter((p) => p.suggestion).length, 1);
});

test('exemplo do enunciado: host recebe uma sugestão, B/C/D recebem os 3 do host sem repetir', () => {
  for (let run = 0; run < 300; run++) {
    const room = new Room('T');
    const host = room.createHost('h', 'Host');
    const [b, c, d] = ['B', 'C', 'D'].map((n, i) => room.addPlayer(`s${i}`, `Jogador ${n}`));
    room.setCharacters(host.id, ['Homem-Aranha', 'Batman', 'Super-Homem']);
    room.suggest(b.id, 'Shrek');
    room.suggest(c.id, 'Mario');
    room.suggest(d.id, 'Sonic');
    room.start(host.id);
    assert.ok(['Shrek', 'Mario', 'Sonic'].includes(host.character), 'o host recebe uma sugestão');
    const got = [b, c, d].map((p) => p.character);
    assert.deepEqual([...got].sort(), ['Batman', 'Homem-Aranha', 'Super-Homem'], 'distribuição sem repetição');
    room.destroy();
  }
});

test('lista maior que o necessário: cada jogador recebe um nome diferente da lista, e o host nunca da lista', () => {
  for (let run = 0; run < 200; run++) {
    const { room, host, others } = lobby({ commons: 3 });
    room.start(host.id);
    const chars = others.map((p) => p.character);
    assert.equal(new Set(chars).size, 3);
    assert.ok(chars.every((c) => LIST.includes(c)));
    assert.ok(!LIST.includes(host.character));
    assert.ok(host.character.startsWith('Sugestao'));
    room.destroy();
  }
});

test('sugestão igual a um nome da lista nunca gera personagem repetido; sem saída, o sorteio avisa', () => {
  for (let run = 0; run < 100; run++) {
    const room = new Room('T');
    const host = room.createHost('h', 'Host');
    const a = room.addPlayer('a', 'Ana');
    const b = room.addPlayer('b', 'Beto');
    room.setCharacters(host.id, ['A Um', 'B Dois']);
    room.suggest(a.id, 'a um'); // coincide com a lista
    room.suggest(b.id, 'Zed');
    room.start(host.id);
    assert.equal(host.character, 'Zed');
    assert.deepEqual([a.character, b.character].sort(), ['A Um', 'B Dois']);
    room.destroy();
  }
  const room = new Room('T');
  const host = room.createHost('h', 'Host');
  const a = room.addPlayer('a', 'Ana');
  room.setCharacters(host.id, ['Só Um']);
  room.suggest(a.id, 'so um');
  throwsCode(() => room.start(host.id), 'DRAW_FAILED');
  assert.equal(room.phase, 'lobby'); // falha não corrompe a sala
});

// ---------------------------------------------------------------- validação de início
test('início: explica o que falta e só o host inicia', () => {
  const { room, host, others } = lobby({ suggest: false, characters: ['Batman'] });
  throwsCode(() => room.start(others[0].id), 'NOT_HOST');
  const r = room.readiness();
  assert.equal(r.ok, false);
  assert.match(r.missing.join(' '), /Faltam sugestões de: Jogador0, Jogador1, Jogador2/);
  assert.match(r.missing.join(' '), /Cadastre pelo menos 3/);
  assert.throws(() => room.start(host.id), /Faltam sugestões/);

  const solo = new Room('S');
  const h = solo.createHost('h', 'Solo');
  throwsCode(() => solo.start(h.id), 'NOT_READY');
  assert.match(solo.readiness().missing[0], /mais um jogador/);
  assert.equal(room.phase, 'lobby');
});

test('início: jogador sem conexão bloqueia a partida até voltar', () => {
  const { room, host, others } = lobby();
  room.disconnect('s1');
  assert.match(room.readiness().missing.join(' '), /Sem conexão: Jogador1/);
  throwsCode(() => room.start(host.id), 'NOT_READY');
  room.rejoin(others[1].token, 'back');
  room.start(host.id);
  assert.equal(room.phase, 'playing');
  room.destroy();
});

test('clique duplo em Iniciar: o segundo é recusado e o sorteio não muda', () => {
  const { room, host, all } = lobby();
  room.start(host.id);
  const before = all.map((p) => p.character);
  const turnId = room.turn.id;
  throwsCode(() => room.start(host.id), 'ALREADY_STARTED');
  assert.deepEqual(all.map((p) => p.character), before);
  assert.equal(room.turn.id, turnId);
  room.destroy();
});

// ---------------------------------------------------------------- visibilidade
test('REGRA CRÍTICA: ninguém recebe o próprio personagem, nem o host; todos veem o dos outros', () => {
  const { room, host, all } = lobby({ commons: 4 });
  room.start(host.id);
  for (const p of all) {
    const view = room.viewFor(p.id);
    const self = view.players.find((x) => x.id === p.id);
    assert.equal(self.character, null);
    assert.ok(!JSON.stringify(view).includes(p.character), `o JSON de ${p.nickname} vaza o próprio personagem`);
    for (const other of view.players.filter((x) => x.id !== p.id)) assert.ok(other.character);
  }
});

test('sugestões alheias e a lista do host nunca vazam para quem não deve', () => {
  const { room, host, others } = lobby();
  const hostView = JSON.stringify(room.viewFor(host.id));
  assert.ok(!hostView.includes('Sugestao'), 'o host não pode ver as sugestões');
  assert.ok(hostView.includes('Batman')); // a própria lista, sim
  for (const p of others) {
    const view = room.viewFor(p.id);
    const json = JSON.stringify(view);
    for (const q of others.filter((x) => x !== p)) assert.ok(!json.includes(q.suggestion));
    assert.ok(json.includes(p.suggestion)); // a própria, sim
    assert.ok(!json.includes('Batman'), 'jogador comum não vê a lista do host');
    assert.equal(view.lobby.characters, null);
    assert.equal(view.lobby.ready, null);
  }
  const submitted = room.viewFor(others[0].id).players.map((p) => p.submitted);
  assert.deepEqual(submitted, [null, true, true, true]); // só o status, nunca o conteúdo
  const suggestions = others.map((p) => p.suggestion);
  room.start(host.id);
  const notDrawn = suggestions.filter((s) => s !== host.character);
  assert.equal(notDrawn.length, 2);
  for (const p of room.players) {
    const v = room.viewFor(p.id);
    const json = JSON.stringify(v);
    for (const s of notDrawn) assert.ok(!json.includes(s), 'sugestão não sorteada continua circulando');
    assert.equal(v.lobby, null);
    assert.ok(!json.includes('Batman') || v.players.some((x) => x.character === 'Batman'), 'lista do host só aparece como personagem de alguém');
  }
  room.destroy();
});

// ---------------------------------------------------------------- turnos
test('turno: 30s configurados, id crescente, apenas um turno ativo', () => {
  const { room, host } = lobby({ timings: { turnMs: 30_000 } });
  room.start(host.id);
  assert.equal(room.turn.duration, 30_000);
  assert.ok(room.turn.deadline - Date.now() <= 30_000);
  assert.equal(room.turn.step, 'action');
  assert.equal(room.turn.id, 1);
  room.destroy();
});

test('ações fora de turno, com turnId velho ou duplicadas são recusadas', () => {
  const { room, host, all } = lobby({ timings: { turnMs: 5000, resultMs: 5000 } });
  room.start(host.id);
  const current = room.byId(room.turn.playerId);
  const other = all.find((p) => p.id !== current.id);
  throwsCode(() => room.guess(other.id, 'X Y Z', room.turn.id), 'NOT_YOUR_TURN');
  throwsCode(() => room.pass(other.id, room.turn.id), 'NOT_YOUR_TURN');
  throwsCode(() => room.guess(current.id, 'X Y Z', 999), 'STALE_TURN');

  const id = room.turn.id;
  room.pass(current.id, id);
  throwsCode(() => room.pass(current.id, id), 'NOT_YOUR_TURN'); // clique duplo: a vez já mudou
  throwsCode(() => room.guess(current.id, 'abc', id), 'NOT_YOUR_TURN');
  assert.equal(room.turn.id, id + 1);
  room.destroy();
});

test('passar a vez: encerra na hora, vai para a direita e não tira vida', () => {
  const { room, host, all } = lobby({ timings: { turnMs: 5000 } });
  room.start(host.id);
  const current = room.byId(room.turn.playerId);
  const lives = current.lives;
  room.pass(current.id, room.turn.id);
  assert.equal(room.turn.playerId, all[(current.seat + 1) % 4].id);
  assert.equal(room.turn.step, 'action');
  assert.equal(current.lives, lives);
  room.destroy();
});

test('tempo esgotado passa a vez sem perder vida e sem reiniciar o relógio de ninguém', async () => {
  const { room, host, all } = lobby({ timings: { turnMs: 80 } });
  room.start(host.id);
  const first = room.byId(room.turn.playerId);
  const deadline = room.turn.deadline;
  await sleep(40);
  assert.equal(room.turn.deadline, deadline); // ler/reconectar não mexe no relógio
  await sleep(70);
  assert.notEqual(room.turn.playerId, first.id);
  assert.equal(room.turn.playerId, all[(first.seat + 1) % 4].id);
  assert.ok(all.every((p) => p.lives === 3));
  room.destroy();
});

test('chute errado: perde 1 vida, pausa curta e a vez passa para a direita', async () => {
  const { room, host, all } = lobby({ timings: { turnMs: 5000, resultMs: 30 } });
  room.start(host.id);
  const p = room.byId(room.turn.playerId);
  const res = room.guess(p.id, 'Zzzzzzzzz Qqqqq', room.turn.id);
  assert.deepEqual([res.correct, res.eliminated, res.livesLeft], [false, false, 2]);
  assert.equal(room.turn.step, 'result');
  throwsCode(() => room.pass(p.id), 'STALE_TURN'); // nada de agir durante a pausa
  await sleep(60);
  assert.equal(room.turn.playerId, all[(p.seat + 1) % 4].id);
  assert.equal(room.turn.step, 'action');
  room.destroy();
});

test('eliminação: zero vidas revela o personagem ao próprio jogador e ele sai da sequência', async () => {
  const { room, host, all } = lobby({ timings: { turnMs: 5000, resultMs: 20 } });
  room.start(host.id);
  const p = room.byId(room.turn.playerId);
  p.lives = 1;
  const res = room.guess(p.id, 'Errado Errado', room.turn.id);
  assert.equal(res.eliminated, true);
  const self = room.viewFor(p.id).players.find((x) => x.id === p.id);
  assert.equal(self.eliminated, true);
  assert.equal(self.character, p.character);
  await sleep(50);
  for (let i = 0; i < 12; i++) {
    assert.notEqual(room.turn.playerId, p.id, 'eliminado recebeu turno');
    room.pass(room.turn.playerId, room.turn.id);
  }
  room.destroy();
});

test('acertar (com acento, caixa e erro de digitação) vence e revela todos', () => {
  // nomes longos: nomes de até 4 letras exigem acerto exato (regra do chute tolerante)
  const { room, host, all } = lobby({ characters: ['Homem-Aranha', 'Albert Einstein', 'Darth Vader', 'Harry Potter', 'Capitão América'], timings: { turnMs: 5000 } });
  room.start(host.id);
  const p = room.byId(room.turn.playerId);
  const typo = p.character.slice(0, -1) + 'x';
  const res = room.guess(p.id, typo.toUpperCase(), room.turn.id);
  assert.equal(res.correct, true);
  assert.equal(room.phase, 'finished');
  assert.equal(room.result.winnerId, p.id);
  assert.equal(room.turn, null);
  for (const viewer of all) assert.ok(room.viewFor(viewer.id).players.every((x) => x.character));
  room.destroy();
});

test('todos eliminados: partida termina sem vencedor', () => {
  const { room, host, all } = lobby({ commons: 1, timings: { turnMs: 5000 } });
  room.start(host.id);
  all.forEach((p) => (p.eliminated = true));
  room.passTurn();
  assert.equal(room.phase, 'finished');
  assert.equal(room.result.winnerId, null);
});

test('jogador desconectado é pulado quando há alguém online; ao sair em jogo vira eliminado', () => {
  const { room, host, all } = lobby({ commons: 3, timings: { turnMs: 5000 } });
  room.start(host.id);
  const cur = room.byId(room.turn.playerId);
  const right = all[(cur.seat + 1) % 4];
  room.disconnect(right.socketId);
  room.pass(cur.id, room.turn.id);
  assert.equal(room.turn.playerId, all[(cur.seat + 2) % 4].id);

  const t = room.byId(room.turn.playerId);
  if (!t.isHost) {
    room.leave(t.id);
    assert.equal(room.byId(t.id).eliminated, true);
    assert.notEqual(room.turn.playerId, t.id);
  }
  room.destroy();
});

test('eventos têm id sequencial (o cliente toca cada som uma única vez)', () => {
  const events = [];
  const { room, host } = lobby({ timings: { turnMs: 5000, resultMs: 5000 } });
  room.onEvent = (e) => events.push(e);
  room.start(host.id);
  const p = room.byId(room.turn.playerId);
  room.guess(p.id, 'Errado Errado', room.turn.id);
  assert.deepEqual(events.map((e) => e.type), ['game-start', 'wrong-guess']);
  assert.deepEqual(events.map((e) => e.id), [1, 2]);
  room.destroy();
});

test('reset volta ao lobby: personagens limpos e cada jogador precisa sugerir de novo', () => {
  const { room, host, all } = lobby({ timings: { turnMs: 5000 } });
  room.start(host.id);
  room.reset(host.id);
  assert.equal(room.phase, 'lobby');
  assert.ok(all.every((p) => p.character === null && !p.eliminated && p.suggestion === null));
  assert.equal(room.readiness().ok, false);
  room.destroy();
});

// ---------------------------------------------------------------- bots
test('bots: só o host adiciona/remove, só no lobby, e respeita o limite da sala', () => {
  const { room, host, others } = lobby({ commons: 1 });
  throwsCode(() => room.addBot(others[0].id), 'NOT_HOST');
  const bot = room.addBot(host.id);
  assert.equal(bot.bot, true);
  assert.equal(room.players.length, 3);
  throwsCode(() => room.removeBot(others[0].id, bot.id), 'NOT_HOST');
  throwsCode(() => room.removeBot(host.id, others[0].id), 'INVALID'); // humano não é bot
  room.removeBot(host.id, bot.id);
  assert.equal(room.players.length, 2);
  while (room.players.length < 10) room.addBot(host.id);
  throwsCode(() => room.addBot(host.id), 'ROOM_FULL');
  assert.equal(new Set(room.players.map((p) => p.nickname)).size, 10); // nomes únicos
  room.players.filter((p) => p.bot).forEach((b) => room.removeBot(host.id, b.id));
  assert.deepEqual(room.players.map((p) => p.seat), [0, 1]); // assentos reordenados
  room.setCharacters(host.id, LIST);
  room.start(host.id);
  throwsCode(() => room.addBot(host.id), 'NOT_LOBBY');
  room.close('x');
});

test('bots: não exigem sugestão, mas ganham personagem da lista do host', () => {
  const { room, host } = lobby({ commons: 1 });
  room.addBot(host.id);
  room.addBot(host.id);
  const r = room.readiness();
  assert.equal(r.ok, true, r.missing.join(' ')); // 1 humano sugeriu; bots não precisam
  room.start(host.id);
  const chars = room.players.map((p) => p.character);
  assert.ok(chars.every(Boolean));
  assert.equal(new Set(chars).size, chars.length); // sem repetição
  room.close('x');
});

test('bots: só com bots, o host recebe um personagem da própria lista (precisa de um a mais)', () => {
  const room = new Room('BOTS', { timings: { turnMs: 500, botThinkMs: [5, 10] } });
  const host = room.createHost('s', 'Hosty');
  room.addBot(host.id);
  room.addBot(host.id);
  room.setCharacters(host.id, ['A1 Um', 'B2 Dois']);
  assert.equal(room.readiness().ok, false);
  assert.equal(room.readiness().needed, 3);
  room.setCharacters(host.id, ['A1 Um', 'B2 Dois', 'C3 Tres']);
  assert.equal(room.readiness().ok, true);
  room.start(host.id);
  assert.equal(new Set(room.players.map((p) => p.character)).size, 3);
  room.close('x');
});

test('bots: a visão marca quem é bot e nunca revela o personagem de um jogador a ele mesmo', () => {
  const { room, host, others } = lobby({ commons: 1 });
  room.addBot(host.id);
  const lobbyView = room.viewFor(host.id);
  const b = lobbyView.players.find((p) => p.bot);
  assert.equal(b.submitted, null);
  assert.equal(b.connected, true);
  room.start(host.id);
  const v = room.viewFor(others[0].id);
  assert.equal(v.players.find((p) => p.id === others[0].id).character, null);
  assert.ok(v.players.find((p) => p.bot).character); // humanos veem o do bot
  room.close('x');
});

test('bots: jogam sozinhos pelas mesmas regras e a partida termina', async () => {
  const room = new Room('BOTP', { timings: { turnMs: 2000, resultMs: 5, botThinkMs: [2, 6] } });
  const host = room.createHost('s', 'Hosty');
  for (let i = 0; i < 3; i++) room.addBot(host.id);
  room.setCharacters(host.id, ['Alfa Um', 'Beta Dois', 'Gama Tres', 'Delta Quatro']);
  room.setSettings(host.id, { lives: 2 });
  const events = [];
  room.onEvent = (e) => events.push(e);
  // o host humano fica passivo; os bots jogam nos turnos deles
  room.start(host.id);
  const t0 = Date.now();
  while (room.phase === 'playing' && Date.now() - t0 < 4000) {
    if (room.turn?.playerId === host.id && room.turn.step === 'action') room.pass(host.id, room.turn.id);
    await sleep(5);
  }
  assert.notEqual(room.phase, 'playing', 'a partida deveria ter terminado');
  assert.ok(events.some((e) => e.type === 'game-end'));
  room.players.forEach((p) => assert.ok(p.lives >= 0 && p.lives <= 2));
  room.close('x');
});

test('bots: ficam no lobby depois de "nova partida" e perdem o personagem', () => {
  const { room, host } = lobby({ commons: 1 });
  room.addBot(host.id);
  room.start(host.id);
  room.reset(host.id);
  assert.equal(room.phase, 'lobby');
  const bot = room.players.find((p) => p.bot);
  assert.ok(bot);
  assert.equal(bot.character, null);
  room.close('x');
});

test('bots: token vazio não reconecta ninguém (bots não têm sessão)', () => {
  const { room, host } = lobby({ commons: 1 });
  room.addBot(host.id);
  throwsCode(() => room.rejoin(null, 'sx'), 'SESSION_EXPIRED');
  throwsCode(() => room.rejoin(undefined, 'sx'), 'SESSION_EXPIRED');
  room.close('x');
});

test('gameNo: sobe a cada partida iniciada (o cliente zera a caderneta com ele)', () => {
  const { room, host } = lobby({ commons: 1 });
  assert.equal(room.viewFor(host.id).gameNo, 0);
  room.start(host.id);
  assert.equal(room.viewFor(host.id).gameNo, 1);
  room.reset(host.id);
  room.suggest(room.players[1].id, 'Alguem Novo');
  room.start(host.id);
  assert.equal(room.viewFor(host.id).gameNo, 2);
  room.close('x');
});
