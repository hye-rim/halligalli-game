'use strict';

// 할리갈리: 규칙만 모아 둔 파일 (그리기·입력·시간 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 카드 56장: 과일 4가지(🍌 바나나 · 🍓 딸기 · 🍇 자두 · 🍏 라임) x 14장. 한 장에 같은 과일이 1~5개 그려져 있다 (1개 5장, 2개 3장, 3개 3장, 4개 2장, 5개 1장)
// - 2~4명이 카드를 똑같이 나눠 갖는다(남는 카드는 뺀다). 차례가 오면 내 더미의 맨 위 카드를 뒤집어 내 앞 열린 더미에 올린다 (서버·컴퓨터가 일정한 간격으로 대신 넘겨 준다)
// - 모두의 열린 더미 맨 위 카드를 합쳐서 **같은 과일이 정확히 5개**가 되면 가장 먼저 벨을 누른 사람이 열린 카드를 전부 가져간다. 가져온 카드는 내 더미 맨 아래에 깔고, 다음 카드는 내가 넘긴다
// - 5개가 아닌데 벨을 누르면 다른 사람 한 명마다 카드 한 장씩(내 더미 맨 위에서) 물어 준다
// - 내 더미가 비면 열린 더미를 뒤집어 다시 쓰고, 열린 더미도 비면 탈락. 마지막까지 남은 사람이 이긴다 (시간이 다 되면 카드가 가장 많은 사람)
const LOGIC_HALLI = (() => {
const FRUITS = 4;
const DRAW = 9;                                               // winner 가 이 값이면 무승부
const COUNTS = [[1, 5], [2, 3], [3, 3], [4, 2], [5, 1]];     // [개수, 장수] — 과일 하나당 14장
const CARD_LIMIT = FRUITS * 14;
const fruitOf = (c) => c >> 3, countOf = (c) => c & 7;        // 카드 번호 = 과일*8 + 개수

function rng(seed) {                                          // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function buildDeck() { const d = []; for (let f = 0; f < FRUITS; f++) for (const [n, k] of COUNTS) for (let i = 0; i < k; i++) d.push(f * 8 + n); return d; }

function newGame(opts = {}) {
  const n = Math.max(2, Math.min(4, opts.players || 2));
  const rand = opts.rand || rng(opts.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : opts.seed);
  const deck = shuffle(buildDeck(), rand);
  const per = Math.floor(deck.length / n);
  const down = Array.from({ length: n }, (_, i) => deck.slice(i * per, (i + 1) * per));
  return { n, down, up: Array.from({ length: n }, () => []), alive: new Array(n).fill(true), turn: opts.first || 0, winner: -1, reason: '', flips: 0, rand, events: [] };
}

const total = (st, who) => st.down[who].length + st.up[who].length;
const aliveIds = (st) => st.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);

// 누군가 카드가 없어졌으면 탈락시키고, 한 명만 남았으면 승부를 낸다
function settle(st) {
  for (let i = 0; i < st.n; i++) if (st.alive[i] && total(st, i) === 0) { st.alive[i] = false; st.events.push({ type: 'out', who: i }); }
  const left = aliveIds(st);
  if (left.length === 1 && st.winner < 0) { st.winner = left[0]; st.reason = 'last'; }
}

// 모두의 열린 더미 맨 위 카드 (없으면 -1)
const tops = (st) => st.up.map((u, i) => (st.alive[i] && u.length ? u[u.length - 1] : -1));
function totals(st) {                                            // 과일별로 보이는 개수의 합
  const t = new Array(FRUITS).fill(0);
  for (const c of tops(st)) if (c >= 0) t[fruitOf(c)] += countOf(c);
  return t;
}
const isBell = (st) => st.winner < 0 && totals(st).some((t) => t === 5);
const bellFruit = (st) => totals(st).findIndex((t) => t === 5);

// 차례인 사람이 카드를 한 장 넘긴다. 내 더미가 비었으면 열린 더미를 뒤집어 쓴다
function flipNext(st) {
  if (st.winner >= 0) return null;
  let guard = 0;
  while (guard++ <= st.n && !st.alive[st.turn]) st.turn = (st.turn + 1) % st.n;
  const who = st.turn;
  if (!st.down[who].length && st.up[who].length) { st.down[who] = st.up[who].reverse(); st.up[who] = []; st.events.push({ type: 'reflip', who }); }
  if (!st.down[who].length) { settle(st); return null; }
  const card = st.down[who].pop();
  st.up[who].push(card);
  st.flips++;
  st.events.push({ type: 'flip', who, card });
  do { st.turn = (st.turn + 1) % st.n; } while (!st.alive[st.turn]);
  return { who, card };
}

// 벨 누르기. 맞으면 열린 카드를 모두 가져가고 { ok: true, gained, fruit }, 틀리면 다른 사람에게 한 장씩 { ok: false, paid }
function ring(st, who) {
  if (st.winner >= 0 || !st.alive[who]) return null;
  if (isBell(st)) {
    const fruit = bellFruit(st);
    const pot = [];
    for (let i = 0; i < st.n; i++) { pot.push(...st.up[i]); st.up[i] = []; }
    shuffle(pot, st.rand);
    st.down[who].unshift(...pot);                                 // 내 더미 맨 아래에 깐다 (맨 위는 끝)
    st.turn = who;
    st.events.push({ type: 'ring', who, ok: true, gained: pot.length, fruit });
    settle(st);
    return { ok: true, gained: pot.length, fruit };
  }
  let paid = 0;
  for (const o of aliveIds(st)) {
    if (o === who) continue;
    let c;
    if (st.down[who].length) c = st.down[who].pop();
    else if (st.up[who].length) c = st.up[who].shift();           // 더미가 비었으면 열린 더미 맨 아래부터
    else break;
    st.down[o].unshift(c);
    paid++;
  }
  st.events.push({ type: 'ring', who, ok: false, paid });
  settle(st);
  return { ok: false, paid };
}

// 시간이 다 됐을 때: 카드가 가장 많은 사람이 이기고, 가장 많은 장수가 같으면 무승부(winner 가 DRAW)
function finishByTime(st) {
  if (st.winner >= 0) return st.winner;
  let best = -1, bi = -1, tie = false;
  for (const i of aliveIds(st)) { const t = total(st, i); if (t > best) { best = t; bi = i; tie = false; } else if (t === best) tie = true; }
  st.winner = tie ? DRAW : bi; st.reason = 'time';
  return st.winner;
}

// 사람이 탈락하거나 나갔을 때 (기권·연결 끊김): 그 사람의 카드는 남은 사람들에게 돌려 나눈다
function eliminate(st, who, reason = 'resign') {
  if (!st.alive[who]) return;
  st.alive[who] = false;
  const cards = [...st.down[who], ...st.up[who]];
  st.down[who] = []; st.up[who] = [];
  const left = aliveIds(st);
  if (left.length) cards.forEach((c, i) => st.down[left[i % left.length]].unshift(c));
  st.events.push({ type: 'out', who, reason });
  settle(st);
}

// ---------- 컴퓨터 ----------
// 5개가 되었을 때 벨을 누르는 데 걸리는 시간(ms). 어려움이 빠르다
const LEVELS = { easy: { min: 1300, max: 2600, slip: 0.04 }, hard: { min: 520, max: 980, slip: 0.008 } };
function aiReaction(level, rand = Math.random) { const lv = LEVELS[level] || LEVELS.hard; return lv.min + rand() * (lv.max - lv.min); }
function aiSlip(level, rand = Math.random) { return rand() < (LEVELS[level] || LEVELS.hard).slip; }   // 5개가 아닌데 잘못 누를지

return { FRUITS, DRAW, CARD_LIMIT, LEVELS, fruitOf, countOf, rng, buildDeck, newGame, total, tops, totals, isBell, bellFruit, flipNext, ring, settle, finishByTime, eliminate, aiReaction, aiSlip, aliveIds };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_HALLI;
