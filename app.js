'use strict';
/* ========== ESTADO ========== */
const KEY = 'tdm2026', MAX = 22;
const READ_ONLY = new URLSearchParams(location.search).get('view') === '1';
const bb = () => ({ a: '', b: '', aw: '', bw: '', ak: '', ad: '', bk: '', bd: '', at: '', bt: '' });
const blank = () => ({ players: [], p1: Array.from({ length: 11 }, bb), pairs: Array.from({ length: 11 }, () => ({ a: '', b: '' })), slots: {}, res: {} });
let S = blank(), IMG = {}, view = 0, editId = null, pend = null, rankSort = 'stage';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const P = id => S.players.find(p => p.id === id);
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const secs = t => { const m = /^(\d{1,4}):([0-5]\d)$/.exec(String(t || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
const fmtSecs = n => n == null ? '—' : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
const intVal = v => v === '' || v == null || !/^\d+$/.test(String(v)) ? null : Number(v);
function normalizeState(s) {
  const out = Object.assign(blank(), s || {});
  out.p1 = Array.from({ length: 11 }, (_, i) => {
    const raw = out.p1?.[i] || {}, b = { ...bb(), ...raw };
    // Dados antigos guardavam um único KDA. Não é possível deduzir kills e mortes desse valor.
    if (!Object.prototype.hasOwnProperty.call(raw, 'ad') && !Object.prototype.hasOwnProperty.call(raw, 'bd')) {
      if (raw.ak !== '' && raw.ak != null) b.legacyAk = raw.ak;
      if (raw.bk !== '' && raw.bk != null) b.legacyBk = raw.bk;
      b.ak = ''; b.bk = ''; b.ad = ''; b.bd = '';
    }
    return b;
  });
  out.pairs = Array.from({ length: 11 }, (_, i) => ({ a: '', b: '', ...(out.pairs?.[i] || {}) }));
  out.slots = out.slots || {}; out.res = out.res || {};
  for (const id of Object.keys(out.res)) { const r = out.res[id] || {}; out.res[id] = { ...r, stats: r.stats || {}, duration: r.duration || '' }; }
  return out;
}

/* ========== PERSISTÊNCIA (localStorage + IndexedDB p/ fotos) ========== */
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Falha ao salvar: ' + e.message); } schedulePush(); };

/* ========== SINCRONIZAÇÃO ONLINE (Netlify Blobs) ========== */
const API = '/api/state', TOKEN_KEY = 'tdm_admin_token';
let syncReady = false, pushTimer = null, pushing = false, pushAgain = false;
const setStatus = (t, bad) => { const el = document.getElementById('sync'); if (el) { el.textContent = t; el.style.color = bad ? '#ff8080' : ''; } };
function schedulePush() { if (READ_ONLY || !syncReady) return; setStatus('☁ Salvando…'); clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 800); }
async function pushNow() {
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) { token = prompt('Senha de administrador para salvar online:'); if (!token) { setStatus('☁ Não salvo online (sem senha)', true); return; } }
    const r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ app: 'tdm2026', v: 1, state: S, imgs: IMG }) });
    if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); setStatus('☁ Senha incorreta — edite algo para tentar de novo', true); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    localStorage.setItem(TOKEN_KEY, token);
    setStatus('☁ Salvo online ' + new Date().toLocaleTimeString('pt-BR'));
  } catch (e) { setStatus('☁ Falha ao salvar online: ' + e.message, true); }
  finally { pushing = false; if (pushAgain) { pushAgain = false; pushNow(); } }
}
async function loadRemote() {
  const r = await fetch(API, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json(); // objeto salvo ou null
}
const DB = {
  open: () => new Promise((ok, no) => { const r = indexedDB.open('tdm', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }),
  async tx(m, f) { const d = await DB.open(); return new Promise((ok, no) => { const t = d.transaction('img', m); f(t.objectStore('img')); t.oncomplete = ok; t.onerror = () => no(t.error); }); },
  async all() { const o = {}, d = await DB.open(); return new Promise(ok => { const c = d.transaction('img').objectStore('img').openCursor(); c.onsuccess = () => { const x = c.result; if (x) { o[x.key] = x.value; x.continue(); } else ok(o); }; c.onerror = () => ok(o); }); },
  put: (k, v) => DB.tx('readwrite', s => s.put(v, k)),
  del: k => DB.tx('readwrite', s => s.delete(k)),
  clear: () => DB.tx('readwrite', s => s.clear())
};
const readImg = f => new Promise((ok, no) => {
  const r = new FileReader(); r.onerror = no;
  r.onload = () => { const i = new Image(); i.onerror = no; i.onload = () => { const z = 480, c = document.createElement('canvas'); c.width = c.height = z; const s = Math.min(i.width, i.height); c.getContext('2d').drawImage(i, (i.width - s) / 2, (i.height - s) / 2, s, s, 0, 0, z, z); ok(c.toDataURL('image/jpeg', .85)); }; i.src = r.result; };
  r.readAsDataURL(f);
});

/* ========== FASE 1: RESULTADO E RANKING ========== */
// MD3: vence quem chega a 2; 2x2 é impossível
const b1 = b => { const x = num(b.aw), y = num(b.bw); if (!P(b.a) || !P(b.b) || x == null || y == null) return null; return x === 2 && y < 2 ? 'a' : y === 2 && x < 2 ? 'b' : null; };
function rank() {
  const A = [], B = []; let done = 0;
  const allNewKD = S.p1.every(b => intVal(b.ak) != null && intVal(b.ad) != null && intVal(b.bk) != null && intVal(b.bd) != null);
  for (const b of S.p1) {
    const w = b1(b); if (!w) continue;
    const e = x => ({ id: b[x], k: intVal(b[x + 'k']), d: intVal(b[x + 'd']), legacy: num(b['legacy' + x.toUpperCase() + 'k']), t: secs(b[x + 't']), ts: b[x + 't'] });
    const W = e(w), L = e(w === 'a' ? 'b' : 'a');
    const score = x => allNewKD ? x.k : (x.legacy ?? x.k);
    W.score = score(W); L.score = score(L);
    if (W.score == null || L.score == null || W.t == null || L.t == null) continue;
    done++; A.push(W); B.push(L);
  }
  const c = (x, y) => y.score - x.score || (allNewKD ? (x.d ?? Infinity) - (y.d ?? Infinity) : 0) || x.t - y.t;
  A.sort(c); B.sort(c);
  return { A, B, done, complete: done === 11, allNewKD };
}
function overallRank() {
  // A fase alcançada tem prioridade sobre as estatísticas acumuladas.
  // 0 = ainda não entrou na chave; 1 = preliminares; 2 = quartas;
  // 3 = semifinais; 4 = grande final. O campeão desempata acima do vice.
  const stageNames = ['Fase 1', 'Preliminares', 'Quartas de final', 'Semifinais', 'Grande final'];
  const totals = new Map(S.players.map(p => [p.id, { id: p.id, k: 0, d: 0, dKnown: false, t: 0, tKnown: false, fights: 0, stage: 0, stageLabel: stageNames[0], champion: false }]));
  const setStage = (pairIndex, stage) => {
    const pair = pairIndex == null ? null : S.pairs[pairIndex];
    if (!pair) return;
    for (const playerId of [pair.a, pair.b]) {
      const e = totals.get(playerId);
      if (e && stage > e.stage) { e.stage = stage; e.stageLabel = stageNames[stage]; }
    }
  };
  // Usa a posição de cada dupla na chave, inclusive a próxima fase já alcançada.
  const stageByMatch = { P1: 1, P2: 1, P3: 1, QF1: 2, QF2: 2, QF3: 2, QF4: 2, SF1: 3, SF2: 3, F: 4 };
  for (const m of M) {
    const stage = stageByMatch[m[0]];
    setStage(ent(m[2]), stage); setStage(ent(m[3]), stage);
  }
  const championPair = win('F');
  if (championPair != null) {
    const pair = S.pairs[championPair];
    for (const playerId of [pair?.a, pair?.b]) {
      const e = totals.get(playerId);
      if (e) { e.champion = true; e.stage = 5; e.stageLabel = 'Campeão'; }
    }
  }
  const add = (id, k, d, t) => {
    const e = totals.get(id); if (!e) return;
    const kk = intVal(k), dd = intVal(d), tt = typeof t === 'number' ? t : secs(t);
    if (kk != null) e.k += kk;
    if (dd != null) { e.d += dd; e.dKnown = true; }
    if (tt != null) { e.t += tt; e.tKnown = true; }
    if (kk != null || dd != null || tt != null) e.fights++;
  };
  // Fase 1: contabiliza cada participante uma única vez no seu confronto.
  for (const b of S.p1) {
    if (!b1(b)) continue;
    add(b.a, b.ak, b.ad, b.at); add(b.b, b.bk, b.bd, b.bt);
  }
  // Fase 2: somente lutas com vencedor; K/D manual por jogador e tempo da luta compartilhado.
  for (const m of M) {
    const id = m[0]; if (win(id) == null) continue;
    const a = ent(m[2]), b = ent(m[3]), r = S.res[id] || {}, duration = secs(r.duration);
    for (const pi of [a, b]) {
      const pair = pi == null ? null : S.pairs[pi]; if (!pair) continue;
      for (const playerId of [pair.a, pair.b]) {
        const st = r.stats?.[playerId] || {};
        add(playerId, st.k, st.d, duration);
      }
    }
  }
  return [...totals.values()].sort((x, y) => y.stage - x.stage || Number(y.champion) - Number(x.champion) || y.k - x.k || (x.dKnown && y.dKnown ? x.d - y.d : x.dKnown ? -1 : y.dKnown ? 1 : 0) || y.fights - x.fights || x.t - y.t);
}
const top5 = () => rank().A.slice(0, 5).map(e => e.id); // Top 5 continuam recebendo BYE conforme a regra do torneio
const top4 = () => rank().A.slice(0, 4).map(e => e.id);

/* ========== FASE 2: CHAVE ========== */
// [id, rótulo, entrada1, entrada2]; 'P1a' = vaga da preliminar, 'B1' = vaga BYE, '>X' = vencedor de X
const M = [['P1', 'Preliminar 1', 'P1a', 'P1b'], ['P2', 'Preliminar 2', 'P2a', 'P2b'], ['P3', 'Preliminar 3', 'P3a', 'P3b'],
  ['QF1', 'Quartas 1', 'B1', '>P1'], ['QF2', 'Quartas 2', 'B2', '>P2'], ['QF3', 'Quartas 3', 'B3', '>P3'], ['QF4', 'Quartas 4', 'B4', 'B5'],
  ['SF1', 'Semifinal 1', '>QF1', '>QF2'], ['SF2', 'Semifinal 2', '>QF3', '>QF4'], ['F', 'GRANDE FINAL', '>SF1', '>SF2']];
const SL = s => (S.slots[s] === undefined || S.slots[s] === '') ? null : +S.slots[s];
const ent = r => r[0] === '>' ? win(r.slice(1)) : SL(r);
// MD5: vence quem chega a 3 (outro com no máximo 2)
function win(id) {
  const m = M.find(x => x[0] === id), a = ent(m[2]), b = ent(m[3]), r = S.res[id] || {};
  if (a == null || b == null) return null;
  const x = num(r.a), y = num(r.b);
  return x === 3 && y != null && y < 3 ? a : y === 3 && x != null && x < 3 ? b : null;
}
// remove duplas/vagas que deixaram de ser válidas após mudança no ranking
function sanitize(R) {
  const A = R.A.map(e => e.id), B = R.B.map(e => e.id), t = A.slice(0, 5); let ch = false;
  S.pairs.forEach(p => { if (p.a && !A.includes(p.a)) { p.a = ''; ch = true; } if (p.b && !B.includes(p.b)) { p.b = ''; ch = true; } });
  for (const s in S.slots) { const p = S.pairs[S.slots[s]]; if (!(p && p.a && p.b && t.includes(p.a) === (s[0] === 'B'))) { delete S.slots[s]; ch = true; } }
  if (ch) save();
}

/* ========== COMPONENTES VISUAIS ========== */
const pic = (id, c = '') => IMG[id] ? `<img class="pic ${c}" src="${IMG[id]}" alt="">` : `<div class="pic ph ${c}">⚔</div>`;
const chip = id => { const p = P(id); return `<div class="chip">${pic(id)}<span><b>${esc(p.char)}</b><small>${esc(p.name)} · ${esc(p.cls)}</small></span></div>`; };
const wo = (max, cur) => ['', ...Array(max + 1).keys()].map(n => `<option value="${n}"${String(cur) === String(n) ? ' selected' : ''}>${n === '' ? '–' : n}</option>`).join('');
const row = (e, pos, top, kd = true) => { const p = P(e.id); return `<div class="rr ${top ? 'top' : ''}"><span class="pos">${pos}º</span>${pic(e.id)}<span class="nm"><b>${esc(p.char)}</b><small>${esc(p.name)} · ${esc(p.cls)}</small></span>${top ? '<i class="bye">BYE</i>' : ''}${kd ? `<span class="kd">K ${e.k ?? '—'} / D ${e.d ?? '—'}<small>${esc(e.ts || fmtSecs(e.t))}</small></span>` : ''}</div>`; };
const pairMini = i => { const p = S.pairs[i], bye = top5().includes(p.a), a = P(p.a), b = P(p.b);
  return `<div class="pm">${pic(p.a)}${pic(p.b)}<span><b>Dupla ${String(i + 1).padStart(2, '0')}${bye ? ' <i class="bye">BYE</i>' : ''}</b><small>${esc(a.char)} (${esc(a.cls)})<br>${esc(b.char)} (${esc(b.cls)})</small></span></div>`; };
function matchCard(m) {
  const [id, lab, r1, r2] = m, a = ent(r1), b = ent(r2), w = win(id), r = S.res[id] || {}, off = a == null || b == null ? 'disabled' : '';
  const statsFor = pi => {
    if (pi == null) return '';
    const pair = S.pairs[pi]; if (!pair || !pair.a || !pair.b) return '';
    return `<div class="match-stats"><small>K/D MANUAL POR JOGADOR</small>${[pair.a, pair.b].map(pid => { const p = P(pid), st = r.stats?.[pid] || {}; return `<div class="player-stat"><span>${esc(p?.char || 'Jogador')}</span><label>Kills<input type="number" min="0" step="1" inputmode="numeric" data-a="r2stat" data-id="${id}" data-player="${pid}" data-k="k" value="${esc(st.k ?? '')}" placeholder="0"></label><label>Mortes<input type="number" min="0" step="1" inputmode="numeric" data-a="r2stat" data-id="${id}" data-player="${pid}" data-k="d" value="${esc(st.d ?? '')}" placeholder="0"></label></div>`; }).join('')}</div>`;
  };
  const side = (pi, x, ref) => `<div class="ms ${w != null && w === pi ? 'won' : ''}">${pi != null ? pairMini(pi) : `<div class="mut">${ref[0] === '>' ? 'Vencedor: ' + M.find(q => q[0] === ref.slice(1))[1] : 'Defina a dupla na chave'}`}<select data-a="r2" data-id="${id}" data-k="${x}" ${off}>${wo(3, r[x] ?? '')}</select></div>`;
  return `<div class="mc" data-match-id="${id}"><h5>${lab === 'GRANDE FINAL' ? lab : `${lab} · MD5`}</h5>${side(a, 'a', r1)}${side(b, 'b', r2)}<details class="match-extra"><summary>Estatísticas K/D e tempo</summary>${statsFor(a)}${statsFor(b)}<label class="duration">Tempo total do combate (mm:ss)<input data-a="r2time" data-id="${id}" value="${esc(r.duration || '')}" placeholder="08:42" inputmode="numeric"></label></details></div>`;
}
function champHtml() {
  const w = win('F'); if (w == null) return '';
  const p = S.pairs[w], r = S.res.F, pl = id => `<div class="champ-player">${pic(id, 'big')}<h3>${esc(P(id).char)}</h3><b>${esc(P(id).name)}</b><em>${esc(P(id).cls)}</em></div>`;
  return `<div class="card champ"><small>🏆 GRANDE FINAL</small><h2>CAMPEÕES — TORNEIO DA MORTE BILLIONS 2026</h2><div class="two">${pl(p.a)}${pl(p.b)}</div></div>`;
}

/* ========== PÁGINA 1: PARTICIPANTES ========== */
function renderPlayers() {
  const n = S.players.length, full = n >= MAX && !editId;
  $('#cnt').textContent = n >= MAX ? '22/22 PARTICIPANTES' : `PARTICIPANTES: ${n}/${MAX}`;
  $('#cards').innerHTML = S.players.map(p => `<div class="card pc">${pic(p.id, 'big')}<h3>${esc(p.char)}</h3><p>${esc(p.name)}</p><em>${esc(p.cls)}</em><div class="row"><button class="b s" data-a="edit" data-id="${p.id}">Editar</button><button class="b s red" data-a="del" data-id="${p.id}">Excluir</button></div></div>`).join('') || '<p class="mut">Nenhum participante cadastrado.</p>';
  $('#fs').disabled = full; $('#fs').textContent = editId ? 'SALVAR ALTERAÇÕES' : full ? 'LIMITE DE 22 ATINGIDO' : 'ADICIONAR PARTICIPANTE'; $('#fx').hidden = !editId;
}
function resetForm() { editId = null; pend = null; $('#f').reset(); $('#pv').style.display = 'none'; $('#pv').removeAttribute('src'); }
async function removePlayer(id) {
  S.players = S.players.filter(p => p.id !== id);
  S.p1.forEach((b, i) => { if (b.a === id || b.b === id) S.p1[i] = bb(); });
  S.pairs.forEach(p => { if (p.a === id) p.a = ''; if (p.b === id) p.b = ''; });
  delete IMG[id]; try { await DB.del(id); } catch { }
  save();
}

/* ========== PÁGINA 2: FASE 1 ========== */
function rankHtml() {
  const R = rank();
  return `<div class="note">${R.complete ? 'TOP 4 EM DESTAQUE · TOP 5 RECEBEM BYE NA FASE 2' : `Ranking oficial após os 11 confrontos completos (${R.done}/11 com resultado, kills e tempo)`}</div>
  <div class="two"><div><h3>TIER A — ${R.A.length}/11</h3>${R.A.map((e, i) => row(e, i + 1, i < 4 && R.complete)).join('') || '<p class="mut">—</p>'}</div>
  <div><h3>TIER B — ${R.B.length}/11</h3>${R.B.map((e, i) => row(e, i + 12, false)).join('') || '<p class="mut">—</p>'}</div></div>`;
}
function render1() {
  const used = new Set(S.p1.flatMap(b => [b.a, b.b]).filter(Boolean));
  const psel = (i, k) => { const cur = S.p1[i][k]; return `<select data-a="b1" data-i="${i}" data-k="${k}"><option value="">Selecionar jogador</option>${S.players.filter(p => p.id === cur || !used.has(p.id)).map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.char)} (${esc(p.name)})</option>`).join('')}</select>`; };
  const side = (b, i, x) => `<div class="side ${b1(b) === x ? 'won' : ''}">${psel(i, x)}${b[x] ? chip(b[x]) : ''}<div class="r3"><label>Vitórias<select data-a="b1" data-i="${i}" data-k="${x}w">${wo(2, b[x + 'w'])}</select></label><label>Kills<input type="number" min="0" step="1" inputmode="numeric" data-a="b1t" data-i="${i}" data-k="${x}k" value="${esc(b[x + 'k'])}" placeholder="0"></label><label>Mortes<input type="number" min="0" step="1" inputmode="numeric" data-a="b1t" data-i="${i}" data-k="${x}d" value="${esc(b[x + 'd'])}" placeholder="0"></label><label>Tempo<input data-a="b1t" data-i="${i}" data-k="${x}t" value="${esc(b[x + 't'])}" placeholder="08:42"></label></div></div>`;
  $('#v1').innerHTML = `<h2>FASE 1<small>DEFINIÇÃO DE TIER — 1x1 · 11 confrontos · MD3</small></h2>
  <div class="bt-grid">${S.p1.map((b, i) => { const w = b1(b); return `<div class="card"><h3>BATALHA ${String(i + 1).padStart(2, '0')}<span class="vs-r">MD3</span></h3><div class="duel">${side(b, i, 'a')}<div class="vs">VS</div>${side(b, i, 'b')}</div><div class="win">${w ? 'VENCEDOR: ' + esc(P(b[w]).char) + ' (' + esc(P(b[w]).name) + ')' : 'Aguardando resultado'}</div></div>`; }).join('')}</div>
  <h2>RANKING DA FASE 1</h2><div id="rk1">${rankHtml()}</div>
  <p><button class="b red" data-a="reset1">RESETAR RESULTADOS DA FASE 1</button></p>`;
}

/* ========== PÁGINA 3: FASE 2 ========== */
function render2() {
  const R = rank(), el = $('#v2'), h = '<h2>FASE 2<small>TORNEIO DE DUPLAS — 2x2 · MD5</small></h2>';
  if (!R.complete) { el.innerHTML = h + '<div class="card">Preencha os 11 confrontos da Fase 1 (vitórias, kills e tempo) para liberar a Fase 2.</div>'; return; }
  const A = R.A.map(e => e.id), B = R.B.map(e => e.id), t5 = A.slice(0, 5);
  const opt = (ids, off, k, cur) => { const u = S.pairs.map(p => p[k]).filter(x => x && x !== cur); return '<option value="">Selecionar</option>' + ids.filter(id => !u.includes(id)).map(id => `<option value="${id}"${id === cur ? ' selected' : ''}>${ids.indexOf(id) + off}º · ${esc(P(id).char)}</option>`).join(''); };
  const pairs = S.pairs.map((p, i) => { const bye = p.a && t5.includes(p.a), ph = l => `<div class="pic ph md">${l}</div>`;
    return `<div class="card ${bye ? 'bye-c' : ''}"><h3>DUPLA ${String(i + 1).padStart(2, '0')}<i class="tag">${p.a ? (bye ? 'BYE' : 'PRELIMINAR') : '—'}</i></h3><div class="pp"><div>${p.a ? pic(p.a, 'md') : ph('A')}<select data-a="pr" data-i="${i}" data-k="a">${opt(A, 1, 'a', p.a)}</select></div><b>+</b><div>${p.b ? pic(p.b, 'md') : ph('B')}<select data-a="pr" data-i="${i}" data-k="b">${opt(B, 12, 'b', p.b)}</select></div></div>${p.a && p.b ? `<small>${esc(P(p.a).cls)} + ${esc(P(p.b).cls)}</small>` : ''}</div>`; }).join('');
  const usedS = Object.values(S.slots);
  const so = s => { const cur = S.slots[s]; return '<option value="">Selecionar dupla</option>' + S.pairs.map((p, i) => [p, i]).filter(([p, i]) => p.a && p.b && t5.includes(p.a) === (s[0] === 'B') && (String(i) === cur || !usedS.includes(String(i)))).map(([p, i]) => `<option value="${i}"${String(i) === cur ? ' selected' : ''}>Dupla ${i + 1} — ${esc(P(p.a).char)} + ${esc(P(p.b).char)}</option>`).join(''); };
  const sl = (s, l) => `<label>${l}<select data-a="sl" data-k="${s}">${so(s)}</select></label>`;
  const slots = ['P1a', 'P1b', 'P2a', 'P2b', 'P3a', 'P3b'].map(s => sl(s, `Preliminar ${s[1]} — ${s[2] === 'a' ? '1ª' : '2ª'} dupla`)).join('') + ['B1', 'B2', 'B3', 'B4', 'B5'].map(s => sl(s, `BYE ${s[1]} — direto às Quartas`)).join('');
  const col = (t, ids, cls) => `<div class="col ${cls}"><h4>${t}</h4>${ids.map(id => matchCard(M.find(m => m[0] === id))).join('')}</div>`;
  el.innerHTML = `${h}
  <div class="two"><div><h3>TIER A — 1º ao 11º</h3>${R.A.map((e, i) => row(e, i + 1, i < 4, false)).join('')}</div><div><h3>TIER B — 12º ao 22º</h3>${R.B.map((e, i) => row(e, i + 12, false, false)).join('')}</div></div>
  <h2>MONTAGEM DAS DUPLAS</h2><div class="pgrid">${pairs}</div>
  <h2>POSIÇÃO NA CHAVE</h2><div class="note">As 5 duplas BYE só entram nas vagas BYE; as 6 restantes, nas Preliminares. Vencedores: P1→Quartas 1, P2→Quartas 2, P3→Quartas 3.</div><div class="slots">${slots}</div>
  <h2>CHAVE</h2><div class="bracket">${col('PRELIMINARES', ['P1', 'P2', 'P3'], 'round-prelims')}${col('QUARTAS DE FINAL', ['QF1', 'QF2', 'QF3', 'QF4'], 'round-quarters')}${col('SEMIFINAIS', ['SF1', 'SF2'], 'round-semis')}${col('GRANDE FINAL', ['F'], 'round-final')}</div>
  ${champHtml()}<p><button class="b red" data-a="reset2">RESETAR RESULTADOS DA FASE 2</button></p>`;
}

/* ========== PÁGINA 4: RESUMO ========== */
function renderSum() {
  const R = rank(), all = overallRank(), ents = ids => ids.reduce((n, id) => { const m = M.find(x => x[0] === id); return n + (ent(m[2]) != null) + (ent(m[3]) != null); }, 0);
  const st = (l, v, sub = '') => `<div class="st"><small>${l}</small><b>${v}</b><div>${sub}</div></div>`;
  const needsKD = S.p1.some(b => b.legacyAk != null || b.legacyBk != null) && !R.allNewKD;
  const completed2 = M.filter(m => win(m[0]) != null).length;
  const displayed = [...all];
  if (rankSort === 'kd') displayed.sort((x, y) => {
    const ratio = e => e.d === 0 ? (e.k > 0 ? Infinity : 0) : e.k / e.d;
    return ratio(y) - ratio(x) || y.k - x.k || (x.dKnown && y.dKnown ? x.d - y.d : x.dKnown ? -1 : y.dKnown ? 1 : 0) || y.stage - x.stage || y.fights - x.fights || x.t - y.t;
  });
  $('#v3').innerHTML = `<h2>TORNEIO DA MORTE<small>BILLIONS 2026 — PRIMAVERA</small></h2>${champHtml()}
  <div class="stats">${st('PARTICIPANTES', S.players.length + '/22')}${st('FASE 1', R.done + '/11', 'confrontos válidos')}${st('TIER A', R.A.length + '/11', 'jogadores')}${st('TIER B', R.B.length + '/11', 'jogadores')}${st('TOP 4', R.complete ? 4 : 0, 'em destaque')}${st('DUPLAS', S.pairs.filter(p => p.a && p.b).length + '/11')}${st('LUTAS FASE 2', completed2 + '/10')}${st('QUARTAS', ents(['QF1', 'QF2', 'QF3', 'QF4']) + '/8', 'duplas')}${st('SEMIFINAIS', ents(['SF1', 'SF2']) + '/4', 'duplas')}${st('FINAL', ents(['F']) + '/2', 'duplas')}${st('CAMPEÃO', win('F') != null ? '🏆' : '—')}</div>
  <h2>RANKING GERAL — TODAS AS FASES</h2><p class="note">Ordem padrão: fase mais avançada alcançada; desempate por kills, menos mortes, combates registrados e menor tempo. Selecione K/D para ordenar pela proporção kills ÷ mortes.</p>${needsKD ? '<p class="note">Os valores antigos de KDA foram preservados para manter a classificação da Fase 1, mas não podem ser convertidos automaticamente em kills e mortes. Preencha o novo K/D da Fase 1 para que esses números entrem no ranking geral.</p>' : ''}<label class="rank-filter">Ordenar ranking por<select id="rankSort"><option value="stage"${rankSort === 'stage' ? ' selected' : ''}>Fase alcançada (padrão)</option><option value="kd"${rankSort === 'kd' ? ' selected' : ''}>K/D (kills ÷ mortes)</option></select></label><div class="parch"><table><tr><th>POSIÇÃO</th><th>FASE ALCANÇADA</th><th>PERSONAGEM</th><th>JOGADOR</th><th>CLASSE</th><th>KILLS</th><th>MORTES</th><th>K/D</th><th>TEMPO TOTAL</th></tr>${displayed.map((e, i) => { const ratio = e.d === 0 ? (e.k > 0 ? '∞' : '—') : (e.k / e.d).toFixed(2); return `<tr class="${i < 4 ? 't5' : ''}"><td>${i + 1}º</td><td>${esc(e.stageLabel)}</td><td><div class="who">${pic(e.id)}${esc(P(e.id).char)}</div></td><td>${esc(P(e.id).name)}</td><td>${esc(P(e.id).cls)}</td><td>${e.k}</td><td>${e.dKnown ? e.d : '—'}</td><td>${e.dKnown ? ratio : '—'}</td><td>${e.tKnown ? fmtSecs(e.t) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="9">Sem resultados ainda.</td></tr>'}</table></div>`;
  $('#rankSort').onchange = e => { rankSort = e.target.value; renderSum(); };
}

/* ========== NAVEGAÇÃO / RENDER ========== */
function render() {
  const R = rank(); if (R.complete) sanitize(R);
  const bk = $('.bracket'), sx = bk ? bk.scrollLeft : 0;
  [0, 1, 2, 3].forEach(i => { $('#v' + i).hidden = i !== view; });
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', +b.dataset.v === view));
  [renderPlayers, render1, render2, renderSum][view]();
  const b2 = $('.bracket'); if (b2) b2.scrollLeft = sx;
}
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) { view = +b.dataset.v; render(); scrollTo(0, 0); } };

/* ========== EVENTOS ========== */
document.addEventListener('change', e => {
  if (READ_ONLY) return;
  const t = e.target, a = t.dataset.a; if (!a) return;
  const i = +t.dataset.i, k = t.dataset.k, v = t.value;
  if (a === 'b1') {
    const b = S.p1[i], old = b[k]; b[k] = v;
    if (num(b.aw) === 2 && num(b.bw) === 2) { alert('Resultado impossível no MD3 (2 × 2).'); b[k] = old; }
    save(); render();
  } else if (a === 'b1t') {
    const b = S.p1[i]; let x = v.trim();
    if ((k.endsWith('k') || k.endsWith('d')) && x && intVal(x) == null) { alert('Informe um número inteiro igual ou maior que zero.'); x = ''; }
    if (k.endsWith('t') && x && secs(x) == null) { alert('Tempo inválido. Use mm:ss (ex.: 08:42).'); x = ''; }
    b[k] = x; t.value = x; save(); $('#rk1').innerHTML = rankHtml();
  } else if (a === 'r2stat') {
    const id = t.dataset.id, pid = t.dataset.player, field = t.dataset.k, r = S.res[id] = S.res[id] || {};
    r.stats = r.stats || {}; r.stats[pid] = r.stats[pid] || {};
    let x = v.trim(); if (x && intVal(x) == null) { alert('Kills e mortes devem ser números inteiros iguais ou maiores que zero.'); x = ''; }
    r.stats[pid][field] = x; t.value = x; save();
  } else if (a === 'r2time') {
    const id = t.dataset.id, r = S.res[id] = S.res[id] || {}; let x = v.trim();
    if (x && secs(x) == null) { alert('Tempo inválido. Use mm:ss (ex.: 08:42).'); x = ''; }
    r.duration = x; t.value = x; save();
  } else if (a === 'pr') { S.pairs[i][k] = v; save(); render();
  } else if (a === 'sl') { if (v) S.slots[k] = v; else delete S.slots[k]; save(); render();
  } else if (a === 'r2') {
    const id = t.dataset.id, r = S.res[id] = S.res[id] || {}, old = r[k]; r[k] = v;
    if (num(r.a) === 3 && num(r.b) === 3) { alert('Resultado impossível no MD5 (3 × 3).'); r[k] = old; }
    save(); render();
  }
});
document.addEventListener('click', async e => {
  if (READ_ONLY) return;
  const t = e.target.closest('button[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  if (a === 'edit') { const p = P(id); editId = id; pend = null; $('#fp').value = p.name; $('#fc').value = p.char; $('#fl').value = p.cls; if (IMG[id]) { $('#pv').src = IMG[id]; $('#pv').style.display = 'block'; } renderPlayers(); scrollTo(0, 0); }
  else if (a === 'cancel') { resetForm(); renderPlayers(); }
  else if (a === 'del') { if (confirm(`Excluir ${P(id).char}? Confrontos e duplas com esse jogador serão limpos.`)) { await removePlayer(id); if (editId === id) resetForm(); render(); } }
  else if (a === 'reset1') { if (confirm('Resetar vitórias, kills, mortes e tempo da Fase 1? Duplas e chave da Fase 2 também serão limpas.')) { S.p1.forEach(b => { b.aw = b.bw = b.ak = b.ad = b.bk = b.bd = b.at = b.bt = ''; }); S.pairs.forEach(p => { p.a = p.b = ''; }); S.slots = {}; S.res = {}; save(); render(); } }
  else if (a === 'reset2') { if (confirm('Resetar todos os resultados da Fase 2?')) { S.res = {}; save(); render(); } }
});
$('#fi').onchange = async e => { if (READ_ONLY) return; const f = e.target.files[0]; if (!f) return; try { pend = await readImg(f); $('#pv').src = pend; $('#pv').style.display = 'block'; } catch { alert('Não foi possível ler a imagem.'); } };
$('#f').onsubmit = async e => {
  e.preventDefault(); if (READ_ONLY) return;
  const d = { name: $('#fp').value.trim(), char: $('#fc').value.trim(), cls: $('#fl').value.trim() };
  if (!d.name || !d.char || !d.cls) return;
  let id = editId;
  if (id) Object.assign(P(id), d);
  else { if (S.players.length >= MAX) return alert('Limite de 22 participantes.'); id = uid(); S.players.push({ id, ...d }); }
  if (pend) { IMG[id] = pend; try { await DB.put(id, pend); } catch { alert('Não foi possível salvar a foto neste navegador.'); } }
  save(); resetForm(); render();
};
$('#exp').onclick = () => {
  if (READ_ONLY) return;
  const b = new Blob([JSON.stringify({ app: 'tdm2026', v: 1, state: S, ranking: rank(), imgs: IMG })], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'torneio-da-morte-billions-2026.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#imp').onchange = async e => {
  if (READ_ONLY) return;
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text()), s = d.state;
    if (!s || !Array.isArray(s.players) || s.players.length > MAX || !Array.isArray(s.p1) || s.p1.length !== 11 || !Array.isArray(s.pairs) || s.pairs.length !== 11) throw 0;
    if (!confirm('Substituir TODOS os dados atuais pelo arquivo?')) return;
    S = normalizeState(s); IMG = d.imgs || {};
    await DB.clear(); for (const k in IMG) await DB.put(k, IMG[k]);
    save(); resetForm(); render();
  } catch { alert('Arquivo inválido.'); }
};

/* ========== INÍCIO ========== */
(async () => {
  if (READ_ONLY) {
    try {
      let d = await loadRemote();
      if (!d) { const response = await fetch('./torneio-da-morte-billions-2026.json'); if (!response.ok) throw new Error('sem dados'); d = await response.json(); }
      S = normalizeState(d.state); IMG = d.imgs || {}; view = 3;
    } catch {
      $('#v3').innerHTML = '<div class="card">Não foi possível carregar os dados públicos. Verifique se o arquivo JSON está na mesma pasta do site.</div>';
      view = 3;
    }
    document.body.classList.add('read-only');
  } else {
    try { const j = localStorage.getItem(KEY); if (j) S = normalizeState(JSON.parse(j)); } catch { }
    try { IMG = await DB.all(); } catch { }
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { }
    try {
      const d = await loadRemote();
      if (d && d.state) {
        S = normalizeState(d.state); IMG = d.imgs || {};
        try { await DB.clear(); for (const k in IMG) await DB.put(k, IMG[k]); } catch { }
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { }
        syncReady = true; setStatus('☁ Dados carregados do servidor');
      } else {
        syncReady = true; setStatus('☁ Servidor vazio');
        if (S.players.length) schedulePush(); // primeira vez: sobe os dados deste navegador
      }
    } catch (e) { setStatus('☁ Offline — alterações NÃO serão enviadas (recarregue a página)', true); }
  }
  $('#petals').innerHTML = Array.from({ length: 14 }, () => `<i style="left:${Math.random() * 100}%;animation-duration:${9 + Math.random() * 10}s;animation-delay:${-Math.random() * 15}s"></i>`).join('');
  render();
  if (READ_ONLY) {
    document.querySelectorAll('input, textarea, button[data-a], #fs, #fx').forEach(el => el.disabled = true);
    document.querySelectorAll('select:not(#rankSort)').forEach(el => el.disabled = true);
  }
})();
