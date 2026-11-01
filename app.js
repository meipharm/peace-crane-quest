'use strict';

// ===== 進度存檔（只存在這台裝置的瀏覽器） =====
const STORE_KEY = 'peace-crane-quest-v1';
const NODE_MAP = Object.fromEntries(NODES.map(n => [n.id, n]));
const HELPER_ORDER = NODES.map(n => n.helper);

function freshState() {
  return {
    cranes: 0, earned: 0, completed: {}, best: {},
    helpers: [], missions: {}, talks: {}, notes: {}, badges: [],
    timelineDone: false, checklist: {}
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(freshState(), JSON.parse(raw));
  } catch (e) { /* 私密模式或封鎖儲存時，改用暫存進度 */ }
  return freshState();
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 忽略 */ }
}

let state = loadState();
let quiz = null;      // 目前的問答進度
let timeline = null;  // 目前的時光機進度
const app = document.getElementById('app');

// ===== 小工具 =====
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rankName() {
  let name = RANKS[0].name;
  RANKS.forEach(r => { if (state.earned >= r.min) name = r.name; });
  return name;
}

function craneSVG(color, size, cls) {
  const fill = color === 'rainbow' ? 'url(#rainbowGrad)' : color;
  return `<svg class="crane ${cls || ''}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <g fill="${fill}" stroke="#2b2a33" stroke-width="1.6" stroke-linejoin="round">
      <polygon points="6,16 31,36 24,42"/>
      <polygon points="58,16 33,36 40,42"/>
      <polygon points="42,42 55,26 51,26 37,40"/>
      <polygon points="22,42 9,24 13,24 27,40"/>
      <polygon points="9,24 3,26 11,20"/>
      <polygon points="22,42 32,32 42,42 32,52"/>
    </g>
    <circle cx="29" cy="42" r="1.8" fill="#2b2a33"/><circle cx="35" cy="42" r="1.8" fill="#2b2a33"/>
  </svg>`;
}

function updateHud() {
  document.getElementById('hud-cranes').textContent = state.cranes;
  document.getElementById('hud-rank').textContent = rankName();
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function floatText(msg) {
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function confetti() {
  const colors = ['#d94b4b', '#e8b33a', '#4f9d69', '#3b7dd8', '#ec8fb5'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }
}

function modal(html, okText, onOk, cancelText) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}
    <div class="modal-actions">
      ${cancelText === null ? '' : `<button class="btn ghost" data-act="cancel">${esc(cancelText || '取消')}</button>`}
      <button class="btn" data-act="ok">${esc(okText)}</button>
    </div></div>`;
  wrap.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (!act && e.target !== wrap) return;
    wrap.remove();
    if (act && act.dataset.act === 'ok' && onOk) onOk();
  });
  document.body.appendChild(wrap);
}

function addCranes(n) {
  if (n <= 0) return;
  state.cranes += n;
  state.earned += n;
  saveState();
  updateHud();
  floatText(`+${n} 🦢`);
  checkBadges();
}

function checkBadges() {
  BADGES.forEach(b => {
    if (!state.badges.includes(b.id) && b.test(state)) {
      state.badges.push(b.id);
      saveState();
      setTimeout(() => toast(`獲得徽章：${b.icon} ${b.name}`), 600);
    }
  });
}

// Google 地圖連結：search 看位置，dir 從目前位置用大眾運輸導航
function mapUrl(type, q) {
  const query = encodeURIComponent(q);
  return type === 'dir'
    ? `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=transit`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

// 所有地點一開始就開放，行程順序改變時可以直接跳到任何地點
function nodeStatus(n) {
  return state.completed[n.id] ? 'done' : 'open';
}

function go(hash) { location.hash = hash; }

// ===== 路由 =====
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || 'home';
  const id = parts[1];
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));

  if ((view === 'node' || view === 'quiz') && !NODE_MAP[id]) return go('#/map');

  if (view === 'map') renderMap();
  else if (view === 'node') renderNode(NODE_MAP[id]);
  else if (view === 'quiz') { if (!quiz || quiz.nodeId !== id || quiz.phase === 'done') startQuiz(id); renderQuiz(); }
  else if (view === 'timeline') { if (!timeline) startTimeline(); renderTimeline(); }
  else if (view === 'collection') renderCollection();
  else if (view === 'parents') renderParents();
  else renderHome();
  window.scrollTo(0, 0);
}

// ===== 首頁 =====
function renderHome() {
  app.innerHTML = `
  <section class="hero">
    <div class="hero-cranes">${craneSVG('#d94b4b', 64, 'bob')}${craneSVG('#e8b33a', 52, 'bob d1')}${craneSVG('#3b7dd8', 58, 'bob d2')}</div>
    <h1>和平紙鶴大冒險</h1>
    <p class="sub">廣島歷史探險地圖</p>
    <p>你是<strong>和平紙鶴探險隊</strong>的隊長！跟著地圖走遍廣島、宮島和吳市，回答問題收集紙鶴，認識二戰的歷史，還有台灣在那段時間發生的事。</p>
  </section>
  <section class="card">
    <h2>怎麼玩</h2>
    <ol class="howto">
      <li><b>回答問題</b>：第一次就答對得 3 隻紙鶴 🦢，第二次 2 隻，之後 1 隻。</li>
      <li><b>自由探索</b>：地圖上每個地點都已經開放，到了哪裡就玩哪一關！</li>
      <li><b>收集鶴寶</b>：每完成一個地點，就有一隻新的鶴寶加入小隊。</li>
      <li><b>鶴寶提示</b>：每隻鶴寶在答題時可以幫你刪掉一個錯的答案。</li>
      <li><b>真實任務</b>：到了現場完成任務、和爸媽聊天，還能再得紙鶴。</li>
    </ol>
    <div class="row">
      <a class="btn big" href="#/map">出發！打開地圖</a>
      <a class="btn ghost" href="#/parents">爸媽手冊</a>
    </div>
  </section>`;
}

// ===== 地圖 =====
function renderMap() {
  const edges = [];
  NODES.forEach(n => n.route.forEach(r => {
    const a = NODE_MAP[r];
    const done = state.completed[r] && state.completed[n.id];
    edges.push(`<line x1="${a.x}" y1="${a.y}" x2="${n.x}" y2="${n.y}" class="edge ${done ? 'done' : ''}"/>`);
  }));

  const nodes = NODES.map(n => {
    const st = nodeStatus(n);
    const badge = st === 'done' ? `<g class="flag"><circle cx="18" cy="-18" r="9"/><text x="18" y="-14" text-anchor="middle">✓</text></g>` : '';
    return `<g class="node ${st}" transform="translate(${n.x},${n.y})" data-id="${n.id}" role="button" tabindex="0" aria-label="${esc(n.name)}">
      <circle r="24" class="node-bg"/>
      <text class="node-icon" text-anchor="middle" y="8">${n.icon}</text>
      ${badge}
      <text class="node-label" text-anchor="middle" y="40">D${n.day} ${esc(n.name.split('・')[0].split('與')[0])}</text>
    </g>`;
  }).join('');

  const squad = state.helpers.length
    ? state.helpers.map((h, i) => `<span title="${esc(HELPERS[h].name)}">${craneSVG(HELPERS[h].color, 34, 'bob d' + (i % 3))}</span>`).join('')
    : '<span class="muted">完成第一個地點，鶴寶就會加入你的小隊！</span>';

  app.innerHTML = `
  <section class="map-wrap">
    <svg class="map" viewBox="0 0 400 560" role="img" aria-label="廣島探險地圖">
      <rect width="400" height="560" class="sea"/>
      <path class="land" d="M0,0 H400 V250 C360,262 338,300 358,330 C378,352 372,392 330,398 C300,334 262,302 232,300 C204,318 182,302 152,292 C122,282 100,302 60,292 C30,286 12,272 0,282 Z"/>
      <ellipse class="land" cx="70" cy="350" rx="50" ry="36"/>
      <!-- 廣島市中心六條河（示意）：由西到東 -->
      <path class="river" d="M120,0 C90,80 40,150 28,288"/>
      <path class="river" d="M140,0 C120,90 80,170 72,292"/>
      <path class="river" d="M150,0 C140,100 118,180 112,286"/>
      <path class="river" d="M128,150 C150,180 178,220 182,298"/>
      <path class="river" d="M160,40 C230,70 285,130 285,304"/>
      <path class="river" d="M283,160 C300,200 310,260 305,328"/>
      <g class="river-label">
        <text x="40" y="200">放水路</text>
        <text x="80" y="200">天滿川</text>
        <text x="115" y="190">本川</text>
        <text x="182" y="262">元安川</text>
        <text x="286" y="200">京橋川</text>
        <text x="306" y="250">猿猴川</text>
      </g>
      <text x="318" y="40" class="map-label">✈ 廣島機場</text>
      <text x="228" y="288" class="map-label">廣島市</text>
      <text x="40" y="400" class="map-label">宮島</text>
      <text x="335" y="315" class="map-label">吳市</text>
      <text x="230" y="480" class="map-label sea-label">瀨戶內海</text>
      <rect x="10" y="445" width="160" height="105" rx="14" class="inset"/>
      <text x="22" y="465" class="map-label">台灣基地</text>
      <path class="flight" d="M365,55 C420,250 260,520 130,505"/>
      ${edges.join('')}
      ${nodes}
    </svg>
  </section>
  <section class="card">
    <h2>你的鶴寶小隊</h2>
    <div class="squad">${squad}</div>
    <p class="muted small">提示：所有地點都可以直接點進去，照你們實際的行程順序玩就好。虛線是建議路線，完成後會變成紅色。</p>
    <p class="muted small">🗺️ 這是示意圖，位置和距離都經過簡化。廣島市中心是太田川分流形成的三角洲，由西到東有六條河：太田川放水路、天滿川、本川（舊太田川）、元安川、京橋川、猿猴川（依日本國土交通省資料）。</p>
  </section>
  <section class="card">
    <h2>地點清單</h2>
    <ul class="node-list">
      ${NODES.map(n => {
        const st = nodeStatus(n);
        const label = st === 'done' ? '已完成 ✓' : '開始探索 →';
        return `<li><button class="node-item ${st}" data-id="${n.id}"><span class="ni-icon">${n.icon}</span><span><b>D${n.day}｜${esc(n.name)}</b><br><small>${esc(n.tagline)}</small></span><span class="ni-status">${label}</span></button></li>`;
      }).join('')}
    </ul>
  </section>`;

  app.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => onNodeTap(el.dataset.id));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeTap(el.dataset.id); } });
  });
}

function onNodeTap(id) {
  go('#/node/' + id);
}

// ===== 地點頁 =====
function renderNode(n) {
  const done = !!state.completed[n.id];
  const missionDone = !!state.missions[n.id];
  const talked = !!state.talks[n.id];
  app.innerHTML = `
  <a class="back" href="#/map">← 回地圖</a>
  <section class="node-head">
    <div class="node-big">${n.icon}</div>
    <div>
      <span class="day-tag">Day ${n.day}</span>
      <h1>${esc(n.name)}</h1>
      <p class="sub">${esc(n.tagline)}</p>
    </div>
  </section>

  ${photoFigure(PHOTOS[n.photo])}

  <section class="card story">
    <h2>📖 故事時間</h2>
    <p>${esc(n.story)}</p>
  </section>

  <section class="card challenge">
    <h2>⚔️ 挑戰關卡</h2>
    <p>${n.quiz.length} 道題目。${done ? `你已經完成了！最佳成績：第一次就答對 ${state.best[n.id] || 0} 題。複習時每答對一題可得 1 隻紙鶴。` : '完成後會有新的鶴寶加入小隊！'}</p>
    <a class="btn big" href="#/quiz/${n.id}">${done ? '再挑戰一次（複習）' : '開始挑戰！'}</a>
  </section>

  <section class="card mission">
    <h2>📸 現場任務</h2>
    <p>${esc(n.mission)}</p>
    <button class="btn ${missionDone ? 'ghost' : ''}" id="btn-mission" ${missionDone ? 'disabled' : ''}>${missionDone ? '任務完成 ✓' : '我完成任務了！ +2 🦢'}</button>
  </section>

  <section class="card taiwan">
    <h2>🇹🇼 台灣連結</h2>
    <p>${esc(n.taiwan)}</p>
  </section>

  <section class="card talk">
    <h2>💬 和爸媽聊聊</h2>
    <p class="ask">${esc(n.ask)}</p>
    <textarea id="talk-note" rows="3" placeholder="可以把你的想法寫在這裡（只存在這台裝置）"></textarea>
    <button class="btn ${talked ? 'ghost' : ''}" id="btn-talk" ${talked ? 'disabled' : ''}>${talked ? '已經聊過了 ✓' : '我們聊過了！ +1 🦢'}</button>
  </section>

  <section class="card">
    <h2>🚃 怎麼去</h2>
    <p>${esc(n.howto)}</p>
    <div class="map-links">${n.maps.map(m => `<div class="map-link">
      <b>📍 ${esc(m.label)}</b>
      <a class="btn ghost small" href="${mapUrl('search', m.q)}" target="_blank" rel="noopener">看位置</a>
      <a class="btn small" href="${mapUrl('dir', m.q)}" target="_blank" rel="noopener">🧭 導航</a>
    </div>`).join('')}</div>
    <p class="muted small">「導航」會從你現在的位置，用大眾運輸規劃路線，會開啟 Google 地圖。</p>
  </section>

  ${n.visit ? `<section class="card visit">
    <h2>🕒 開放時間與休館日</h2>
    ${visitTable(n.visit.places)}
    ${n.visit.tip ? `<p class="tip">${esc(n.visit.tip)}</p>` : ''}
    <p class="muted small">2026 年 11 月查核官網，出發前請再確認：<a href="${esc(n.visit.url)}" target="_blank" rel="noopener">官方資訊</a></p>
  </section>` : ''}

  <details class="card parents-note">
    <summary>👨‍👩‍👦 爸媽補充（點開看）</summary>
    <ul>${n.parents.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
  </details>

  <details class="card refs">
    <summary>📚 參考資料（${n.refs.length}）</summary>
    <ol>${n.refs.map(r => sourceItem(SOURCES[r])).join('')}</ol>
  </details>`;

  const note = document.getElementById('talk-note');
  note.value = state.notes[n.id] || '';
  note.addEventListener('input', () => { state.notes[n.id] = note.value; saveState(); });

  document.getElementById('btn-mission').addEventListener('click', () => {
    if (state.missions[n.id]) return;
    state.missions[n.id] = true;
    addCranes(2);
    renderNode(n);
  });
  document.getElementById('btn-talk').addEventListener('click', () => {
    if (state.talks[n.id]) return;
    state.talks[n.id] = true;
    addCranes(1);
    renderNode(n);
  });
}

// 地點照片與 CC 授權標示
function photoFigure(p) {
  if (!p) return '';
  return `<figure class="photo">
    <img src="${esc(p.src)}" alt="${esc(p.caption)}" loading="lazy">
    <figcaption>${esc(p.caption)}<br><small>照片：<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.author)}</a>／<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>，經縮圖</small></figcaption>
  </figure>`;
}

// 開放時間表（每個場館一列）
function visitTable(places) {
  return `<div class="table-wrap"><table class="visit-table">
    <thead><tr><th>場館</th><th>開放時間</th><th>休館日</th><th>門票</th></tr></thead>
    <tbody>${places.map(p => `<tr><td>${esc(p.place)}</td><td>${esc(p.hours)}</td><td>${esc(p.closed)}</td><td>${esc(p.fee)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// 參考資料的一筆：有網址就開新分頁
function sourceItem(s) {
  const title = s.url
    ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`
    : esc(s.title);
  return `<li>${title}<br><small>${esc(s.by)}｜${esc(s.note)}</small></li>`;
}

// ===== 問答 =====
function startQuiz(nodeId) {
  const n = NODE_MAP[nodeId];
  quiz = {
    nodeId,
    replay: !!state.completed[nodeId],
    qs: shuffle(n.quiz).map(q => ({ ...q, answer: q.options[0], shown: shuffle(q.options) })),
    i: 0, tries: 0, removed: [], wrong: [],
    hints: state.helpers.length, gained: 0, firstTry: 0, phase: 'ask'
  };
}

function renderQuiz() {
  const n = NODE_MAP[quiz.nodeId];
  if (quiz.phase === 'done') return renderQuizResult(n);
  const q = quiz.qs[quiz.i];
  const total = quiz.qs.length;
  const pct = Math.round((quiz.i / total) * 100);
  const opts = q.shown.map(o => {
    const isRemoved = quiz.removed.includes(o);
    const isWrong = quiz.wrong.includes(o);
    const isRight = quiz.phase === 'feedback' && o === q.answer;
    const cls = isRight ? 'right' : isWrong ? 'wrong' : isRemoved ? 'removed' : '';
    const dis = quiz.phase === 'feedback' || isRemoved || isWrong;
    return `<button class="option ${cls}" data-opt="${esc(o)}" ${dis ? 'disabled' : ''}>${esc(o)}</button>`;
  }).join('');

  let feedback = '';
  if (quiz.phase === 'feedback') {
    feedback = `<div class="feedback">
      <p class="fb-title">✅ 答對了！</p>
      <p>${esc(q.explain)}</p>
      ${q.taiwan ? `<div class="tw-card"><b>🇹🇼 台灣連結</b><p>${esc(q.taiwan)}</p></div>` : ''}
      <button class="btn big" id="btn-next">${quiz.i + 1 < total ? '下一題 →' : '看結果！'}</button>
    </div>`;
  }

  app.innerHTML = `
  <a class="back" href="#/node/${n.id}">← 離開挑戰</a>
  <section class="quiz">
    <div class="quiz-top">
      <span>${n.icon} ${esc(n.name)}</span>
      <span>第 ${quiz.i + 1} / ${total} 題</span>
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <h2 class="question">${esc(q.q)}</h2>
    <div class="options">${opts}</div>
    ${quiz.phase === 'ask' ? `<div class="quiz-tools">
      <button class="btn ghost small" id="btn-hint" ${quiz.hints > 0 ? '' : 'disabled'}>🦢 鶴寶提示（剩 ${quiz.hints}）</button>
      <span class="muted small">這關已得 🦢 ${quiz.gained}</span>
    </div>` : ''}
    ${feedback}
  </section>`;

  app.querySelectorAll('.option').forEach(b => b.addEventListener('click', () => answer(b.dataset.opt)));
  const hint = document.getElementById('btn-hint');
  if (hint) hint.addEventListener('click', useHint);
  const next = document.getElementById('btn-next');
  if (next) next.addEventListener('click', nextQuestion);
}

function answer(opt) {
  if (quiz.phase !== 'ask') return;
  const q = quiz.qs[quiz.i];
  if (opt === q.answer) {
    let gain;
    if (quiz.replay) gain = 1;
    else gain = [3, 2, 1][Math.min(quiz.tries, 2)];
    if (quiz.tries === 0) quiz.firstTry++;
    quiz.gained += gain;
    quiz.phase = 'feedback';
    addCranes(gain);
  } else {
    quiz.wrong.push(opt);
    quiz.tries++;
    toast('再想想看！');
  }
  renderQuiz();
  // 答對後把講解和「下一題」捲進畫面
  const fb = document.querySelector('.feedback');
  if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function useHint() {
  if (quiz.hints <= 0 || quiz.phase !== 'ask') return;
  const q = quiz.qs[quiz.i];
  const candidates = q.shown.filter(o => o !== q.answer && !quiz.removed.includes(o) && !quiz.wrong.includes(o));
  if (!candidates.length) return toast('已經沒有可以刪掉的答案了！');
  quiz.removed.push(candidates[Math.floor(Math.random() * candidates.length)]);
  quiz.hints--;
  toast('鶴寶幫你刪掉一個錯的答案！');
  renderQuiz();
}

function nextQuestion() {
  if (quiz.i + 1 < quiz.qs.length) {
    quiz.i++;
    quiz.tries = 0;
    quiz.removed = [];
    quiz.wrong = [];
    quiz.phase = 'ask';
    renderQuiz();
    window.scrollTo(0, 0);
    return;
  }
  quiz.phase = 'done';
  const n = NODE_MAP[quiz.nodeId];
  quiz.newHelper = null;
  if (!state.completed[n.id]) {
    state.completed[n.id] = true;
    if (!state.helpers.includes(n.helper)) {
      state.helpers.push(n.helper);
      state.helpers.sort((a, b) => HELPER_ORDER.indexOf(a) - HELPER_ORDER.indexOf(b));
      quiz.newHelper = n.helper;
    }
    confetti();
  }
  state.best[n.id] = Math.max(state.best[n.id] || 0, quiz.firstTry);
  saveState();
  checkBadges();
  renderQuiz();
}

function renderQuizResult(n) {
  const total = quiz.qs.length;
  const stars = quiz.firstTry === total ? 3 : quiz.firstTry >= Math.ceil(total * 0.6) ? 2 : 1;
  const h = quiz.newHelper ? HELPERS[quiz.newHelper] : null;
  app.innerHTML = `
  <section class="result card">
    <div class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
    <h1>${quiz.replay ? '複習完成！' : '關卡完成！'}</h1>
    <p>第一次就答對 <b>${quiz.firstTry} / ${total}</b> 題，得到 <b>🦢 ${quiz.gained}</b> 隻紙鶴。</p>
    ${h ? `<div class="new-helper">
      ${craneSVG(h.color, 96, 'bob')}
      <p class="nh-title">新夥伴加入：<b>${esc(h.name)}</b></p>
      <p class="muted">能力：${esc(h.power)}｜${esc(h.desc)}</p>
    </div>` : ''}
    <p class="ask">💬 ${esc(n.ask)}</p>
    <div class="row">
      <a class="btn big" href="#/node/${n.id}">回到地點（任務和聊天）</a>
      <a class="btn ghost" href="#/map">回地圖</a>
    </div>
  </section>`;
}

// ===== 時光機（排列時間軸） =====
function startTimeline() {
  timeline = { order: shuffle(TIMELINE.map((_, i) => i)), placed: 0 };
}

function renderTimeline() {
  const slots = TIMELINE.map((ev, i) => i < timeline.placed
    ? `<li class="slot filled"><span class="yr">${esc(ev.year)}</span>${esc(ev.text)}</li>`
    : `<li class="slot">${i + 1}. ？</li>`).join('');
  const remaining = timeline.order.filter(i => i >= timeline.placed);
  const finished = timeline.placed === TIMELINE.length;
  app.innerHTML = `
  <section class="card">
    <h1>⏳ 時光機</h1>
    <p>把下面的事件<b>從最早到最晚</b>依序點選，排出正確的時間軸！${state.timelineDone ? '' : '第一次完成可得 🦢 5 隻紙鶴。'}</p>
    <ol class="slots">${slots}</ol>
    ${finished
      ? `<div class="feedback"><p class="fb-title">🎉 時間軸完成！</p><p>從甲午戰爭到日本投降，剛好 51 年。台灣的日治時期，就在這段時間裡開始和結束。</p><button class="btn" id="btn-tl-restart">再玩一次</button></div>`
      : `<div class="tl-cards">${remaining.map(i => `<button class="tl-card" data-i="${i}">${esc(TIMELINE[i].text)}</button>`).join('')}</div>`}
  </section>`;

  app.querySelectorAll('.tl-card').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    if (i === timeline.placed) {
      timeline.placed++;
      if (timeline.placed === TIMELINE.length) {
        confetti();
        if (!state.timelineDone) {
          state.timelineDone = true;
          addCranes(5);
        }
      }
      renderTimeline();
    } else {
      b.classList.remove('shake');
      void b.offsetWidth;
      b.classList.add('shake');
      toast('還有更早發生的事喔！');
    }
  }));
  const restart = document.getElementById('btn-tl-restart');
  if (restart) restart.addEventListener('click', () => { startTimeline(); renderTimeline(); });
}

// ===== 圖鑑 =====
function renderCollection() {
  const helperCards = NODES.map(n => {
    const h = HELPERS[n.helper];
    const own = state.helpers.includes(n.helper);
    return `<div class="helper-card ${own ? '' : 'unknown'}">
      ${craneSVG(own ? h.color : '#cfc8b8', 64, own ? 'bob' : '')}
      <b>${own ? esc(h.name) : '？？？'}</b>
      <small>${own ? `能力：${esc(h.power)}<br>${esc(h.desc)}` : `完成「${esc(n.name)}」解鎖`}</small>
    </div>`;
  }).join('');
  const badgeCards = BADGES.map(b => {
    const own = state.badges.includes(b.id);
    return `<div class="badge ${own ? '' : 'unknown'}"><span>${own ? b.icon : '❔'}</span><small>${esc(b.name)}</small></div>`;
  }).join('');
  const doneCount = Object.keys(state.completed).length;

  app.innerHTML = `
  <section class="card rank-card">
    <h1>📚 探險圖鑑</h1>
    <p>稱號：<b>${esc(rankName())}</b></p>
    <p>累積得到 🦢 ${state.earned} 隻紙鶴｜完成地點 ${doneCount} / ${NODES.length}</p>
  </section>
  <section class="card">
    <h2>鶴寶夥伴（${state.helpers.length} / ${NODES.length}）</h2>
    <div class="helper-grid">${helperCards}</div>
  </section>
  <section class="card">
    <h2>徽章（${state.badges.length} / ${BADGES.length}）</h2>
    <div class="badge-grid">${badgeCards}</div>
  </section>
  <section class="card">
    <h2>重新開始</h2>
    <p class="muted small">會清除這台裝置上的所有進度，包括紙鶴、鶴寶、徽章和筆記。</p>
    <button class="btn ghost" id="btn-reset">清除進度</button>
  </section>`;

  document.getElementById('btn-reset').addEventListener('click', () => {
    modal('<h3>確定要清除所有進度嗎？</h3><p>清除後無法復原。</p>', '確定清除', () => {
      state = freshState();
      saveState();
      quiz = null;
      timeline = null;
      updateHud();
      toast('進度已清除');
      renderCollection();
    });
  });
}

// ===== 爸媽手冊 =====
function renderParents() {
  const days = PARENT_DAYS.map(d => {
    const nodes = NODES.filter(n => n.day === d.day);
    return `<details class="card day" ${d.day === 1 ? 'open' : ''}>
      <summary><span class="day-tag">Day ${d.day}</span> ${esc(d.title)}</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>時間</th><th>行程</th><th>交通／說明</th></tr></thead>
        <tbody>${d.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="tip">💡 ${esc(d.tip)}</p>
      ${nodes.map(n => `<div class="history">
        <h4>${n.icon} ${esc(n.name)}：歷史講解</h4>
        <p><b>講給孩子聽：</b>${esc(n.story)}</p>
        <ul>${n.parents.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        <p><b>🇹🇼 台灣連結：</b>${esc(n.taiwan)}</p>
        <p><b>💬 問孩子：</b>${esc(n.ask)}</p>
      </div>`).join('')}
    </details>`;
  }).join('');

  const guide = GUIDE.map(g => `<details class="card">
    <summary>${esc(g.title)}</summary>
    <ul>${g.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </details>`).join('');

  const checklist = CHECKLIST.map((c, i) => `<li><label><input type="checkbox" data-ck="${i}" ${state.checklist[i] ? 'checked' : ''}> ${esc(c)}</label></li>`).join('');

  app.innerHTML = `
  <section class="card">
    <h1>👨‍👩‍👦 爸媽手冊</h1>
    <p>廣島 5 天 4 夜親子歷史之旅（2 大 1 小，4 月中旬）。</p>
    <ul>${TRIP_NOTES.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>

  <section class="card">
    <h2>出發前：先建立時間軸</h2>
    <p>在家花 10 分鐘講：「很久以前，日本和清朝打了一場仗，清朝打輸了，就把台灣交給日本。之後 50 年，台灣都是日本統治的。後來日本又去打中國和東南亞，還攻擊美國，就變成了第二次世界大戰。那時候台灣也被捲進戰爭裡。最後日本被兩顆原子彈炸了以後投降，台灣也結束了日本統治。」</p>
    <p>建議讓孩子玩「時光機」，或自己畫一張時間軸帶去日本。</p>
  </section>

  <h2 class="section-title">每日行程與歷史講解</h2>
  ${days}

  <section class="card">
    <h2>🕒 開放時間與休館日一覽</h2>
    <p class="tip">⚠️ 吳市的大和博物館和鐵鯨館每週二休館，D4 不要排在星期二。和平紀念資料館 7:30–8:30 入館要先上官網買 WEB 票。</p>
    ${visitTable(NODES.filter(n => n.visit).flatMap(n => n.visit.places.map(p => ({ ...p, place: `D${n.day}｜${p.place}` }))))}
    <p class="muted small">2026 年 11 月查核各官網。開放時間是 4 月的時段，出發前請再到各地點頁的「官方資訊」確認。</p>
  </section>

  <section class="card">
    <h2>交通總整理</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>路段</th><th>交通工具</th><th>時間</th><th>付款</th></tr></thead>
      <tbody>${TRANSPORT.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="tip">💡 孩子的票：JR 售票機右上角切換英文，選「Child（小児）」。查路線用 Google 地圖的「大眾運輸」。</p>
  </section>

  <h2 class="section-title">行前準備（新手指南）</h2>
  ${guide}

  <section class="card">
    <h2>行前總檢查清單</h2>
    <ul class="checklist">${checklist}</ul>
  </section>

  <details class="card refs">
    <summary>📚 參考資料（全部 ${Object.keys(SOURCES).length} 筆）</summary>
    <ol>${Object.values(SOURCES).map(sourceItem).join('')}</ol>
  </details>

  <details class="card refs">
    <summary>📷 照片來源（${Object.keys(PHOTOS).length} 張，CC 授權）</summary>
    <ol>${Object.values(PHOTOS).map(p => `<li>${esc(p.caption)}<br><small>作者：<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.author)}</a>｜授權：<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>｜來源：Wikimedia Commons，經縮圖</small></li>`).join('')}</ol>
  </details>

  <p class="muted small disclaimer">傷亡人數、少年工人數等為常見概略數字，各資料略有差異；交通時間與價格為估計值。出發前請以各展館、交通公司官網為準。</p>`;

  app.querySelectorAll('[data-ck]').forEach(cb => cb.addEventListener('change', () => {
    state.checklist[cb.dataset.ck] = cb.checked;
    saveState();
  }));
}

// ===== 啟動 =====
window.addEventListener('hashchange', route);
updateHud();
route();
