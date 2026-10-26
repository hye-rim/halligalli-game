'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 할리갈리: 화면·입력·소리·온라인. 규칙과 컴퓨터 반응은 logic.js (LOGIC_HALLI), 방·매칭·자동 넘김은 server.js
(() => {
const L = LOGIC_HALLI;
const $ = (id) => document.getElementById(id);
const FRUIT = ['🍌', '🍓', '🍇', '🍏'];
const FRUIT_NAME = ['바나나', '딸기', '자두', '라임'];
const FLIP_MS = 1700, RING_PAUSE_MS = 1800, GRACE_MS = 700, LOCK_MS = 1000;     // 서버와 같은 값
const CPU_MATCH_MS = 240000;
const TUT = /[?&]tutorial=1/.test(location.search);                              // 튜토리얼: 컴퓨터가 벨을 누르지 않고 카드도 천천히 넘긴다
const T = { over: 900 };                                                          // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('halligalliWins')) || 0;
const ONLINE_KEY = 'halligalliOnline', SESSION_KEY = 'halligalliSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('halligalliName') || '';
const ga = (name) => { const c = String(name).charCodeAt(String(name).length - 1); return `${name}${c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? '이' : '가'}`; };

// ---------- 소리 ----------
let audio = null;
let muted = store.get('halligalliMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  flip: () => tone(260, 0.04, 'triangle', 0.05),
  bell: () => seq([1318, 1568, 1318], 80, 'sine', 0.12),
  mine: () => seq([784, 988, 1175, 1568], 70, 'triangle', 0.1),
  wrong: () => tone(140, 0.25, 'sawtooth', 0.07),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('halligalliMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번)
let nCpu = 2;                       // 컴퓨터 대전 인원
let room = null, netDown = false, recorded = '';
let flipTimer = 0, overTimer = 0, aiTimers = [], pauseUntil = 0, graceUntil = 0, lockUntil = 0, matchEnd = 0;
let ringInfo = null;                // 방금 벨 결과 { who, ok, gained, paid, fruit, until } (화면 표시용)
let seenRing = 0, prevUp = [], prevFlips = -1;
const online = () => mode === 'online';

// 화면에 그릴 모양
function model() {
  if (online()) {
    if (!room) return null;
    return { players: room.players.map((p, i) => ({ ...p, name: i === room.you ? '나' : p.name })), you: room.you, turn: room.turn, state: room.state, winner: room.winner, reason: room.reason };
  }
  if (!st) return null;
  return {
    players: st.down.map((d, i) => ({ name: i === 0 ? '나' : (nCpu === 2 ? '컴퓨터' : `컴퓨터${i}`), alive: st.alive[i], down: d.length, up: st.up[i].length, top: st.up[i].length ? st.up[i][st.up[i].length - 1] : -1, online: true, gone: false })),
    you: 0, turn: st.turn, state: st.winner >= 0 ? 'over' : 'playing', winner: st.winner, reason: st.reason,
  };
}

// ---------- 그리기 ----------
function cardHtml(c, cls = '') {
  if (c < 0) return `<div class="fc empty ${cls}"></div>`;
  const f = L.fruitOf(c), n = L.countOf(c);
  return `<div class="fc f${f} n${n} ${cls}"><div class="fr">${`<span>${FRUIT[f]}</span>`.repeat(n)}</div></div>`;
}
function seatHtml(p, i, m, flipped) {
  const total = p.down + p.up;
  const ri = ringInfo && ringInfo.until > performance.now() ? ringInfo : null;
  const cls = ['seat', i === m.you ? 'me' : '', p.alive ? '' : 'out', m.state === 'playing' && m.turn === i && p.alive ? 'turn' : '', ri && ri.who === i ? (ri.ok ? 'won' : 'lost') : ''].filter(Boolean).join(' ');
  const badge = ri && ri.who === i ? `<span class="gain${ri.ok ? '' : ' bad'}">${ri.ok ? `+${ri.gained}` : `-${ri.paid}`}</span>` : '';
  const off = p.online || p.gone || !p.alive ? '' : ' <small style="color:#c0392b">끊김</small>';
  return `<div class="${cls}">${badge}<div class="hd"><span class="nm">${esc(p.name)}${off}</span><span class="ct">🂠 ${p.alive ? total : 0}</span></div>${cardHtml(p.alive ? p.top : -1, flipped.has(i) ? 'flip' : '')}</div>`;
}
function render() {
  const m = model();
  if (!m) { $('seats').innerHTML = ''; $('meSeat').innerHTML = ''; renderHud(null); return; }
  const flipped = new Set();
  m.players.forEach((p, i) => { if (prevUp[i] !== undefined && p.up > prevUp[i]) flipped.add(i); });
  prevUp = m.players.map((p) => p.up);
  const opps = m.players.map((p, i) => [p, i]).filter(([, i]) => i !== m.you);
  $('seats').className = opps.length === 1 ? 'one' : opps.length === 3 ? 'three' : '';
  $('seats').innerHTML = opps.map(([p, i]) => seatHtml(p, i, m, flipped)).join('');
  $('meSeat').innerHTML = seatHtml(m.players[m.you], m.you, m, flipped);
  const bell = $('bell');
  const locked = performance.now() < lockUntil;
  bell.classList.toggle('locked', locked);
  bell.disabled = !(phase === 'play' && m.players[m.you].alive && m.state === 'playing' && !(online() && netDown));
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '할리갈리';
  if (m && phase === 'play' && m.state === 'playing') {
    const me = m.players[m.you];
    const remain = online() ? Math.max(0, Math.ceil((matchEnd - performance.now()) / 1000)) : Math.max(0, Math.ceil((matchEnd - performance.now()) / 1000));
    text = online() && netDown ? '연결 다시 붙이는 중…' : `내 카드 ${me.down + me.up}장 · ${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t, cls = '') { const el = $('msg'); el.textContent = t; el.className = cls; }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 벨 ----------
function onBell() {
  const m = model();
  if (!m || phase !== 'play' || m.state !== 'playing' || !m.players[m.you].alive) return;
  if (performance.now() < lockUntil) return;
  if (online()) { if (!netDown) net.send('bell'); return; }
  ringLocal(0);
}
$('bell').addEventListener('pointerdown', (e) => { e.preventDefault(); onBell(); });
$('bell').addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onBell(); } });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if ((e.code === 'Space' || e.code === 'Enter') && !overlayOpen() && document.activeElement === document.body) { e.preventDefault(); onBell(); }
});

// 벨 결과를 화면에 알린다 (who: 누른 사람)
function announceRing(m, ev) {
  const name = ev.who === m.you ? '내' : m.players[ev.who].name;
  const subj = ev.who === m.you ? '내가' : ga(m.players[ev.who].name);
  ringInfo = { ...ev, until: performance.now() + RING_PAUSE_MS };
  setTimeout(render, RING_PAUSE_MS + 30);
  const bellBtn = $('bell'); bellBtn.classList.add('hit'); setTimeout(() => bellBtn.classList.remove('hit'), 160);
  if (ev.ok) {
    say(`${FRUIT[ev.fruit]} ${FRUIT_NAME[ev.fruit]} 5개! ${subj} 카드 ${ev.gained}장을 가져갔어요`, ev.who === m.you ? 'good' : '');
    ev.who === m.you ? sfx.mine() : sfx.bell();
  } else {
    say(`${subj} 벨을 잘못 눌러서 카드 ${ev.paid}장을 나눠 줬어요`, ev.who === m.you ? 'bad' : '');
    sfx.wrong();
    if (ev.who === m.you) lockUntil = performance.now() + LOCK_MS;
  }
  if (ev.who === m.you) tutorialSignal(ev.ok ? 'ring' : 'wrong');
  render();
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level, n) {
  leaveOnline();
  clearTimeout(flipTimer); clearTimeout(overTimer); aiTimers.forEach(clearTimeout); aiTimers = [];
  mode = level; nCpu = n; phase = 'play';
  st = L.newGame({ players: n, first: Math.floor(Math.random() * n) });
  pauseUntil = graceUntil = lockUntil = 0; ringInfo = null; prevUp = []; prevFlips = -1;
  matchEnd = performance.now() + CPU_MATCH_MS;
  hideOverlay(); render();
  say(TUT ? '카드가 한 장씩 넘어가요.\n같은 과일이 모두 합쳐서 정확히 5개가 되면 🔔 을 눌러요!' : '같은 과일이 모두 합쳐서 정확히 5개가 되면 먼저 🔔 을 눌러요!\n(아닌데 누르면 카드를 나눠 줘요)');
  flipTimer = setTimeout(cpuFlip, 1500);
}
function cpuFlip() {
  if (phase !== 'play' || !st || online()) return;
  if (performance.now() >= matchEnd) { L.finishByTime(st); return endCpu(); }
  if (performance.now() < pauseUntil) { flipTimer = setTimeout(cpuFlip, Math.max(30, pauseUntil - performance.now())); return; }
  const r = L.flipNext(st);
  st.events.length = 0;
  if (r) sfx.flip();
  render();
  if (st.winner >= 0) return endCpu();
  aiAfterFlip();
  flipTimer = setTimeout(cpuFlip, TUT ? 2300 : FLIP_MS);
}
// 새 카드가 나온 뒤: 5개가 되었으면 컴퓨터가 반응 시간 뒤에 벨을 누르고, 가끔은 엉뚱하게 잘못 누른다
function aiAfterFlip() {
  if (TUT) return;
  const stamp = st.flips;
  const bell = L.isBell(st);
  for (let j = 1; j < st.n; j++) {
    if (!st.alive[j]) continue;
    if (bell) aiTimers.push(setTimeout(() => { if (phase === 'play' && st && st.flips === stamp && L.isBell(st)) ringLocal(j); }, L.aiReaction(mode)));
    else if (L.aiSlip(mode)) aiTimers.push(setTimeout(() => { if (phase === 'play' && st && st.flips === stamp && !L.isBell(st)) ringLocal(j); }, 400 + Math.random() * 800));
  }
}
function ringLocal(who) {
  if (phase !== 'play' || !st || st.winner >= 0) return;
  const now = performance.now();
  if (now < graceUntil && !L.isBell(st)) return;                  // 방금 누가 맞혔다: 늦은 벨은 벌 없이 무시
  const r = L.ring(st, who);
  st.events.length = 0;
  if (!r) return;
  const m = model();
  if (r.ok) { graceUntil = now + GRACE_MS; pauseUntil = now + RING_PAUSE_MS; aiTimers.forEach(clearTimeout); aiTimers = []; }
  announceRing(m, { who, ok: r.ok, gained: r.gained || 0, paid: r.paid || 0, fruit: r.fruit === undefined ? -1 : r.fruit });
  if (st.winner >= 0) endCpu();
}
function endCpu() {
  clearTimeout(flipTimer); aiTimers.forEach(clearTimeout); aiTimers = [];
  phase = 'over';
  render();
  overTimer = setTimeout(showOver, T.over + (ringInfo && ringInfo.until > performance.now() ? 600 : 0));
}
function showOver() {
  const youWon = st.winner === 0, draw = st.winner === L.DRAW;
  if (youWon) { wins++; store.set('halligalliWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  const rows = st.down.map((d, i) => `<dt>${i === 0 ? '나' : (nCpu === 2 ? '컴퓨터' : `컴퓨터${i}`)}${st.winner === i ? ' 🏆' : ''}</dt><dd>${st.alive[i] ? d.length + st.up[i].length + '장' : '빠짐'}</dd>`).join('');
  const why = st.reason === 'time' ? '시간이 끝나서 카드가 가장 많은 쪽이 이겼어요' : youWon ? '끝까지 카드를 지켰어요!' : '상대가 카드를 모두 가져갔어요';
  showOverlay(`
    <h2>${draw ? '무승부! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(why)}</p>
    <dl class="stats card2">${rows}</dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
}
function showTitle() {
  leaveOnline();
  clearTimeout(flipTimer); clearTimeout(overTimer); aiTimers.forEach(clearTimeout); aiTimers = [];
  mode = 'easy'; phase = 'title'; st = L.newGame({ players: 2 }); ringInfo = null; prevUp = []; say('');
  render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>할리갈리</h1>
    <p>같은 과일이 <b>정확히 5개</b>면 먼저 🔔!</p>
    <div class="card2" style="font-size:13px">카드가 한 장씩 넘어가요<br>모두의 맨 위 카드를 합쳐서 <b>같은 과일 5개</b>가 되면 벨을 눌러 열린 카드를 <b>다 가져가요</b><br>5개가 아닌데 누르면 한 장씩 <b>나눠 줘요</b> · 카드가 떨어지면 탈락!</div>
    <div class="col"><button data-act="cpu" data-lv="easy" data-n="2">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard" data-n="2">🤖 컴퓨터랑 · 어려움</button>
      <div class="row"><button class="sub" data-act="cpu" data-lv="easy" data-n="3">👥 3인</button><button class="sub" data-act="cpu" data-lv="easy" data-n="4">👥 4인</button></div>
      <button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else if (t !== 'bell') { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  netDown = false;
  saveSession({ code: r.code, token: r.token });
  matchEnd = performance.now() + r.remain;
  if (newGame) { seenRing = r.ringEv ? r.ringEv.seq : 0; prevUp = []; ringInfo = null; lockUntil = 0; say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say('카드가 자동으로 넘어가요.\n같은 과일이 모두 합쳐서 정확히 5개가 되면 먼저 🔔!'); }
  if (r.state !== 'over' && $('overlay').dataset.screen !== 'confirm') hideOverlay();
  if (!newGame && r.flips !== prevFlips && r.state === 'playing') sfx.flip();
  prevFlips = r.flips;
  const m = model();
  if (r.ringEv && r.ringEv.seq > seenRing) { seenRing = r.ringEv.seq; announceRing(m, r.ringEv); } else render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === L.DRAW) { rec.d = (rec.d || 0) + 1; sfx.found(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over + 700);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const draw = r.winner === L.DRAW, won = r.winner === r.you;
  const wname = r.players[r.winner] ? r.players[r.winner].name : '';
  const why = r.reason === 'time' ? (draw ? '시간이 끝났고 카드 수가 같아요' : '시간이 끝나서 카드가 가장 많은 사람이 이겼어요') : won ? '끝까지 카드를 지켰어요!' : `${ga(wname)} 끝까지 남았어요`;
  const rec = loadJson(ONLINE_KEY);
  const stay = r.players.filter((p) => !p.gone);
  const iVoted = r.rematch.includes(r.you);
  let again;
  if (stay.length < 2) again = '<p>같이 할 사람이 나갔어요</p>';
  else if (iVoted) again = `<p>다른 사람들을 기다리는 중… (${r.rematch.length}/${stay.length})</p>`;
  else again = `${r.rematch.length ? `<p>${r.rematch.length}명이 한 판 더 하고 싶어해요!</p>` : ''}<button data-act="rematch">한 판 더</button>`;
  const rows = r.players.map((p, i) => `<dt>${esc(i === r.you ? '나' : p.name)}${i === r.winner ? ' 🏆' : ''}</dt><dd>${!p.alive ? '빠짐' : p.down + p.up + '장'}</dd>`).join('');
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    <p>${esc(why)}</p>
    <dl class="stats card2">${rows}</dl>
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(flipTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; st = null; prevUp = [];
  render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전 (2명)</button>
      <button class="sub" data-act="create">방 만들기 (2~4명)</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">카드는 서버가 자동으로 넘겨요 · 벨은 먼저 누른 사람이 이겨요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  const host = room.you === 0, n = room.players.length;
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <div class="plist">${room.players.map((p, i) => `<div class="${i === room.you ? 'you' : ''}${p.online ? '' : ' off'}">${i === 0 ? '👑 ' : ''}${esc(p.name)}${i === room.you ? ' (나)' : ''}</div>`).join('')}</div>
    <p style="font-size:13px">친구가 <b>온라인 대전 → 들어가기</b>에 코드를 넣으면 들어와요 (최대 4명)</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    ${host ? `<button data-act="start"${n < 2 ? ' disabled style="opacity:.5"' : ''}>▶ 시작 (${n}명)</button>` : '<p>방장이 시작하길 기다려요</p>'}
    <button class="sub" data-act="cancel">나가기</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('halligalliName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요<br>(3~4명이면 나만 빠지고 나머지는 계속해요)</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = { lv: 'easy', n: 2 };
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = { lv: btn.dataset.lv, n: Number(btn.dataset.n) }; startCpu(lastCpu.lv, lastCpu.n); }
  else if (act === 'again') startCpu(lastCpu.lv, lastCpu.n);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'start') net.send('start');
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '할리갈리 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (phase === 'play') renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__hg = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, T, onBell, startCpu, render, ringLocal, cpuFlip };
/* @test-hooks:end */
})();
