/* ===========================================================
 * 집 자동 배치 (평면도 방식)
 * 방·연결 그래프 → 벽을 맞댄 방 사각형, 벽에 난 문, 가구, 이동 경로
 *
 * 방식
 *  1. 연결이 가장 많은 방(보통 거실)을 중심 방으로 잡는다.
 *  2. 중심 방의 이웃을 상·하·좌·우 벽에 붙인다. 서로 연결된 이웃끼리는
 *     같은 벽에 나란히 붙여 벽을 공유하게 한다.
 *  3. 그 이웃의 이웃은 같은 방향으로 바깥쪽에 이어 붙인다.
 *  4. 벽을 공유하는 연결에는 문을 낸다. 배치상 벽을 맞대지 못한 연결은
 *     바깥 통로로 표시하고 경고한다.
 *  5. 층마다 따로 배치해 층 패널로 나란히 놓고, 층을 오가는 연결은
 *     양쪽 방에 계단 칸을 두어 그 사이를 순간 이동한다.
 *  방에 위치 단서(북/남/동/서)가 있으면 중심 방 기준 그 방향 벽을 우선한다.
 * 연결 정보만으로 실제 도면을 복원할 수는 없으므로 근사 배치다.
 * =========================================================== */
const HouseLayout = (() => {
  const PAD = 48;
  const COMPONENT_GAP = 70;
  const WALL = 10;
  const DOOR_W = 40;
  const DOOR_IN = 20;
  const HUB_MIN_W = 320;
  const HUB_MIN_H = 250;
  const BASE_SPAN = 150;
  const STAIR = 30;

  /* 방 종류: 이름 키워드 → 깊이(벽에서 바깥으로의 길이), 바닥 재질 */
  const TYPE_RULES = [
    { type: 'kitchen', match: /주방|부엌|kitchen/i, depth: 180, floor: 'tile' },
    { type: 'bath', match: /욕실|화장실|샤워실|bath|toilet/i, depth: 130, floor: 'tile' },
    { type: 'entrance', match: /현관|entrance|entry/i, depth: 110, floor: 'stone' },
    { type: 'utility', match: /다용도|세탁|창고|팬트리|utility|laundry|storage/i, depth: 130, floor: 'tile' },
    { type: 'garage', match: /주차|차고|garage|parking/i, depth: 200, floor: 'stone' },
    { type: 'dressing', match: /드레스|옷방|파우더|dress|closet/i, depth: 130, floor: 'wood' },
    { type: 'hall', match: /복도|홀|계단|엘리베이터|hall|corridor|stair/i, depth: 110, floor: 'wood' },
    { type: 'study', match: /서재|작업실|공부방|사무실|study|office/i, depth: 170, floor: 'wood' },
    { type: 'living', match: /거실|living|lounge/i, depth: 200, floor: 'wood' },
    { type: 'balcony', match: /발코니|베란다|테라스|마당|정원|온실|옥상|루프|balcony|terrace|yard|garden|roof/i, depth: 100, floor: 'stone' },
    { type: 'dining', match: /식당|다이닝|dining/i, depth: 170, floor: 'wood' },
    { type: 'bedroom', match: /침실|방|bed/i, depth: 180, floor: 'wood' },
  ];
  const DEFAULT_TYPE = { type: 'room', depth: 160, floor: 'wood' };

  /* 방 종류별 가구. rx/ry/rw/rh는 방 크기 비율, ax/ay는 행동 기준점 비율.
     walkable: 캐릭터가 밟고 지나가도 되는 것(러그, 매트) */
  const FURNITURE_SETS = {
    living: [
      { key: 'rug', rx: 0.30, ry: 0.30, rw: 0.40, rh: 0.40, walkable: true },
      { key: 'sofa', rx: 0.10, ry: 0.64, rw: 0.44, rh: 0.24, ax: 0.32, ay: 0.52 },
      { key: 'ctable', rx: 0.18, ry: 0.42, rw: 0.22, rh: 0.14 },
      { key: 'tv', rx: 0.12, ry: 0.05, rw: 0.38, rh: 0.08, ax: 0.31, ay: 0.24 },
      { key: 'plant', rx: 0.86, ry: 0.06, rw: 0.10, rh: 0.14 },
      { key: 'plant', rx: 0.86, ry: 0.80, rw: 0.10, rh: 0.14 },
    ],
    bedroom: [
      { key: 'bed', rx: 0.06, ry: 0.12, rw: 0.40, rh: 0.62, ax: 0.56, ay: 0.40 },
      { key: 'closet', rx: 0.64, ry: 0.06, rw: 0.30, rh: 0.14, ax: 0.79, ay: 0.32 },
      { key: 'plant', rx: 0.84, ry: 0.80, rw: 0.10, rh: 0.14 },
    ],
    kitchen: [
      { key: 'sink', rx: 0.06, ry: 0.06, rw: 0.46, rh: 0.16, ax: 0.29, ay: 0.34 },
      { key: 'stove', rx: 0.58, ry: 0.06, rw: 0.20, rh: 0.16, ax: 0.68, ay: 0.34 },
      { key: 'table', rx: 0.54, ry: 0.42, rw: 0.40, rh: 0.48, ax: 0.44, ay: 0.64 },
    ],
    dining: [
      { key: 'table', rx: 0.30, ry: 0.30, rw: 0.44, rh: 0.44, ax: 0.20, ay: 0.52 },
      { key: 'plant', rx: 0.86, ry: 0.08, rw: 0.10, rh: 0.14 },
    ],
    bath: [
      { key: 'tub', rx: 0.06, ry: 0.52, rw: 0.52, rh: 0.40, ax: 0.32, ay: 0.38 },
      { key: 'basin', rx: 0.66, ry: 0.06, rw: 0.28, rh: 0.18, ax: 0.80, ay: 0.36 },
      { key: 'toilet', rx: 0.72, ry: 0.56, rw: 0.20, rh: 0.34, ax: 0.62, ay: 0.74 },
    ],
    entrance: [
      { key: 'mat', rx: 0.36, ry: 0.30, rw: 0.30, rh: 0.40, walkable: true },
      { key: 'shoe', rx: 0.06, ry: 0.10, rw: 0.18, rh: 0.72, ax: 0.36, ay: 0.46 },
      { key: 'plant', rx: 0.84, ry: 0.10, rw: 0.10, rh: 0.16 },
    ],
    utility: [
      { key: 'washer', rx: 0.06, ry: 0.08, rw: 0.26, rh: 0.34, ax: 0.36, ay: 0.36 },
      { key: 'sink', rx: 0.60, ry: 0.08, rw: 0.34, rh: 0.16, ax: 0.77, ay: 0.36 },
    ],
    dressing: [
      { key: 'closet', rx: 0.06, ry: 0.06, rw: 0.88, rh: 0.16, ax: 0.50, ay: 0.36 },
      { key: 'closet', rx: 0.06, ry: 0.78, rw: 0.88, rh: 0.16, ax: 0.50, ay: 0.64 },
    ],
    garage: [],
    hall: [
      { key: 'plant', rx: 0.80, ry: 0.10, rw: 0.14, rh: 0.20 },
    ],
    study: [
      { key: 'desk', rx: 0.52, ry: 0.08, rw: 0.42, rh: 0.26, ax: 0.73, ay: 0.48 },
      { key: 'shelf', rx: 0.06, ry: 0.08, rw: 0.14, rh: 0.74, ax: 0.28, ay: 0.45 },
    ],
    balcony: [
      { key: 'plant', rx: 0.08, ry: 0.20, rw: 0.14, rh: 0.40 },
      { key: 'plant', rx: 0.78, ry: 0.20, rw: 0.14, rh: 0.40 },
    ],
    room: [],
  };

  /* 행동 키워드 → 선호 가구 키 (앞쪽 규칙 우선, 그 가구가 없으면 다음 규칙) */
  const ACTION_ANCHORS = [
    { re: /기상|취침|수면|잠|눕|침대|낮잠|일어나/, keys: ['bed'] },
    { re: /요리|조리|끓|굽|볶/, keys: ['stove', 'sink', 'table'] },
    { re: /설거지|준비|씻/, keys: ['sink', 'stove', 'basin'] },
    { re: /식사|먹|간식|커피|아침|점심|저녁|야식/, keys: ['table', 'sink'] },
    { re: /샤워|목욕|욕조/, keys: ['tub', 'basin'] },
    { re: /세면|양치|세수|화장|머리/, keys: ['basin', 'tub'] },
    { re: /화장실|볼일/, keys: ['toilet'] },
    { re: /빨래|세탁/, keys: ['washer'] },
    { re: /소파|TV|티비|텔레비전|휴식|쉬|영화|드라마|게임/i, keys: ['sofa', 'tv'] },
    { re: /공부|작업|업무|근무|독서|책|글/, keys: ['desk', 'shelf'] },
    { re: /옷|갈아입|환복/, keys: ['closet'] },
    { re: /신발|외출|출근|귀가|나가|들어오|현관/, keys: ['shoe'] },
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const connKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  function typeOf(name) {
    return TYPE_RULES.find((r) => r.match.test(name)) || DEFAULT_TYPE;
  }

  function dedupe(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
      out.push(p.jump ? { x: p.x, y: p.y, jump: true } : { x: p.x, y: p.y });
    }
    return out;
  }

  function buildFurniture(type, x, y, w, h) {
    return (FURNITURE_SETS[type] || []).map((f) => ({
      key: f.key,
      walkable: !!f.walkable,
      x: x + f.rx * w,
      y: y + f.ry * h,
      w: f.rw * w,
      h: f.rh * h,
      anchor: f.ax !== undefined ? { x: x + f.ax * w, y: y + f.ay * h } : null,
    }));
  }

  /** 선분 (p,q)가 사각형 r을 지나는지 (slab 방식) */
  function segmentHitsRect(p, q, r) {
    let t0 = 0;
    let t1 = 1;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const checks = [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]];
    for (const [den, num] of checks) {
      if (den === 0) {
        if (num < 0) return false;
        continue;
      }
      const t = num / den;
      if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  /* 중심 방 이웃 묶음을 벽을 공유하도록 한 줄로 정렬 */
  function orderChain(group, adj) {
    if (group.length <= 2) return group;
    const set = new Set(group);
    const deg = (n) => adj.get(n).filter((v) => set.has(v)).length;
    const start = group.find((n) => deg(n) === 1) || group[0];
    const order = [start];
    const used = new Set([start]);
    let cur = start;
    while (order.length < group.length) {
      const next = adj.get(cur).find((v) => set.has(v) && !used.has(v)) || group.find((n) => !used.has(n));
      used.add(next);
      order.push(next);
      cur = next;
    }
    return order;
  }

  /* 하나의 연결 영역을 (0,0) 기준 상대 좌표로 배치. 반환: Map name → {x,y,w,h,dir} */
  function layoutComponent(comp, adj, info) {
    const rects = new Map();
    if (comp.length === 1) {
      rects.set(comp[0], { x: 0, y: 0, w: 240, h: 200, dir: null });
      return rects;
    }
    const score = (n) => adj.get(n).length * 10 + (info.get(n).type === 'living' ? 5 : info.get(n).type === 'hall' ? 3 : 0);
    const hub = comp.reduce((best, n) => (score(n) > score(best) ? n : best), comp[0]);

    // BFS 트리
    const parent = new Map([[hub, null]]);
    const children = new Map(comp.map((n) => [n, []]));
    const queue = [hub];
    while (queue.length) {
      const u = queue.shift();
      for (const v of adj.get(u)) {
        if (parent.has(v)) continue;
        parent.set(v, u);
        children.get(u).push(v);
        queue.push(v);
      }
    }

    // 각 방이 벽을 따라 차지해야 하는 길이(자식들이 바깥에 나란히 붙을 수 있게)
    const span = new Map();
    const calcSpan = (n) => {
      const s = Math.max(BASE_SPAN, children.get(n).reduce((acc, c) => acc + calcSpan(c), 0));
      span.set(n, s);
      return s;
    };
    for (const n of children.get(hub)) calcSpan(n);

    // 중심 방 이웃을 서로 연결된 것끼리 묶어 한 벽에 나란히 배치
    const nbs = children.get(hub);
    const nbSet = new Set(nbs);
    const groups = [];
    const used = new Set();
    for (const n of nbs) {
      if (used.has(n)) continue;
      const grp = [];
      const stack = [n];
      used.add(n);
      while (stack.length) {
        const u = stack.pop();
        grp.push(u);
        for (const v of adj.get(u)) if (nbSet.has(v) && !used.has(v)) { used.add(v); stack.push(v); }
      }
      groups.push(orderChain(grp, adj));
    }
    const sides = { bottom: [], right: [], left: [], top: [] };
    const sum = (s) => sides[s].reduce((acc, n) => acc + span.get(n), 0);
    const entranceGroup = groups.find((g) => g.some((n) => info.get(n).type === 'entrance'));
    groups.sort((a, b) => (b === entranceGroup) - (a === entranceGroup) || b.length - a.length);
    // 위치 단서(북/남/동/서)가 있으면 중심 방 기준 그 방향 벽에 붙인다
    const hubPos = info.get(hub).position || { x: 0, y: 0 };
    const hintSide = (g) => {
      let sx = 0;
      let sy = 0;
      for (const n of g) {
        const p = info.get(n).position;
        if (p) { sx += p.x - hubPos.x; sy += p.y - hubPos.y; }
      }
      // 중심 방과 같은 방향(예: 둘 다 남쪽)이면 그 방 자체의 방향을 쓴다
      if (!sx && !sy) {
        for (const n of g) {
          const p = info.get(n).position;
          if (p) { sx += p.x; sy += p.y; }
        }
      }
      if (!sx && !sy) return null;
      if (Math.abs(sx) >= Math.abs(sy)) return sx > 0 ? 'right' : 'left';
      return sy > 0 ? 'bottom' : 'top';
    };
    for (const g of groups) {
      let side = hintSide(g);
      if (!side && g === entranceGroup && sides.bottom.length === 0) side = 'bottom';
      if (!side) side = ['right', 'left', 'top', 'bottom'].reduce((best, s) => (sum(s) < sum(best) ? s : best), 'right');
      // 벽을 따라 놓는 순서도 위치 단서(좌우 벽은 북→남, 위아래 벽은 서→동)에 맞춘다
      const axis = side === 'left' || side === 'right' ? 'y' : 'x';
      const at = (n) => (info.get(n).position ? info.get(n).position[axis] : 0);
      if (g.length > 1 && at(g[0]) > at(g[g.length - 1])) g.reverse();
      sides[side].push(...g);
    }

    const hubW = Math.max(HUB_MIN_W, sum('top'), sum('bottom'));
    const hubH = Math.max(HUB_MIN_H, sum('right'), sum('left'));
    const hubRect = { x: 0, y: 0, w: hubW, h: hubH, dir: null };
    rects.set(hub, hubRect);

    const horizontal = (dir) => dir === 'right' || dir === 'left';
    const place = (items, dir, start, len, base) => {
      if (!items.length) return;
      const total = items.reduce((acc, n) => acc + span.get(n), 0);
      let cursor = start;
      items.forEach((n, i) => {
        const s = i === items.length - 1 ? start + len - cursor : Math.round((span.get(n) / total) * len);
        const d = info.get(n).depth;
        let r;
        if (dir === 'right') r = { x: base.x + base.w, y: cursor, w: d, h: s };
        else if (dir === 'left') r = { x: base.x - d, y: cursor, w: d, h: s };
        else if (dir === 'bottom') r = { x: cursor, y: base.y + base.h, w: s, h: d };
        else r = { x: cursor, y: base.y - d, w: s, h: d };
        r.dir = dir;
        rects.set(n, r);
        cursor += s;
        place(children.get(n), dir, horizontal(dir) ? r.y : r.x, horizontal(dir) ? r.h : r.w, r);
      });
    };
    place(sides.right, 'right', 0, hubH, hubRect);
    place(sides.left, 'left', 0, hubH, hubRect);
    place(sides.bottom, 'bottom', 0, hubW, hubRect);
    place(sides.top, 'top', 0, hubW, hubRect);
    return rects;
  }

  /* 두 방이 공유하는 벽 위의 문 위치. 없으면 null */
  function sharedDoor(A, B) {
    const need = DOOR_W + 24;
    const eq = (p, q) => Math.abs(p - q) < 0.5;
    if (eq(A.x + A.w, B.x) || eq(B.x + B.w, A.x)) {
      const x = eq(A.x + A.w, B.x) ? B.x : A.x;
      const lo = Math.max(A.y, B.y);
      const hi = Math.min(A.y + A.h, B.y + B.h);
      if (hi - lo >= need) return { x, y: Math.round((lo + hi) / 2), orient: 'v' };
    }
    if (eq(A.y + A.h, B.y) || eq(B.y + B.h, A.y)) {
      const y = eq(A.y + A.h, B.y) ? B.y : A.y;
      const lo = Math.max(A.x, B.x);
      const hi = Math.min(A.x + A.w, B.x + B.w);
      if (hi - lo >= need) return { x: Math.round((lo + hi) / 2), y, orient: 'h' };
    }
    return null;
  }

  /* 방 테두리 위에서 목표점에 가장 가까운 점과 그 벽의 방향 */
  function boundaryPoint(R, target) {
    const px = clamp(target.x, R.x, R.x + R.w);
    const py = clamp(target.y, R.y, R.y + R.h);
    const dl = Math.abs(px - R.x);
    const dr = Math.abs(R.x + R.w - px);
    const dt = Math.abs(py - R.y);
    const db = Math.abs(R.y + R.h - py);
    const m = Math.min(dl, dr, dt, db);
    const margin = DOOR_W / 2 + 12;
    if (m === dl) return { x: R.x, y: clamp(py, R.y + margin, R.y + R.h - margin), orient: 'v', inward: { x: 1, y: 0 } };
    if (m === dr) return { x: R.x + R.w, y: clamp(py, R.y + margin, R.y + R.h - margin), orient: 'v', inward: { x: -1, y: 0 } };
    if (m === dt) return { x: clamp(px, R.x + margin, R.x + R.w - margin), y: R.y, orient: 'h', inward: { x: 0, y: 1 } };
    return { x: clamp(px, R.x + margin, R.x + R.w - margin), y: R.y + R.h, orient: 'h', inward: { x: 0, y: -1 } };
  }

  function compute(house) {
    const warnings = [];
    const names = house.rooms.map((r) => r.name);
    const meta = new Map(house.rooms.map((r) => [r.name, r]));
    const info = new Map(names.map((n) => [n, { ...typeOf(n), position: meta.get(n).position || null }]));
    const levelOf = (n) => meta.get(n).floor ?? 1;
    // 같은 층 연결만 벽/문 배치에 쓰고, 층을 오가는 연결은 계단으로 처리한다
    const adj = new Map(names.map((n) => [n, []]));
    const seen = new Set();
    const edges = [];
    for (const c of house.connections) {
      if (!adj.has(c.a) || !adj.has(c.b)) continue;
      const key = connKey(c.a, c.b);
      if (seen.has(key)) continue;
      seen.add(key);
      const stairs = levelOf(c.a) !== levelOf(c.b);
      edges.push({ a: c.a, b: c.b, key, method: c.method || '', stairs });
      if (stairs) continue;
      adj.get(c.a).push(c.b);
      adj.get(c.b).push(c.a);
    }

    /* 층별로 연결 요소를 배치해 패널 하나에 세로로 쌓는다 */
    const floorList = house.floors && house.floors.length
      ? house.floors
      : [...new Set(names.map(levelOf))].sort((a, b) => a - b).map((f) => ({ floor: f, label: `${f}층` }));
    const multi = floorList.length > 1;
    const LABEL_H = multi ? 34 : 0;
    const PANEL_PAD = multi ? 26 : 0;
    const components = [];
    const panels = floorList.map((fl) => {
      const fnames = names.filter((n) => levelOf(n) === fl.floor);
      const visited = new Set();
      const placed = [];
      let offsetY = 0;
      let panelW = 0;
      for (const n of fnames) {
        if (visited.has(n)) continue;
        const comp = [];
        const stack = [n];
        visited.add(n);
        while (stack.length) {
          const u = stack.pop();
          comp.push(u);
          for (const v of adj.get(u)) if (!visited.has(v)) { visited.add(v); stack.push(v); }
        }
        comp.sort((p, q) => names.indexOf(p) - names.indexOf(q));
        components.push(comp);
        const rel = layoutComponent(comp, adj, info);
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const r of rel.values()) {
          minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
          maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
        }
        for (const [name, r] of rel) placed.push({ name, r: { ...r, x: r.x - minX, y: r.y - minY + offsetY } });
        offsetY += (maxY - minY) + COMPONENT_GAP;
        panelW = Math.max(panelW, maxX - minX);
      }
      return { ...fl, placed, innerW: panelW, innerH: Math.max(0, offsetY - COMPONENT_GAP) };
    });

    /* 패널을 아래층부터 한 줄로 놓는다. 4개 층 이상이면 2열 격자 */
    const cols = panels.length <= 3 ? panels.length : 2;
    const colW = Array(cols).fill(0);
    const rowH = [];
    panels.forEach((p, i) => {
      p.w = p.innerW + PANEL_PAD * 2;
      p.h = p.innerH + PANEL_PAD * 2 + LABEL_H;
      colW[i % cols] = Math.max(colW[i % cols], p.w);
      const row = Math.floor(i / cols);
      rowH[row] = Math.max(rowH[row] || 0, p.h);
    });
    const rooms = new Map();
    const roomList = [];
    const floors = [];
    panels.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = PAD + colW.slice(0, col).reduce((a, b) => a + b + COMPONENT_GAP, 0);
      const py = PAD + rowH.slice(0, row).reduce((a, b) => a + b + COMPONENT_GAP, 0);
      if (multi) floors.push({ floor: p.floor, label: p.label, x: px, y: py, w: p.w, h: p.h, labelH: LABEL_H });
      for (const name of names) {
        const item = p.placed.find((it) => it.name === name);
        if (!item) continue;
        const { r } = item;
        const x = px + PANEL_PAD + r.x;
        const y = py + LABEL_H + PANEL_PAD + r.y;
        const t = info.get(name);
        const room = {
          name, type: t.type, floor: t.floor,
          level: p.floor, levelLabel: p.label,
          x, y, w: r.w, h: r.h,
          cx: x + r.w / 2, cy: y + r.h / 2,
          dir: r.dir,
          furniture: buildFurniture(t.type, x, y, r.w, r.h),
          stairs: [],
          exteriorDoor: null,
        };
        rooms.set(name, room);
        roomList.push(room);
      }
    });
    const width = PAD * 2 + colW.reduce((a, b) => a + b, 0) + COMPONENT_GAP * (cols - 1);
    const height = PAD * 2 + rowH.reduce((a, b) => a + b, 0) + COMPONENT_GAP * (rowH.length - 1);

    /* 현관 바깥문 */
    for (const room of roomList) {
      if (room.type !== 'entrance') continue;
      const dir = room.dir || 'bottom';
      if (dir === 'right') room.exteriorDoor = { x: room.x + room.w, y: room.cy, orient: 'v' };
      else if (dir === 'left') room.exteriorDoor = { x: room.x, y: room.cy, orient: 'v' };
      else if (dir === 'top') room.exteriorDoor = { x: room.cx, y: room.y, orient: 'h' };
      else room.exteriorDoor = { x: room.cx, y: room.y + room.h, orient: 'h' };
    }

    /* 문과 이동 경로 */
    const connMap = new Map();
    for (const e of edges) {
      const A = rooms.get(e.a);
      const B = rooms.get(e.b);
      if (e.stairs) {
        // 층간 연결: 두 방 안쪽 모서리에 계단 표시를 두고 그 사이는 순간 이동
        const sa = addStair(A, B, e.method);
        const sb = addStair(B, A, e.method);
        e.path = [{ x: sa.cx, y: sa.cy }, { x: sb.cx, y: sb.cy }];
        connMap.set(e.key, e);
        continue;
      }
      const door = sharedDoor(A, B);
      if (door) {
        e.door = door;
        e.exterior = false;
        if (door.orient === 'v') {
          const inA = A.cx < B.cx ? -1 : 1; // A가 왼쪽이면 A 안쪽은 -x 방향
          e.path = [{ x: door.x + inA * DOOR_IN, y: door.y }, { x: door.x - inA * DOOR_IN, y: door.y }];
        } else {
          const inA = A.cy < B.cy ? -1 : 1;
          e.path = [{ x: door.x, y: door.y + inA * DOOR_IN }, { x: door.x, y: door.y - inA * DOOR_IN }];
        }
      } else {
        // 벽을 맞대지 못한 연결: 바깥 통로
        const pa = boundaryPoint(A, { x: B.cx, y: B.cy });
        const pb = boundaryPoint(B, { x: A.cx, y: A.cy });
        e.exterior = true;
        e.doorA = { x: pa.x, y: pa.y, orient: pa.orient };
        e.doorB = { x: pb.x, y: pb.y, orient: pb.orient };
        e.outside = [
          { x: pa.x - pa.inward.x * DOOR_IN, y: pa.y - pa.inward.y * DOOR_IN },
          { x: pb.x - pb.inward.x * DOOR_IN, y: pb.y - pb.inward.y * DOOR_IN },
        ];
        e.path = dedupe([
          { x: pa.x + pa.inward.x * DOOR_IN, y: pa.y + pa.inward.y * DOOR_IN },
          e.outside[0],
          e.outside[1],
          { x: pb.x + pb.inward.x * DOOR_IN, y: pb.y + pb.inward.y * DOOR_IN },
        ]);
        warnings.push({
          line: null,
          value: `${e.a}-${e.b}`,
          message: `"${e.a}"과(와) "${e.b}"은(는) 배치상 벽을 맞대지 못해 바깥 통로로 연결했습니다.`,
          fix: '두 방이 가까워지도록 연결 구조를 조정하면 문으로 바뀝니다.',
        });
      }
      connMap.set(e.key, e);
    }

    return { rooms, roomList, connections: edges, connMap, components, floors, width, height, warnings, WALL, DOOR_W };
  }

  /* 방 오른쪽 아래 안쪽 모서리부터 왼쪽으로 계단 칸을 하나씩 잡는다.
     겹치는 장식 가구(기준점 없는 것)는 치운다 */
  function addStair(room, other, method) {
    const k = room.stairs.length;
    const x = room.x + room.w - 12 - STAIR - k * (STAIR + 8);
    const y = room.y + room.h - 12 - STAIR;
    const s = { x, y, w: STAIR, h: STAIR, cx: x + STAIR / 2, cy: y + STAIR / 2, to: other.name, toLevel: other.levelLabel, method };
    room.furniture = room.furniture.filter((f) => f.anchor || !(f.x < x + STAIR && f.x + f.w > x && f.y < y + STAIR && f.y + f.h > y));
    room.stairs.push(s);
    return s;
  }

  /** 행동에 맞는 방 안의 기준점 (없으면 방 중앙) */
  function anchorFor(room, action) {
    for (const rule of ACTION_ANCHORS) {
      if (!rule.re.test(action || '')) continue;
      for (const key of rule.keys) {
        const f = room.furniture.find((item) => item.key === key && item.anchor);
        if (f) return { x: f.anchor.x, y: f.anchor.y, furniture: f.key };
      }
    }
    return { x: room.cx, y: room.cy, furniture: null };
  }

  /** 방 안에서 last → target 직선이 가구를 지나면 방 중앙을 경유 */
  function pushInside(points, room, target) {
    const last = points[points.length - 1];
    const blockers = room.furniture.filter((f) => !f.walkable);
    if (blockers.some((f) => segmentHitsRect(last, target, f))) {
      points.push({ x: room.cx, y: room.cy });
    }
    points.push({ x: target.x, y: target.y });
  }

  /**
   * 이동 경로 생성
   * from(현재 좌표) → [방 내부] → 문 → 다음 방 → … → to(목적 좌표)
   */
  function buildRoute(layout, from, routeNames, to) {
    const points = [{ x: from.x, y: from.y }];
    for (let i = 0; i < routeNames.length - 1; i++) {
      const conn = layout.connMap.get(connKey(routeNames[i], routeNames[i + 1]));
      if (!conn) throw new Error(`연결 없음: ${routeNames[i]}-${routeNames[i + 1]}`);
      const through = conn.a === routeNames[i] ? conn.path : [...conn.path].reverse();
      pushInside(points, layout.rooms.get(routeNames[i]), through[0]);
      for (let k = 1; k < through.length; k++) {
        points.push(conn.stairs ? { x: through[k].x, y: through[k].y, jump: true } : { x: through[k].x, y: through[k].y });
      }
    }
    pushInside(points, layout.rooms.get(routeNames[routeNames.length - 1]), to);
    return dedupe(points);
  }

  return { compute, anchorFor, buildRoute, WALL, DOOR_W };
})();
