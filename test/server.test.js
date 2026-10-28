'use strict';

// 서버 시험: 보안·안정성 회귀 + 할리갈리 온라인 대국 흐름 (2명 빠른 대전, 2~4명 방, 벨 경쟁)
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), FLIP_MS: '130', RING_PAUSE_MS: '250', MATCH_MS: '5000' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = (name) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, name, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => { if (name) ws.send(JSON.stringify({ t: 'hello', name })); resolve(c); });
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());

// 두 손님을 빠른 대전으로 맺어 준다 (바로 시작)
async function pair() {
  const a = await open('가'), b = await open('나');
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'quick match starts at once');
  return [a, b];
}
// 방 만들기 → n 명이 모여 방장이 시작
async function lobby(n) {
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(await open('p' + i));
  send(cs[0], 'create');
  assert.ok(await until(() => cs[0].room && cs[0].room.code));
  for (let i = 1; i < n; i++) { send(cs[i], 'join', { code: cs[0].room.code }); }
  assert.ok(await until(() => cs.every((c) => c.room && c.room.players.length === n)));
  return cs;
}
async function startRoom(n) {
  const cs = await lobby(n);
  send(cs[0], 'start');
  assert.ok(await until(() => cs.every((c) => c.room.state === 'playing')), 'host start');
  return cs;
}
// 내가 받은 알림만으로 규칙 함수가 읽는 판을 만든다 (남의 손은 장수만 아니까 빈 자리로 채운다)
const viewOf = (room) => ({
  n: room.players.length, hands: room.players.map((p, i) => (i === room.you ? room.myHand.slice() : new Array(p.count).fill(0))),
  top: room.top, suit: room.suit, stack: room.stack, turn: room.turn, dir: room.dir, alive: room.players.map((p) => p.alive), winner: room.state === 'over' ? room.winner : -1,
  draw: new Array(room.drawLeft).fill(0), discard: [room.top], rand: Math.random,
});
const onTurn = (cs) => cs.find((c) => c.room.turn === c.room.you);

// 봇이 한 번 둔다 (규칙 함수가 고른 대로 서버에 보낸다)
async function botStep(cs) {
  const m = onTurn(cs), seq = m.room.event ? m.room.event.seq : 0;
  const a = L.aiPick(viewOf(m.room), m.room.you, 'hard', Math.random);
  if (a.type === 'draw') send(m, 'draw'); else send(m, 'play', { card: a.card, suit: a.suit, one: a.one });
  await until(() => cs.every((c) => (c.room.event && c.room.event.seq > seq) || c.room.state === 'over'), 3000);
}
async function playOut(cs, max = 400) {
  let n = 0;
  while (cs[0].room.state === 'playing' && n++ < max) await botStep(cs);
  await until(() => cs.every((c) => c.room.state === 'over'), 2000);
  return n;
}

const fruitOf = (c) => c >> 3, countOf = (c) => c & 7;
// 받은 알림의 열린 더미 맨 위 카드로 지금 5개인 과일이 있는지 본다
const bellNow = (room) => { const t = [0, 0, 0, 0]; for (const p of room.players) if (p.alive && p.top >= 0) t[fruitOf(p.top)] += countOf(p.top); return t.some((x) => x === 5); };

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match deals 28 cards each and shows only open piles and counts', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.players.length, 2);
  assert.ok(a.room.players.every((p) => p.down + p.up === 28 || p.down + p.up === 27));
  assert.ok(!('myHand' in a.room) && !JSON.stringify(a.room).includes('down":['), 'face-down cards are never sent');
  closeAll(a, b);
});

test('cards are flipped automatically one at a time in turn order', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.flips >= 4, 3000), 'flips keep coming');
  assert.ok(await until(() => a.room.players.every((p) => p.up >= 1), 3000));
  assert.deepStrictEqual(a.room.players.map((p) => p.up + p.down), b.room.players.map((p) => p.up + p.down));
  closeAll(a, b);
});

test('the player whose turn it is can flip at once, nobody else can, and the auto timer still works', async () => {
  // 따로 느린 서버(카드가 3초에 한 장 저절로 나감)를 띄워서, 누르는 즉시 나가는지 본다
  const port = freePort();
  const slow = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), FLIP_MS: '3000', RING_PAUSE_MS: '250', MATCH_MS: '20000' }, stdio: 'ignore' });
  const ws2 = [];
  try {
    for (let i = 0; i < 80; i++) { try { await new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (x) => { x.resume(); x.on('end', res); }); r.on('error', rej); r.end(); }); break; } catch { await sleep(100); } }
    const mk = (name) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const c = { ws, room: null, queued: false };
      ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'room') c.room = m; if (m.t === 'queued') c.queued = true; });
      ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name: name })); ws2.push(ws); resolve(c); });
    });
    const a = await mk('가'), b = await mk('나');
    send(a, 'quick'); await until(() => a.queued); send(b, 'quick');
    assert.ok(await until(() => a.room && b.room && a.room.state === 'playing'));
    const cs = [a, b];
    const mover = cs.find((c) => c.room.turn === c.room.you), other = cs.find((c) => c !== mover);
    const f0 = mover.room.flips;
    send(other, 'flip'); await sleep(250);
    assert.strictEqual(mover.room.flips, f0, 'a flip from the wrong player is ignored');
    const t0 = Date.now();
    send(mover, 'flip');
    assert.ok(await until(() => mover.room.flips === f0 + 1, 1500), 'the mover flips at once');
    assert.ok(Date.now() - t0 < 1000, 'much sooner than the 3s auto timer');
    assert.strictEqual(other.room.flips, f0 + 1);
    assert.notStrictEqual(mover.room.turn, mover.room.you, 'the turn passes on');
    send(mover, 'flip'); await sleep(250);
    assert.strictEqual(mover.room.flips, f0 + 1, 'flipping again out of turn does nothing');
    assert.ok(await until(() => mover.room.flips >= f0 + 2, 4500), 'the next card still comes out by itself after the time limit');
  } finally { ws2.forEach((w) => w.close()); slow.kill(); }
});

test('a wrong bell costs a card and a short lock, and cards are conserved', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.flips >= 1));
  // 5개가 아닌 순간을 골라 누른다
  let tries = 0;
  while (bellNow(a.room) && tries++ < 50) await sleep(30);
  const before = a.room.players[a.room.you].down + a.room.players[a.room.you].up;
  send(a, 'bell');
  assert.ok(await until(() => a.room.ringEv && !a.room.ringEv.ok, 1500), 'a wrong ring is reported');
  assert.strictEqual(a.room.ringEv.who, a.room.you);
  assert.strictEqual(a.room.ringEv.paid, 1);
  const after = a.room.players[a.room.you].down + a.room.players[a.room.you].up;
  assert.ok(after <= before - 0, 'I paid');
  const seq = a.room.ringEv.seq;
  send(a, 'bell');                                           // 잠긴 동안은 무시된다
  await sleep(150);
  assert.strictEqual(a.room.ringEv.seq, seq);
  const sum = a.room.players.reduce((x, p) => x + p.down + p.up, 0);
  assert.ok(sum === 56 || sum === 54 || sum === 55 || sum === 56, 'no cards vanish');
  closeAll(a, b);
});

test('the first correct bell wins the open cards', async () => {
  await ready;
  const [a, b] = await pair();
  let won = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && !won) {
    if (bellNow(a.room)) { send(a, 'bell'); send(b, 'bell'); await until(() => a.room.ringEv && a.room.ringEv.ok, 1000); if (a.room.ringEv && a.room.ringEv.ok) won = a.room.ringEv; }
    await sleep(10);
  }
  assert.ok(won, 'a 5 shows up within a few seconds and somebody wins it');
  assert.ok(won.gained >= 2);
  const winner = won.who;
  assert.ok(await until(() => b.room.ringEv && b.room.ringEv.seq === won.seq));
  assert.strictEqual(b.room.ringEv.who, winner, 'both players see the same winner');
  closeAll(a, b);
});

test('a late bell right after a correct one is ignored without a penalty', async () => {
  await ready;
  const [a, b] = await pair();
  const t0 = Date.now(); let done = false;
  while (Date.now() - t0 < 25000 && !done) {
    if (bellNow(a.room)) {
      send(a, 'bell');
      await until(() => a.room.ringEv && a.room.ringEv.ok, 1000);
      const win = a.room.ringEv && a.room.ringEv.ok ? a.room.ringEv : null;
      if (win) {
        const loser = win.who === a.room.you ? b : a;
        const before = loser.room.players[loser.room.you].down + loser.room.players[loser.room.you].up;
        send(loser, 'bell');
        await sleep(200);
        const after = loser.room.players[loser.room.you].down + loser.room.players[loser.room.you].up;
        assert.strictEqual(after, before, 'the late bell cost nothing');
        assert.strictEqual(loser.room.ringEv.seq, win.seq, 'and it was not counted');
        done = true;
      }
    }
    await sleep(10);
  }
  assert.ok(done);
  closeAll(a, b);
});

test('garbage messages are ignored and the server survives', async () => {
  await ready;
  const [a, b] = await pair();
  a.ws.send('not json'); a.ws.send('{"t":"bell"'); a.ws.send(JSON.stringify({ t: 'nope' })); a.ws.send(JSON.stringify({ t: 'bell', x: [1, 2] }));
  await sleep(200);
  assert.strictEqual(a.closed, null);
  assert.strictEqual(await get('/'), 200);
  closeAll(a, b);
});

test('the time limit ends the game and the one with the most cards wins or it is a draw', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 9000), 'the match timer fires');
  assert.ok(['time', 'last'].includes(a.room.reason));
  assert.ok([0, 1, L.DRAW].includes(a.room.winner));
  closeAll(a, b);
});

test('a four player room: only the host starts it, five is too many, no joining after the start', async () => {
  await ready;
  const cs = await lobby(4);
  const late = await open('늦게');
  send(late, 'join', { code: cs[0].room.code });
  assert.ok(await until(() => late.errors.length > 0));
  assert.match(late.errors[0], /가득/);
  send(cs[1], 'start');
  await sleep(150);
  assert.strictEqual(cs[0].room.state, 'waiting');
  send(cs[0], 'start');
  assert.ok(await until(() => cs.every((c) => c.room.state === 'playing')));
  assert.ok(cs[0].room.players.every((p) => p.down + p.up === 14));
  send(late, 'join', { code: cs[0].room.code });
  assert.ok(await until(() => late.errors.length > 1));
  assert.match(late.errors[1], /이미 시작/);
  closeAll(late, ...cs);
});

test('a room needs two players to start', async () => {
  await ready;
  const a = await open('혼자');
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  send(a, 'start');
  await sleep(150);
  assert.strictEqual(a.room.state, 'waiting');
  closeAll(a);
});

test('in a three player game a resigning player drops out and the others play on', async () => {
  await ready;
  const cs = await lobby(3);
  send(cs[0], 'start');
  assert.ok(await until(() => cs.every((c) => c.room.state === 'playing')));
  send(cs[2], 'resign');
  assert.ok(await until(() => cs[0].room.players[2].alive === false));
  assert.strictEqual(cs[0].room.state, 'playing');
  const sum = cs[0].room.players.reduce((x, p) => x + p.down + p.up, 0);
  assert.strictEqual(sum, 54, 'the resigned cards went to the others');
  closeAll(...cs);
});

test('in a two player game resigning ends it at once', async () => {
  await ready;
  const [a, b] = await pair();
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.winner, b.room.you);
  closeAll(a, b);
});

test('rematch needs everyone and starts a fresh game', async () => {
  await ready;
  const [a, b] = await pair();
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  send(a, 'rematch');
  await sleep(150);
  assert.strictEqual(a.room.state, 'over');
  send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.strictEqual(a.room.ringEv, null);
  closeAll(a, b);
});

test('a dropped player can resume the same seat', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open('가');
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  closeAll(a2, b);
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  closeAll(c);
});

test('shutdown', () => { child.kill(); });
