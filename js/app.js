/* ===========================================================
 * 앱 상태·UI 제어
 * 파싱 → 배치 → 시뮬레이션 상태 계산 → 지도/시간표 갱신 → 재생 제어
 * =========================================================== */
(() => {
  const $ = (id) => document.getElementById(id);
  /* 입력 단계 패널: house(1단계 집 구조), sched(2단계 동선) */
  const panel = (key) => ({
    key,
    panel: $(`${key}-panel`),
    tab: $(`${key}-tab`),
    openBtn: $(`${key}-open`),
    summary: $(`${key}-summary`),
    input: $(`${key}-input`),
    messages: $(`${key}-messages`),
    btnCopy: $(`btn-${key}-copy`),
    btnClear: $(`btn-${key}-clear`),
    btnGenerate: $(`btn-${key}-generate`),
  });
  const P = { house: panel('house'), sched: panel('sched') };
  const els = {
    drawer: $('drawer'),
    drawerBackdrop: $('drawer-backdrop'),
    drawerClose: $('drawer-close'),
    charNames: [$('char-name-a'), $('char-name-b')],
    charColors: [$('char-color-a'), $('char-color-b')],
    map: $('map'),
    mapWrap: $('map-wrap'),
    mapEmpty: $('map-empty'),
    zoomIn: $('zoom-in'),
    zoomOut: $('zoom-out'),
    zoomFit: $('zoom-fit'),
    zoomLevel: $('zoom-level'),
    btnFirst: $('btn-first'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    btnPlay: $('btn-play'),
    slider: $('slider'),
    speed: $('speed'),
    animate: $('opt-animate'),
    autoScroll: $('opt-autoscroll'),
    statusTime: $('status-time'),
    statusStep: $('status-step'),
    subtitles: $('subtitles'),
    mapTransition: $('map-transition'),
    mapTransitionText: $('map-transition-text'),
    tbody: $('timetable-body'),
    timetableWrap: $('timetable-wrap'),
    timetableEmpty: $('timetable-empty'),
    legend: $('legend'),
    floorTabs: $('floor-tabs'),
    houseKind: $('house-kind'),
    eventCount: $('event-count'),
    emptyOpenHouse: $('empty-open-house'),
    schedPromptDesc: $('sched-prompt-desc'),
    schedParts: $('sched-parts'),
  };

  const NAMES_STORAGE_KEY = 'ooc-sim-names';
  const COLORS_STORAGE_KEY = 'ooc-sim-colors';
  const AVATARS_STORAGE_KEY = 'ooc-sim-avatars';
  const WALK_SPEED = 230; // px/초 (BASE_TEMPO 적용 전)
  // 속도 1×의 실제 빠르기. 예전 1×는 생각·대사를 읽기 전에 지나가서 0.75배로 늦췄다
  const BASE_TEMPO = 0.75;
  const readSpeed = () => (Number(els.speed.value) || 1) * BASE_TEMPO;
  const renderer = new MapRenderer.Renderer(els.map);

  const state = {
    house: null,
    data: null,
    layout: null,
    groups: [],
    states: [],
    index: -1,
    playing: false,
    playToken: 0,
    animToken: 0,
    speed: 1,
    animate: true,
    zoom: 1,
    view: 'split', // 'split'(모든 층) 또는 층 번호
  };

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    split: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3.5" y="5" width="7.5" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="5" width="7.5" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- 메시지 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showMessages(p, errors, warnings) {
    const items = [
      ...errors.map((e) => ({ ...e, kind: 'error' })),
      ...warnings.map((w) => ({ ...w, kind: 'warning' })),
    ];
    p.openBtn.classList.toggle('has-error', errors.length > 0);
    p.openBtn.classList.toggle('has-warning', !errors.length && warnings.length > 0);
    if (!items.length) {
      p.messages.hidden = true;
      p.messages.innerHTML = '';
      return;
    }
    const head = errors.length
      ? `<div class="msg-head error">오류 ${errors.length}건 · 고친 뒤 다시 생성하세요</div>`
      : `<div class="msg-head warning">자동으로 고친 곳 ${warnings.length}건 · 그대로 써도 돼요</div>`;
    p.messages.innerHTML = head + items.map((m) => `
      <div class="msg ${m.kind}${m.line ? '' : ' no-line'}">
        ${m.line ? `<button type="button" class="msg-line" data-line="${m.line}">${m.line}줄</button>` : ''}
        <div class="msg-body">
          <div class="msg-text">${escapeHtml(m.message)}</div>
          ${m.value ? `<code class="msg-value">${escapeHtml(m.value)}</code>` : ''}
          ${m.fix ? `<div class="msg-fix">수정: ${escapeHtml(m.fix)}</div>` : ''}
        </div>
      </div>`).join('');
    p.messages.hidden = false;
  }

  function selectLine(p, lineNo) {
    const lines = p.input.value.split('\n');
    if (lineNo < 1 || lineNo > lines.length) return;
    let start = 0;
    for (let i = 0; i < lineNo - 1; i++) start += lines[i].length + 1;
    const end = start + lines[lineNo - 1].length;
    p.input.focus();
    p.input.setSelectionRange(start, end);
    // 선택한 줄이 보이도록 스크롤
    const lineHeight = parseFloat(getComputedStyle(p.input).lineHeight) || 20;
    p.input.scrollTop = Math.max(0, (lineNo - 4) * lineHeight);
  }

  for (const p of Object.values(P)) {
    p.messages.addEventListener('click', (e) => {
      const btn = e.target.closest('.msg-line');
      if (btn && btn.dataset.line) selectLine(p, Number(btn.dataset.line));
    });
  }

  /* ---------- 시뮬레이션 상태 계산 ---------- */
  const MIN_GAP_X = 52; // 이름표 두 개가 나란히 들어가는 간격
  const MIN_GAP_Y = 40;

  /** 같은 방에서 너무 가까운 캐릭터를 좌우로 벌린다. 이번에 움직인 캐릭터만 옮기고 방 밖으로는 안 나가게 한다 */
  function spreadApart(cur, layout) {
    const ids = Object.keys(cur);
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const A = cur[ids[i]];
          const B = cur[ids[j]];
          if (A.room !== B.room) continue;
          const dx = B.point.x - A.point.x;
          if (Math.abs(dx) >= MIN_GAP_X || Math.abs(B.point.y - A.point.y) >= MIN_GAP_Y) continue;
          const need = MIN_GAP_X - Math.abs(dx);
          const dir = dx >= 0 ? 1 : -1;
          const aMoves = !!A.event;
          const bMoves = !!B.event;
          if (!aMoves && !bMoves) continue;
          const share = aMoves && bMoves ? need / 2 : need;
          const room = layout.rooms.get(A.room);
          const clampX = (x) => Math.max(room.x + 22, Math.min(room.x + room.w - 22, x));
          if (aMoves) A.point = { x: clampX(A.point.x - dir * share), y: A.point.y };
          if (bMoves) B.point = { x: clampX(B.point.x + dir * share), y: B.point.y };
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  function buildSimulation(data, layout) {
    const groups = [];
    for (const ev of data.schedule) {
      const last = groups[groups.length - 1];
      if (last && last.time === ev.time) last.events.push(ev);
      else groups.push({ time: ev.time, events: [ev] });
    }
    const charIndex = new Map(data.characters.map((c, i) => [c.id, i]));
    const n = data.characters.length;
    const states = [];
    let prev = {};
    for (const g of groups) {
      const cur = {};
      for (const [id, s] of Object.entries(prev)) {
        cur[id] = { room: s.room, point: s.point, base: s.base, path: null, event: null };
      }
      // 1) 이번에 움직이는 캐릭터의 목적 지점
      for (const ev of g.events) {
        const roomName = ev.route ? ev.route[ev.route.length - 1] : ev.room;
        const room = layout.rooms.get(roomName);
        const offset = (charIndex.get(ev.charId) - (n - 1) / 2) * 20;
        const anchor = HouseLayout.anchorFor(room, ev.action);
        // base: 행동이 정한 원래 자리(겹침 피하기로 비켜서기 전). 끊긴 이동 판단에 쓴다
        const base = { x: anchor.x + offset, y: anchor.y };
        cur[ev.charId] = { room: roomName, point: { ...base }, base, path: null, event: ev, spot: anchor.furniture };
      }
      // 2) 마커·이름표가 겹치지 않도록 너무 가까운 캐릭터를 좌우로 벌린다 (가만히 있는 캐릭터는 그대로)
      spreadApart(cur, layout);
      // 3) 이동 경로와 "끊긴 이동(jump)" 표시.
      //    AI가 A>B>C로 적은 이동은 그냥 걷는다. AI가 적지 않았는데 위치가 바뀐 경우는 모두 jump:
      //    같은 방에서 자리만 바뀜(거실 가운데 → 소파), 직전 위치와 다른 곳에서 시작해 파서가 경로를 채운 줄(ev.implicit).
      //    jump는 재생 때 화면 조정 카드("n분 후")를 띄운 뒤 부드럽게 옮긴다. 처음 등장하는 캐릭터는 서서히 나타난다.
      for (const ev of g.events) {
        const s = cur[ev.charId];
        const before = prev[ev.charId];
        if (!before) s.appear = true;
        if (!ev.route) {
          const dist = before ? Math.hypot(before.point.x - s.point.x, before.point.y - s.point.y) : 0;
          if (dist > 2) {
            s.path = HouseLayout.buildRoute(layout, before.point, [s.room], s.point);
            s.inRoom = true;
            // 행동이 정한 자리 자체가 바뀌었을 때만(거실 가운데 → 소파) 끊긴 이동.
            // 옆 사람에게 비켜 주느라 조금 움직인 것은 카드 없이 미끄러지기만 한다
            s.jump = Math.hypot(before.base.x - s.base.x, before.base.y - s.base.y) > 2;
          }
          continue;
        }
        const startRoom = layout.rooms.get(ev.route[0]);
        const offset = (charIndex.get(ev.charId) - (n - 1) / 2) * 20;
        const from = before ? before.point : { x: startRoom.cx + offset, y: startRoom.cy };
        s.path = HouseLayout.buildRoute(layout, from, ev.route, s.point);
        s.jump = !!ev.implicit;
      }
      states.push(cur);
      prev = cur;
    }
    return { groups, states };
  }

  /* ---------- 생성 ---------- */
  /** 동선만 지운다. 집 지도는 남겨 둔다 */
  function clearSimulation() {
    stopPlayback();
    cancelAnimation();
    state.data = null;
    state.groups = [];
    state.states = [];
    state.index = -1;
    els.tbody.innerHTML = '';
    els.legend.innerHTML = '';
    els.timetableEmpty.hidden = false;
    els.eventCount.textContent = '';
    if (state.layout) renderMap([]);
    setControlsEnabled(false);
    updateStatus();
  }

  /** 집과 동선을 모두 지운다 */
  function clearHouse() {
    clearSimulation();
    renderer.clear();
    state.house = null;
    state.layout = null;
    state.view = 'split';
    els.houseKind.textContent = '';
    renderFloorTabs();
    els.mapEmpty.hidden = false;
    els.map.removeAttribute('style');
    setZoomEnabled(false);
    setScheduleEnabled(false);
  }

  function setScheduleEnabled(on) {
    P.sched.btnGenerate.disabled = !on || !P.sched.input.value.trim();
    updateParts();
  }

  /* ---------- 입력 사이드바 ---------- */
  function openDrawer(p, focus = false) {
    for (const q of Object.values(P)) {
      const on = q === p;
      q.panel.hidden = !on;
      q.tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.drawerBackdrop.hidden = false;
    if (focus) p.input.focus();
  }
  function closeDrawer() {
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.drawerBackdrop.hidden = true;
  }
  const drawerOpen = () => els.drawer.classList.contains('open');
  function updateSummaries() {
    // 답변 칸이 비어 있으면 생성 버튼을 끈다(빈 칸으로 검사하지 않도록)
    P.house.btnGenerate.disabled = !P.house.input.value.trim();
    P.sched.btnGenerate.disabled = !state.house || !P.sched.input.value.trim();
    updateParts();
    P.house.openBtn.classList.toggle('done', !!state.house);
    P.sched.openBtn.classList.toggle('done', !!state.data);
    if (state.house) {
      const h = state.house.house;
      P.house.summary.textContent = `공간 ${h.rooms.length}${h.floors.length > 1 ? ` · ${h.floors.length}개 층` : ''} · 연결 ${h.connections.length}`;
    } else {
      P.house.summary.textContent = P.house.input.value.trim() ? '생성 전' : '입력 필요';
    }
    if (state.data) {
      P.sched.summary.textContent = `이벤트 ${state.data.schedule.length}개${state.data.warnings.length ? ' · 자동 보정' : ''}`;
    } else if (!state.house) {
      P.sched.summary.textContent = '집 먼저';
    } else {
      P.sched.summary.textContent = P.sched.input.value.trim() ? '생성 전' : '입력 필요';
    }
  }
  for (const p of Object.values(P)) {
    p.openBtn.addEventListener('click', () => openDrawer(p, true));
    p.tab.addEventListener('click', () => openDrawer(p, true));
  }
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerBackdrop.addEventListener('click', closeDrawer);
  els.emptyOpenHouse.addEventListener('click', () => openDrawer(P.house, true));

  /** 예시로 보기: 시연용 집·하루 동선·이름을 채우고 바로 생성한다 (DEMO는 example.js) */
  function loadDemo() {
    DEMO.names.forEach((n, i) => { els.charNames[i].value = n; });
    onCharacterInput();
    P.house.input.value = DEMO.house;
    generateHouse();
    P.sched.input.value = DEMO.schedule;
    generateSchedule();
    updateSummaries();
  }
  $('empty-demo').addEventListener('click', loadDemo);
  $('btn-house-demo').addEventListener('click', loadDemo);

  /* 1단계: 집 구조 → 지도 */
  function generateHouse() {
    const result = OOCParser.parseHouse(P.house.input.value);
    if (result.errors.length) {
      clearHouse();
      showMessages(P.house, result.errors, result.warnings);
      updateSummaries();
      openDrawer(P.house);
      return;
    }
    clearSimulation();
    const layout = HouseLayout.compute(result.house);
    state.house = result;
    state.layout = layout;
    const floors = layout.floors || [];
    state.view = floors.length > 1 ? (floors.find((f) => f.floor === 1) || floors[0]).floor : 'split';
    const kind = result.house.meta.find((m) => /주거|형태|유형/.test(m.key));
    els.houseKind.textContent = kind ? kind.value : '';
    renderFloorTabs();
    renderMap([]);
    const warnings = [...result.warnings, ...layout.warnings];
    showMessages(P.house, [], warnings);
    showMessages(P.sched, [], []);
    els.mapEmpty.hidden = true;
    setZoomEnabled(true);
    setScheduleEnabled(true);
    fitZoom();
    updateSummaries();
    // 경고가 있으면 집 구조 탭에 남고, 없으면 다음 단계(동선) 탭으로 넘어간다
    openDrawer(warnings.length ? P.house : P.sched);
  }

  /* 2단계: 캐릭터·동선 → 시뮬레이션 */
  function generateSchedule() {
    if (!state.house) return;
    const result = OOCParser.parseSchedule(P.sched.input.value, state.house.house, { names: getNames() });
    if (result.errors.length) {
      clearSimulation();
      showMessages(P.sched, result.errors, result.warnings);
      updateSummaries();
      openDrawer(P.sched);
      return;
    }
    stopPlayback();
    cancelAnimation();
    for (const c of result.characters) c.origName = c.name;
    applyNames(result.characters);
    const sim = buildSimulation(result, state.layout);
    state.data = result;
    state.groups = sim.groups;
    state.states = sim.states;
    state.index = -1;

    renderMap(result.characters);
    renderTimetable();
    renderLegend();
    showMessages(P.sched, [], result.warnings);
    updateSummaries();
    // 자동 보정 안내는 생성을 막지 않는다: 지도를 바로 보여 주고, 내용은 동선 탭에 남긴다
    closeDrawer();
    els.timetableEmpty.hidden = true;
    els.slider.max = String(state.groups.length - 1);
    setControlsEnabled(true);
    goTo(0, false);
  }

  /* ---------- 시간표 ---------- */
  function renderTimetable() {
    const charMap = new Map(state.data.characters.map((c) => [c.id, c]));
    const rows = [];
    state.groups.forEach((g, gi) => {
      g.events.forEach((ev, ei) => {
        const ch = charMap.get(ev.charId);
        const say = ev.say
          ? `<div class="say ${ev.say.kind}">${ev.say.kind === 'thought' ? `(${escapeHtml(ev.say.text)})` : `“${escapeHtml(ev.say.text)}”`}</div>`
          : '';
        rows.push(`
          <tr data-group="${gi}" class="${ei === 0 ? 'group-start' : 'group-cont'}">
            <td class="col-time">${ei === 0 ? g.time : `<span class="same-time">〃</span>`}</td>
            <td class="col-char">${charDot(ch)}${escapeHtml(ch.name)}</td>
            <td class="col-action">${escapeHtml(ev.action)}${say}</td>
          </tr>`);
      });
    });
    els.tbody.innerHTML = rows.join('');
    els.eventCount.textContent = `${state.data.schedule.length}개`;
  }

  /* ---------- 유저가 정하는 캐릭터 이름·색·이미지 ---------- */
  const getNames = () => els.charNames.map((i) => i.value.trim());
  const getColors = () => els.charColors.map((i) => i.value);
  // 마커 이미지(data URL). 없으면 색 동그라미
  const avatars = [null, null];

  /** 입력한 이름·색·이미지(PC, NPC 칸)로 표시를 덮어쓴다. ID가 PC/NPC면 그 칸, 아니면 순서대로.
      이름 칸을 비우면 OOC의 이름으로 돌아간다. 색은 항상 유저가 고른 색을 쓴다 */
  function applyNames(chars) {
    const names = getNames();
    const colors = getColors();
    const slot = { PC: 0, NPC: 1 };
    chars.forEach((c, i) => {
      const k = slot[c.id.toUpperCase()] ?? i;
      c.name = names[k] || c.origName;
      if (colors[k]) c.color = colors[k];
      c.avatar = avatars[k] || null;
    });
  }

  /**
   * 이미지 파일 → 160px 정사각 캔버스에 비율 그대로(자르지 않고) 아래 가운데에 붙인 PNG data URL.
   * 투명 배경은 그대로 남아서 지도에는 캐릭터 그림만 보인다. 크기를 줄여 저장 용량을 아낀다.
   */
  function loadAvatar(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const SIZE = 160;
        const scale = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        canvas.getContext('2d').drawImage(img, (SIZE - w) / 2, SIZE - h, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
      img.src = url;
    });
  }

  /** 이미지 칸 표시: 넣었으면 미리보기 + 빼기(×), 아니면 빈 칸 아이콘 */
  function updateAvatarButtons() {
    document.querySelectorAll('.avatar-btn').forEach((btn) => {
      const k = Number(btn.dataset.slot);
      const has = !!avatars[k];
      btn.classList.toggle('has-image', has);
      btn.style.backgroundImage = has ? `url("${avatars[k]}")` : '';
      document.querySelector(`.avatar-clear[data-slot="${k}"]`).hidden = !has;
    });
  }

  document.querySelectorAll('.avatar-btn').forEach((btn) => {
    btn.addEventListener('click', () => document.querySelector(`.avatar-file[data-slot="${btn.dataset.slot}"]`).click());
  });
  document.querySelectorAll('.avatar-file').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try {
        avatars[Number(input.dataset.slot)] = await loadAvatar(file);
        onCharacterInput();
      } catch (err) {
        alert(err.message);
      }
    });
  });
  document.querySelectorAll('.avatar-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      avatars[Number(btn.dataset.slot)] = null;
      onCharacterInput();
    });
  });

  /** 범례·시간표용 작은 표시: 이미지가 있으면 동그란 이미지, 없으면 색 점 */
  const charDot = (c) => (c.avatar
    ? `<img class="avatar-dot" src="${c.avatar}" alt="">`
    : `<span class="dot" style="background:${c.color}"></span>`);

  let namesTimer = null;
  function onCharacterInput() {
    updateAvatarButtons();
    clearTimeout(namesTimer);
    namesTimer = setTimeout(() => {
      try {
        localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(getNames()));
        localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(getColors()));
        localStorage.setItem(AVATARS_STORAGE_KEY, JSON.stringify(avatars));
      } catch (_) { /* 저장 공간이 모자라면 이번 화면에서만 쓴다 */ }
      if (!state.data) return;
      // 이미 생성된 동선이면 지도·시간표·범례에 바로 반영한다
      applyNames(state.data.characters);
      renderMap(state.data.characters);
      renderTimetable();
      renderLegend();
      goTo(Math.max(0, state.index), false);
    }, 150);
  }
  for (const input of [...els.charNames, ...els.charColors]) input.addEventListener('input', onCharacterInput);

  function renderLegend() {
    els.legend.innerHTML = state.data.characters.map((c) =>
      `<span class="legend-item">${charDot(c)}${escapeHtml(c.name)}</span>`).join('');
  }

  els.tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-group]');
    if (!tr) return;
    stopPlayback();
    goTo(Number(tr.dataset.group), false);
  });

  function updateTimetableHighlight() {
    let firstCurrent = null;
    for (const tr of els.tbody.querySelectorAll('tr[data-group]')) {
      const gi = Number(tr.dataset.group);
      const isCur = gi === state.index;
      tr.classList.toggle('current', isCur);
      tr.classList.toggle('past', gi < state.index);
      if (isCur && !firstCurrent) firstCurrent = tr;
    }
    if (firstCurrent && els.autoScroll.checked) {
      const wrap = els.timetableWrap;
      const top = firstCurrent.offsetTop;
      const bottom = top + firstCurrent.offsetHeight;
      if (top < wrap.scrollTop + 40 || bottom > wrap.scrollTop + wrap.clientHeight - 20) {
        wrap.scrollTo({ top: Math.max(0, top - wrap.clientHeight / 3), behavior: state.animate ? 'smooth' : 'auto' });
      }
    }
  }

  /* ---------- 상태 표시 ---------- */
  function updateStatus() {
    if (!state.groups.length || state.index < 0) {
      els.statusTime.textContent = '--:--';
      els.statusStep.textContent = '0 / 0';
      els.subtitles.innerHTML = '';
      els.slider.value = 0;
      els.slider.style.setProperty('--pct', '0%');
      return;
    }
    const g = state.groups[state.index];
    els.statusTime.textContent = g.time;
    els.statusStep.textContent = `${state.index + 1} / ${state.groups.length}`;
    els.slider.value = String(state.index);
    const pct = state.groups.length > 1 ? (state.index / (state.groups.length - 1)) * 100 : 100;
    els.slider.style.setProperty('--pct', `${pct}%`);
  }

  function setControlsEnabled(on) {
    for (const b of [els.btnFirst, els.btnPrev, els.btnNext, els.btnPlay, els.slider]) {
      b.disabled = !on;
    }
    updatePlayButton();
  }

  function setZoomEnabled(on) {
    for (const b of [els.zoomIn, els.zoomOut, els.zoomFit]) b.disabled = !on;
  }

  function updatePlayButton() {
    els.btnPlay.innerHTML = state.playing ? ICONS.pause : ICONS.play;
    els.btnPlay.setAttribute('aria-label', state.playing ? '일시정지' : '자동 재생');
    els.btnPlay.title = state.playing ? '일시정지 (Space)' : '자동 재생 (Space)';
    els.btnPlay.classList.toggle('playing', state.playing);
  }

  /* ---------- 위치 이동 ---------- */
  function cancelAnimation() {
    state.animToken += 1;
    if (state.data) for (const ch of state.data.characters) renderer.setMoving(ch.id, false);
  }

  async function goTo(index, animate) {
    if (!state.groups.length) return;
    index = Math.max(0, Math.min(state.groups.length - 1, index));
    cancelAnimation();
    const useAnim = animate && state.animate && index === state.index + 1;
    // 화면 조정 카드: 끊긴 이동(jump)이 있거나 시간이 한 시간 이상 건너뛸 때 "n분 후" 카드를 띄운 뒤 부드럽게 옮긴다
    const gap = index > 0 ? state.groups[index].events[0].minutes - state.groups[index - 1].events[0].minutes : 0;
    const jumps = Object.values(state.states[index]).some((s) => s.jump && s.event);
    state.index = index;
    if (useAnim && gap > 0 && (gap >= 60 || jumps)) {
      const token = state.animToken;
      await showTransition(`⏩ ${formatGap(gap)} 후 · ${state.groups[index].time}`, 1100 / state.speed);
      if (token !== state.animToken) return;
    }
    updateTimetableHighlight();
    updateStatus();

    const st = state.states[index];
    const group = state.groups[index];
    renderer.setActive(group.events.map((e) => e.charId));
    renderer.highlightRooms(group.events.map((e) => (e.route ? e.route[e.route.length - 1] : e.room)));
    renderer.clearRoutes();
    renderer.hideBubbles();
    els.subtitles.innerHTML = '';

    const moving = [];
    // 대사·생각은 적힌 순서대로 하나씩 이어서 띄운다 (행동은 지도 아래 자막)
    const showBubbles = async () => {
      const token = state.animToken;
      const speaking = group.events.filter((ev) => ev.say && st[ev.charId] && st[ev.charId].event === ev);
      for (let i = 0; i < speaking.length; i++) {
        const ev = speaking[i];
        if (i > 0 && state.animate) {
          await sleep(readingTime(speaking[i - 1]) / state.speed);
          if (token !== state.animToken) return;
        }
        renderer.showBubble(ev.charId, { text: bubbleText(ev.say), kind: ev.say.kind });
        renderer.arrangeBubbles();
      }
      // 자동 재생 중이면 마지막 대사를 읽을 시간을 준 뒤 다음으로 넘어간다
      if (speaking.length && state.playing && state.animate) await sleep(readingTime(speaking[speaking.length - 1]) / state.speed);
    };
    for (const ch of state.data.characters) {
      const s = st[ch.id];
      if (s && s.path && s.path.length > 1) {
        if (!s.inRoom) renderer.showRoute(ch.id, s.path); // 방 안 자리 옮김은 경로선 없이
        if (useAnim) {
          moving.push({ id: ch.id, path: s.path });
          if (s.appear && s.event) renderer.appear(ch.id);
          continue;
        }
      }
      renderer.setPosition(ch.id, s ? s.point : null);
      if (useAnim && s && s.appear && s.event) renderer.appear(ch.id);
    }
    updateFloorWho(st);
    // 한 층만 보는 중이면 이번 이벤트가 일어나는 층으로 넘어간다
    if (moving.length) followPoint(moving[0].path[0]);
    else if (st[group.events[0].charId]) followPoint(st[group.events[0].charId].point);
    // 자막 순서: 걷는 사람의 행동은 걷는 동안, 제자리에서 하는 행동은 걷는 사람이 도착한 뒤에
    // (예: 데인이 침실로 오는 동안 "유노 매달리기"가 먼저 뜨지 않게)
    const events = group.events.filter((ev) => st[ev.charId] && st[ev.charId].event === ev);
    if (moving.length) {
      const movingIds = new Set(moving.map((m) => m.id));
      showSubtitles(events.filter((ev) => movingIds.has(ev.charId)));
      const token = state.animToken;
      await animatePaths(moving);
      if (token !== state.animToken) return; // 중간에 취소됨
    }
    showSubtitles(events);
    await showBubbles();
  }

  /** 행동 자막(영화 자막처럼 지도 아래). 이미 떠 있는 줄은 그대로 두고 새 줄만 덧붙인다 */
  function showSubtitles(events) {
    const charMap = new Map(state.data.characters.map((c) => [c.id, c]));
    for (const ev of events) {
      const key = `${ev.line}`;
      if (els.subtitles.querySelector(`[data-key="${key}"]`)) continue;
      const div = document.createElement('div');
      div.className = 'subtitle';
      div.dataset.key = key;
      div.innerHTML = `<span class="who">${escapeHtml(charMap.get(ev.charId).name)}</span>${escapeHtml(ev.action)}`;
      els.subtitles.appendChild(div);
    }
  }

  /** 90 → "1시간 30분", 45 → "45분" */
  function formatGap(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return [h ? `${h}시간` : '', m ? `${m}분` : ''].filter(Boolean).join(' ');
  }

  /** 화면 전환 카드: 띄운 뒤 midFn(층 바꾸기 등)을 실행하고 잠시 후 걷는다 */
  async function showTransition(text, ms, midFn) {
    els.mapTransitionText.textContent = text;
    els.mapTransition.classList.add('show');
    await sleep(220);
    if (midFn) midFn();
    await sleep(Math.max(250, ms - 220));
    els.mapTransition.classList.remove('show');
    await sleep(200);
  }

  /** 대사 하나를 읽는 데 주는 시간(ms, 1× 기준) */
  const readingTime = (ev) => Math.max(900, Math.min(2600, 500 + bubbleText(ev.say).length * 45));

  /** 말풍선에 띄울 대사. "English. (한국어.)" 꼴이면 한국어만 (시간표에는 전부 남는다) */
  function bubbleText(say) {
    const m = say.text.match(/^(.*?)\s*[(（]([^()（）]*[가-힣][^()（）]*)[)）]\s*$/);
    if (m && /[A-Za-z]/.test(m[1]) && !/[가-힣]/.test(m[1])) return m[2].trim();
    return say.text;
  }

  // jump 점(층간 계단)으로 가는 구간은 길이 0: 그 자리에서 다른 층으로 옮겨 간다
  const segLength = (a, b) => (b.jump ? 0 : Math.hypot(b.x - a.x, b.y - a.y));

  function polylineLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += segLength(pts[i - 1], pts[i]);
    return len;
  }

  function pointAt(pts, dist) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = segLength(pts[i - 1], pts[i]);
      if (seg === 0) continue;
      if (acc + seg >= dist) {
        const t = seg === 0 ? 0 : (dist - acc) / seg;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  function animatePaths(moving) {
    const token = state.animToken;
    const items = moving.map((m) => {
      const len = polylineLength(m.path);
      const duration = Math.max(500, Math.min(3200, (len / WALK_SPEED) * 1000)) / state.speed;
      renderer.setMoving(m.id, true);
      renderer.setPosition(m.id, m.path[0]);
      return { ...m, len, duration };
    });
    const total = Math.max(...items.map((i) => i.duration));
    const t0 = performance.now();
    return new Promise((resolve) => {
      const frame = (now) => {
        if (token !== state.animToken) { resolve(); return; }
        const elapsed = now - t0;
        let done = true;
        for (const it of items) {
          const p = Math.min(1, elapsed / it.duration);
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          const pos = pointAt(it.path, it.len * eased);
          renderer.setPosition(it.id, pos);
          // 따라가는 캐릭터가 계단으로 다른 층에 들어서면 멈추지 않고 그 층으로 바로 넘어간다
          const f = it === items[0] && state.view !== 'split' ? floorAtPoint(pos) : null;
          if (f && f.floor !== state.view) setView(f.floor);
          if (p < 1) done = false;
          else renderer.setMoving(it.id, false);
        }
        if (done || elapsed >= total) {
          for (const it of items) { renderer.setPosition(it.id, it.path[it.path.length - 1]); renderer.setMoving(it.id, false); }
          resolve();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  /* ---------- 자동 재생 ---------- */
  async function play() {
    if (state.playing || !state.groups.length) return;
    if (state.index >= state.groups.length - 1) await goTo(0, false);
    state.playing = true;
    updatePlayButton();
    const token = ++state.playToken;
    while (state.playing && token === state.playToken && state.index < state.groups.length - 1) {
      await goTo(state.index + 1, true);
      if (!state.playing || token !== state.playToken) break;
      await sleep((state.animate ? 900 : 1400) / state.speed);
    }
    if (token === state.playToken) {
      state.playing = false;
      updatePlayButton();
    }
  }

  function stopPlayback() {
    if (!state.playing) return;
    state.playing = false;
    state.playToken += 1;
    updatePlayButton();
  }

  /* ---------- 확대/축소 ---------- */
  function applyZoom() {
    if (!state.layout) return;
    const r = viewRect();
    els.map.style.width = `${Math.round(r.w * state.zoom)}px`;
    els.map.style.height = `${Math.round(r.h * state.zoom)}px`;
    els.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setZoom(z) {
    state.zoom = Math.max(0.3, Math.min(3, z));
    applyZoom();
  }

  function fitZoom() {
    if (!state.layout) return;
    const r = viewRect();
    const availW = els.mapWrap.clientWidth - 32;
    // 좁은 화면에서는 지도 칸 높이가 내용을 따라가므로 화면 높이 기준으로 맞춘다
    const narrow = window.matchMedia('(max-width: 560px)').matches;
    const availH = narrow ? window.innerHeight * 0.62 - 32 : Math.max(260, els.mapWrap.clientHeight - 32);
    setZoom(Math.min(availW / r.w, availH / r.h, 1.4));
  }

  /* ---------- 층 보기: 층 탭(한 층씩) / 분할(모든 층 나란히) ---------- */
  const floorsOf = () => (state.layout && state.layout.floors) || [];

  /** 지금 보여 줄 SVG 영역 */
  function viewRect() {
    const L = state.layout;
    const f = state.view === 'split' ? null : floorsOf().find((x) => x.floor === state.view);
    if (!f) return { x: 0, y: 0, w: L.width, h: L.height };
    const m = 20;
    return { x: f.x - m, y: f.y + f.labelH - m, w: f.w + m * 2, h: f.h - f.labelH + m * 2 };
  }

  function renderMap(characters) {
    renderer.render(state.layout, characters);
    applyView();
  }

  function applyView() {
    if (!state.layout) return;
    const r = viewRect();
    els.map.setAttribute('viewBox', `${r.x} ${r.y} ${r.w} ${r.h}`);
    els.map.classList.toggle('single-floor', state.view !== 'split');
    applyZoom();
    renderer.arrangeBubbles(); // 보이는 영역이 바뀌면 말풍선을 다시 안쪽으로
  }

  function setView(view) {
    if (state.view === view) return;
    state.view = view;
    for (const b of els.floorTabs.querySelectorAll('.floor-tab')) {
      b.setAttribute('aria-selected', b.dataset.view === String(view) ? 'true' : 'false');
    }
    applyView();
    fitZoom();
  }

  function renderFloorTabs() {
    const floors = floorsOf();
    els.floorTabs.hidden = floors.length < 2;
    if (floors.length < 2) { els.floorTabs.innerHTML = ''; return; }
    els.floorTabs.innerHTML = floors.map((f) =>
      `<button type="button" role="tab" class="floor-tab" data-view="${f.floor}" aria-selected="${state.view === f.floor}">${escapeHtml(f.label)}<span class="who"></span></button>`).join('')
      + `<span class="floor-sep" aria-hidden="true"></span><button type="button" role="tab" class="floor-tab split" data-view="split" aria-selected="${state.view === 'split'}" title="모든 층 나란히 보기">${ICONS.split}분할</button>`;
  }
  els.floorTabs.addEventListener('click', (e) => {
    const b = e.target.closest('.floor-tab');
    if (b) setView(b.dataset.view === 'split' ? 'split' : Number(b.dataset.view));
  });

  /** 층 탭마다 지금 그 층에 있는 캐릭터 색 점을 표시 */
  function updateFloorWho(st) {
    if (els.floorTabs.hidden || !state.data) return;
    for (const b of els.floorTabs.querySelectorAll('.floor-tab:not(.split)')) {
      const level = Number(b.dataset.view);
      b.querySelector('.who').innerHTML = state.data.characters
        .filter((c) => st[c.id] && state.layout.rooms.get(st[c.id].room).level === level)
        .map((c) => `<span class="dot" style="background:${c.color}" title="${escapeHtml(c.name)}"></span>`).join('');
    }
  }

  /** 한 층만 보는 중일 때 좌표가 다른 층에 있으면 그 층으로 넘긴다 */
  function followPoint(pt) {
    if (state.view === 'split' || !pt) return;
    const f = floorAtPoint(pt);
    if (f && f.floor !== state.view) setView(f.floor);
  }

  const floorAtPoint = (pt) => floorsOf().find((x) => pt.x >= x.x && pt.x <= x.x + x.w && pt.y >= x.y && pt.y <= x.y + x.h);


  /* ---------- 이벤트 바인딩 ---------- */
  P.house.btnGenerate.addEventListener('click', generateHouse);
  P.sched.btnGenerate.addEventListener('click', generateSchedule);

  /* OOC 복사: AI에게 붙여넣을 OOC를 클립보드로 */
  const copyTimers = new Map();
  function copyFeedback(btn, ok) {
    clearTimeout(copyTimers.get(btn));
    // 구간 버튼은 상태 줄만 바꾸고, 일반 버튼은 글자 전체를 바꾼다
    const target = btn.querySelector('.part-state') || btn;
    if (!target.dataset.label) target.dataset.label = target.textContent;
    target.textContent = ok ? '복사됨 ✓' : '복사 실패';
    btn.classList.toggle('copied', ok);
    copyTimers.set(btn, setTimeout(() => {
      target.textContent = target.dataset.label;
      delete target.dataset.label;
      btn.classList.remove('copied');
    }, 1600));
  }
  async function copyText(btn, text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copyFeedback(btn, true);
        return;
      }
    } catch (_) { /* 아래 대체 방식 시도 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      copyFeedback(btn, ok);
    } catch (_) {
      copyFeedback(btn, false);
    }
  }
  P.house.btnCopy.addEventListener('click', () => copyText(P.house.btnCopy, HOUSE_TEMPLATE));

  /* ---------- 동선 OOC: 오전 / 오후 / 저녁 ---------- */
  els.schedParts.innerHTML = DAY_PARTS.map((part) => `
    <button type="button" class="part-btn" data-part="${part.key}" disabled>
      <span class="part-name">${part.label}</span>
      <span class="part-range">${part.range}</span>
      <span class="part-state">복사</span>
    </button>`).join('');

  /** 붙여넣은 답에 들어 있는 시각(분) 목록 */
  function pastedMinutes() {
    const out = [];
    for (const line of P.sched.input.value.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:[-•*·]\s*)?(\d{1,2}):([0-5]\d)\s*\|/);
      if (m) out.push(Number(m[1]) * 60 + Number(m[2]));
    }
    return out;
  }

  /** 구간 버튼 상태: 집이 없으면 끔, 그 구간 시각이 붙여넣어져 있으면 완료 표시 */
  function updateParts() {
    const mins = pastedMinutes();
    for (const btn of els.schedParts.querySelectorAll('.part-btn')) {
      const part = DAY_PARTS.find((p) => p.key === btn.dataset.part);
      const done = mins.some((m) => m >= part.from && m < part.to);
      btn.disabled = !state.house;
      btn.classList.toggle('done', done);
      const st = btn.querySelector('.part-state');
      if (!st.dataset.label) st.textContent = done ? '붙여넣음 ✓' : '복사';
    }
    els.schedPromptDesc.hidden = !!state.house;
  }

  /** 이 구간 전까지 붙여넣은 동선에서 캐릭터별 마지막 공간 (다음 구간 OOC의 시작 위치) */
  function startsBefore(part) {
    if (!state.house || part.from === 0) return {};
    const parsed = OOCParser.parseSchedule(P.sched.input.value, state.house.house, { names: getNames() });
    const starts = {};
    for (const ev of parsed.schedule) {
      if (ev.invalid || ev.minutes >= part.from) continue;
      starts[ev.charId] = ev.route ? ev.route[ev.route.length - 1] : ev.room;
    }
    return starts;
  }

  els.schedParts.addEventListener('click', (e) => {
    const btn = e.target.closest('.part-btn');
    if (!btn || !state.house) return;
    const part = DAY_PARTS.find((p) => p.key === btn.dataset.part);
    copyText(btn, buildScheduleTemplate(state.house.house, getNames(), part, startsBefore(part)));
  });
  P.house.btnClear.addEventListener('click', () => {
    P.house.input.value = '';
    clearHouse();
    showMessages(P.house, [], []);
    showMessages(P.sched, [], []);
    updateSummaries();
    openDrawer(P.house, true);
  });
  P.sched.btnClear.addEventListener('click', () => {
    P.sched.input.value = '';
    clearSimulation();
    showMessages(P.sched, [], []);
    updateSummaries();
    openDrawer(P.sched, true);
  });

  els.btnFirst.addEventListener('click', () => { stopPlayback(); goTo(0, false); });
  els.btnPrev.addEventListener('click', () => { stopPlayback(); goTo(state.index - 1, false); });
  els.btnNext.addEventListener('click', () => { stopPlayback(); goTo(state.index + 1, true); });
  els.btnPlay.addEventListener('click', () => { if (state.playing) stopPlayback(); else play(); });
  els.slider.addEventListener('input', () => { stopPlayback(); goTo(Number(els.slider.value), false); });
  els.speed.addEventListener('change', () => { state.speed = readSpeed(); });
  els.animate.addEventListener('change', () => { state.animate = els.animate.checked; });

  els.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.2));
  els.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.2));
  els.zoomFit.addEventListener('click', fitZoom);
  window.addEventListener('resize', () => { if (state.layout) fitZoom(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen()) { closeDrawer(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select' || drawerOpen() || !state.groups.length) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stopPlayback(); goTo(state.index + 1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlayback(); goTo(state.index - 1, false); }
    else if (e.key === 'Home') { e.preventDefault(); stopPlayback(); goTo(0, false); }
    else if (e.key === 'End') { e.preventDefault(); stopPlayback(); goTo(state.groups.length - 1, false); }
    else if (e.key === ' ') { e.preventDefault(); if (state.playing) stopPlayback(); else play(); }
  });

  // AI 답변 칸은 매번 빈 칸에서 시작한다. 검사는 생성 버튼을 눌렀을 때만 한다
  for (const p of Object.values(P)) p.input.addEventListener('input', updateSummaries);

  /* ---------- 초기화 ---------- */
  (function init() {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.animate.checked = !reduced;
    state.animate = !reduced;
    state.speed = readSpeed();
    // 예전 버전이 저장해 둔 입력 칸 내용은 지운다
    try { ['ooc-sim-input', 'ooc-sim-house', 'ooc-sim-schedule'].forEach((k) => localStorage.removeItem(k)); } catch (_) { /* 무시 */ }
    try {
      const names = JSON.parse(localStorage.getItem(NAMES_STORAGE_KEY) || '[]');
      els.charNames.forEach((input, i) => { input.value = names[i] || ''; });
      const colors = JSON.parse(localStorage.getItem(COLORS_STORAGE_KEY) || '[]');
      els.charColors.forEach((input, i) => { if (/^#[0-9a-f]{6}$/i.test(colors[i] || '')) input.value = colors[i]; });
      const saved = JSON.parse(localStorage.getItem(AVATARS_STORAGE_KEY) || '[]');
      saved.forEach((url, i) => { if (i < avatars.length && /^data:image\//.test(url || '')) avatars[i] = url; });
    } catch (_) { /* 무시 */ }
    updateAvatarButtons();
    setControlsEnabled(false);
    setZoomEnabled(false);
    setScheduleEnabled(false);
    updateStatus();
    updateSummaries();
  })();
})();
