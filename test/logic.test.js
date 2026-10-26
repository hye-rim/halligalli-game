'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const set = (st, who, ups, downs) => { st.up[who] = ups; st.down[who] = downs; };
const card = (f, n) => f * 8 + n;

test('deck has 56 cards, 14 per fruit with the right counts', () => {
  const d = L.buildDeck();
  assert.strictEqual(d.length, 56);
  for (let f = 0; f < 4; f++) {
    const mine = d.filter((c) => L.fruitOf(c) === f);
    assert.strictEqual(mine.length, 14);
    for (const [n, k] of [[1, 5], [2, 3], [3, 3], [4, 2], [5, 1]]) assert.strictEqual(mine.filter((c) => L.countOf(c) === n).length, k);
  }
});

test('cards are dealt evenly and leftovers are dropped', () => {
  for (const n of [2, 3, 4]) {
    const st = L.newGame({ players: n, seed: 3 });
    const per = Math.floor(56 / n);
    assert.ok(st.down.every((x) => x.length === per));
    assert.ok(st.up.every((x) => x.length === 0));
  }
});

test('flipping moves the top of your pile to your open pile and passes the turn', () => {
  const st = L.newGame({ players: 3, seed: 1, first: 1 });
  const top = st.down[1][st.down[1].length - 1];
  const r = L.flipNext(st);
  assert.strictEqual(r.who, 1);
  assert.strictEqual(st.up[1][0], top);
  assert.strictEqual(st.turn, 2);
  assert.strictEqual(st.down[1].length, 17);
});

test('totals add up only the top cards of open piles', () => {
  const st = L.newGame({ players: 2, seed: 1 });
  set(st, 0, [card(0, 4), card(1, 2)], st.down[0]);
  set(st, 1, [card(3, 1), card(1, 3)], st.down[1]);
  assert.deepStrictEqual(L.totals(st), [0, 5, 0, 0]);
  assert.strictEqual(L.isBell(st), true);
  assert.strictEqual(L.bellFruit(st), 1);
});

test('six of a fruit or four of a fruit is not a bell', () => {
  const st = L.newGame({ players: 2, seed: 1 });
  set(st, 0, [card(2, 3)], st.down[0]); set(st, 1, [card(2, 3)], st.down[1]);
  assert.strictEqual(L.isBell(st), false);
  set(st, 1, [card(2, 1)], st.down[1]);
  assert.strictEqual(L.isBell(st), false);                    // 4
});

test('a correct ring collects every open card under your pile and you flip next', () => {
  const st = L.newGame({ players: 3, seed: 1 });
  set(st, 0, [card(0, 1), card(1, 2)], st.down[0].slice());
  set(st, 1, [card(3, 2), card(1, 3)], st.down[1].slice());
  set(st, 2, [card(2, 1)], st.down[2].slice());
  const before = st.down[2].length;
  const r = L.ring(st, 2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.gained, 5);
  assert.strictEqual(st.down[2].length, before + 5);
  assert.ok(st.up.every((u) => u.length === 0));
  assert.strictEqual(st.turn, 2);
  assert.strictEqual(L.isBell(st), false);
});

test('a wrong ring pays one card to every other player', () => {
  const st = L.newGame({ players: 4, seed: 2 });
  set(st, 0, [card(0, 1)], st.down[0].slice());
  const mine = st.down[0].length, others = st.down.slice(1).map((d) => d.length);
  const r = L.ring(st, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.paid, 3);
  assert.strictEqual(st.down[0].length, mine - 3);
  st.down.slice(1).forEach((d, i) => assert.strictEqual(d.length, others[i] + 1));
});

test('an empty pile is refilled from the open pile and then the player is out', () => {
  const st = L.newGame({ players: 2, seed: 1, first: 0 });
  set(st, 0, [card(0, 1), card(1, 1)], []);
  const r = L.flipNext(st);
  assert.strictEqual(r.who, 0);
  assert.strictEqual(st.up[0].length, 1);                    // 뒤집어서 한 장 넘김
  assert.strictEqual(st.down[0].length, 1);
  set(st, 0, [], []);
  st.turn = 0;
  L.flipNext(st);
  assert.strictEqual(st.alive[0], false);
  assert.strictEqual(st.winner, 1);
  assert.strictEqual(st.reason, 'last');
});

test('a player who runs out of cards by paying is eliminated', () => {
  const st = L.newGame({ players: 2, seed: 1 });
  set(st, 0, [], [card(0, 1)]);
  L.ring(st, 0);                                             // 틀린 벨: 한 장을 물어 주면 카드가 없다
  assert.strictEqual(st.alive[0], false);
  assert.strictEqual(st.winner, 1);
});

test('total card count never changes in random games', () => {
  for (let seed = 1; seed <= 150; seed++) for (const n of [2, 3, 4]) {
    const st = L.newGame({ players: n, seed });
    const r = L.rng(seed + 9);
    const start = st.down.flat().length;
    for (let k = 0; k < 3000 && st.winner < 0; k++) {
      L.flipNext(st);
      if (r() < 0.15) L.ring(st, Math.floor(r() * n));
      assert.strictEqual(st.down.flat().length + st.up.flat().length, start);
    }
  }
});

test('eliminating a player gives their cards to the others', () => {
  const st = L.newGame({ players: 3, seed: 4 });
  const sum = st.down.flat().length;
  L.eliminate(st, 1, 'resign');
  assert.strictEqual(st.alive[1], false);
  assert.strictEqual(st.down[1].length + st.up[1].length, 0);
  assert.strictEqual(st.down.flat().length + st.up.flat().length, sum);
  assert.strictEqual(st.winner, -1);
  L.eliminate(st, 2, 'left');
  assert.strictEqual(st.winner, 0);
});

test('time up: most cards wins and equal cards is a draw', () => {
  const st = L.newGame({ players: 2, seed: 1 });
  set(st, 0, [], new Array(30).fill(card(0, 1)));
  set(st, 1, [], new Array(26).fill(card(1, 1)));
  assert.strictEqual(L.finishByTime(st), 0);
  const eq = L.newGame({ players: 2, seed: 1 });
  set(eq, 0, [], new Array(28).fill(1)); set(eq, 1, [], new Array(28).fill(1));
  assert.strictEqual(L.finishByTime(eq), L.DRAW);
});

test('same seed and actions give the same game', () => {
  const play = () => {
    const st = L.newGame({ players: 3, seed: 8 });
    const r = L.rng(2);
    for (let k = 0; k < 200 && st.winner < 0; k++) { L.flipNext(st); if (r() < 0.2) L.ring(st, Math.floor(r() * 3)); }
    return JSON.stringify([st.down, st.up, st.alive, st.winner]);
  };
  assert.strictEqual(play(), play());
});

test('computer reaction times are ordered and bounded', () => {
  const r = L.rng(1);
  let easy = 0, hard = 0;
  for (let i = 0; i < 200; i++) { const e = L.aiReaction('easy', r), h = L.aiReaction('hard', r); assert.ok(e >= 1300 && e <= 2600 && h >= 520 && h <= 980); easy += e; hard += h; }
  assert.ok(easy > hard * 1.5);
});
