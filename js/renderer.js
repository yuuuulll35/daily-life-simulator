/* ===========================================================
 * SVG 렌더러 (평면도 스타일)
 * 잔디 배경 → 바닥 → 가구 → 벽 → 문 → 방 이름 → 이동 경로 → 캐릭터
 * 상태를 계산하지 않고 그리기만 담당한다.
 * =========================================================== */
const MapRenderer = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  const pointsAttr = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const AVATAR_SIZE = 50; // 이미지 마커 크기 (지도 좌표)

  /** 말풍선 상자의 세로 위치(마커 중심 기준). 위: 머리 바로 위(upTip)에 꼬리 끝 / 아래: 이름표 밑 */
  function bubbleFrame(boxH, below, upTip = -26) {
    const TAIL = 8;
    if (below) {
      const tip = 42; // 이름표(21~40) 바로 밑
      const top = tip + TAIL;
      return { top, b: top + boxH, tip };
    }
    const tip = upTip;
    const b = tip - TAIL;
    return { top: b - boxH, b, tip };
  }

  /** 말풍선 글자 줄 바꿈: 단어 단위, 너무 긴 단어만 나눈다. 글자는 버리지 않는다 */
  function wrapText(text, maxChars) {
    const lines = [];
    let cur = '';
    for (let w of String(text).split(/\s+/).filter(Boolean)) {
      while (w.length > maxChars) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /* jump 표시된 점(층간 이동)에서는 선을 끊는다 */
  const pathAttr = (pts) => pts.map((p, i) => `${i === 0 || p.jump ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  /* 방 폭에 맞춰 이름을 단어 단위로 줄 바꿈 */
  function wrapLabel(name, width) {
    const max = Math.max(4, Math.floor((width - 16) / 13));
    const lines = [];
    let cur = '';
    for (const w of name.split(/\s+/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > max && cur) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* 절제된 팔레트: 따뜻한 회베이지 2~3톤 + 포인트 하나 */
  const C = {
    wood: '#d9cdbb', woodDark: '#b9ab96', fabric: '#e6ddd0', fabricDark: '#cfc3b2',
    white: '#fbf9f6', ceramic: '#eeecE8', ceramicLine: '#c4bdb2', metal: '#a8a199',
    leaf: '#a9b8a0', leafDark: '#8c9d83', pot: '#b9ab96', blanket: '#d3d8dc', dark: '#6b6560',
    rug: '#efe8dd', rugLine: '#d6ccbd',
  };

  function defs(svg) {
    const d = el('defs', {}, svg);

    const wood = el('pattern', { id: 'p-wood', width: 64, height: 16, patternUnits: 'userSpaceOnUse' }, d);
    el('rect', { width: 64, height: 16, fill: '#fff' }, wood);
    el('path', { d: 'M0 15.5 H64 M32 0 V8 M0 8 V16', stroke: 'rgba(120,105,85,0.14)', 'stroke-width': 1, fill: 'none' }, wood);

    const tile = el('pattern', { id: 'p-tile', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, d);
    el('rect', { width: 22, height: 22, fill: '#f0efec' }, tile);
    el('path', { d: 'M0 21.5 H22 M21.5 0 V22', stroke: 'rgba(100,100,100,0.14)', 'stroke-width': 1, fill: 'none' }, tile);

    const stone = el('pattern', { id: 'p-stone', width: 34, height: 34, patternUnits: 'userSpaceOnUse' }, d);
    el('rect', { width: 34, height: 34, fill: '#eeebe6' }, stone);
    el('path', { d: 'M0 33.5 H34 M33.5 0 V34 M17 0 V17 M0 17 H17', stroke: 'rgba(80,80,80,0.12)', 'stroke-width': 1, fill: 'none' }, stone);
  }

  /* ---------- 가구 그리기 ---------- */
  function drawFurniture(g, f) {
    const { x, y, w, h } = f;
    const grp = el('g', { class: `furniture f-${f.key}` }, g);
    switch (f.key) {
      case 'bed': {
        el('rect', { x, y, width: w, height: h, rx: 6, fill: C.woodDark }, grp);
        el('rect', { x: x + 4, y: y + 4, width: w - 8, height: h - 8, rx: 4, fill: C.white }, grp);
        const pw = (w - 20) / 2;
        el('rect', { x: x + 8, y: y + 9, width: pw, height: h * 0.16, rx: 4, fill: '#f3f0ea', stroke: '#d9d2c6' }, grp);
        el('rect', { x: x + 12 + pw, y: y + 9, width: pw, height: h * 0.16, rx: 4, fill: '#f3f0ea', stroke: '#d9d2c6' }, grp);
        el('rect', { x: x + 4, y: y + h * 0.34, width: w - 8, height: h * 0.62 - 4, rx: 4, fill: C.blanket }, grp);
        el('rect', { x: x + 4, y: y + h * 0.34, width: w - 8, height: 6, fill: '#c3cad0' }, grp);
        break;
      }
      case 'closet':
        el('rect', { x, y, width: w, height: h, rx: 3, fill: C.wood, stroke: C.woodDark }, grp);
        el('line', { x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h, stroke: C.woodDark }, grp);
        el('circle', { cx: x + w / 2 - 5, cy: y + h / 2, r: 1.6, fill: C.woodDark }, grp);
        el('circle', { cx: x + w / 2 + 5, cy: y + h / 2, r: 1.6, fill: C.woodDark }, grp);
        break;
      case 'sofa': {
        el('rect', { x, y, width: w, height: h, rx: 8, fill: C.fabricDark }, grp);
        el('rect', { x: x + 6, y: y + 8, width: w - 12, height: h - 14, rx: 6, fill: C.fabric }, grp);
        const n = Math.max(2, Math.round(w / 55));
        for (let i = 1; i < n; i++) el('line', { x1: x + 6 + ((w - 12) / n) * i, y1: y + 8, x2: x + 6 + ((w - 12) / n) * i, y2: y + h - 6, stroke: C.fabricDark }, grp);
        break;
      }
      case 'ctable':
        el('rect', { x, y, width: w, height: h, rx: 6, fill: C.wood, stroke: C.woodDark }, grp);
        break;
      case 'rug':
        el('rect', { x, y, width: w, height: h, rx: 10, fill: C.rug, stroke: C.rugLine, 'stroke-width': 2, 'stroke-dasharray': '4 3' }, grp);
        break;
      case 'tv':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: C.dark }, grp);
        el('rect', { x: x + w * 0.35, y: y + h, width: w * 0.3, height: 3, fill: '#9a938b' }, grp);
        break;
      case 'table': {
        const cw = Math.min(14, w * 0.18);
        const ch = Math.min(14, h * 0.18);
        el('rect', { x: x + cw + 2, y: y + ch + 2, width: w - 2 * cw - 4, height: h - 2 * ch - 4, rx: 6, fill: C.wood, stroke: C.woodDark }, grp);
        const chair = (cx, cy, cw2, ch2) => el('rect', { x: cx, y: cy, width: cw2, height: ch2, rx: 3, fill: C.woodDark }, grp);
        chair(x + w * 0.3, y, w * 0.18, ch); chair(x + w * 0.56, y, w * 0.18, ch);
        chair(x + w * 0.3, y + h - ch, w * 0.18, ch); chair(x + w * 0.56, y + h - ch, w * 0.18, ch);
        chair(x, y + h * 0.4, cw, h * 0.2); chair(x + w - cw, y + h * 0.4, cw, h * 0.2);
        break;
      }
      case 'sink':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: C.ceramic, stroke: C.ceramicLine }, grp);
        el('rect', { x: x + w * 0.3, y: y + h * 0.2, width: w * 0.4, height: h * 0.6, rx: 4, fill: '#fff', stroke: C.ceramicLine }, grp);
        el('circle', { cx: x + w * 0.5, cy: y + h * 0.18, r: 2.2, fill: C.metal }, grp);
        break;
      case 'stove':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: '#e9e6e1', stroke: C.ceramicLine }, grp);
        el('circle', { cx: x + w * 0.3, cy: y + h * 0.35, r: Math.min(w, h) * 0.17, fill: 'none', stroke: '#9a938b', 'stroke-width': 1.6 }, grp);
        el('circle', { cx: x + w * 0.7, cy: y + h * 0.35, r: Math.min(w, h) * 0.17, fill: 'none', stroke: '#9a938b', 'stroke-width': 1.6 }, grp);
        el('circle', { cx: x + w * 0.3, cy: y + h * 0.72, r: Math.min(w, h) * 0.14, fill: 'none', stroke: '#9a938b', 'stroke-width': 1.6 }, grp);
        el('circle', { cx: x + w * 0.7, cy: y + h * 0.72, r: Math.min(w, h) * 0.14, fill: 'none', stroke: '#9a938b', 'stroke-width': 1.6 }, grp);
        break;
      case 'tub':
        el('rect', { x, y, width: w, height: h, rx: 12, fill: C.ceramic, stroke: C.ceramicLine, 'stroke-width': 2 }, grp);
        el('rect', { x: x + 6, y: y + 6, width: w - 12, height: h - 12, rx: 9, fill: '#fff' }, grp);
        el('circle', { cx: x + w - 16, cy: y + h / 2, r: 3, fill: C.metal }, grp);
        break;
      case 'basin':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: C.ceramic, stroke: C.ceramicLine }, grp);
        el('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w * 0.28, ry: h * 0.3, fill: '#fff', stroke: C.ceramicLine }, grp);
        el('circle', { cx: x + w / 2, cy: y + h * 0.18, r: 2, fill: C.metal }, grp);
        break;
      case 'toilet':
        el('rect', { x: x + w * 0.15, y, width: w * 0.7, height: h * 0.3, rx: 3, fill: '#fff', stroke: C.ceramicLine }, grp);
        el('ellipse', { cx: x + w / 2, cy: y + h * 0.65, rx: w * 0.36, ry: h * 0.32, fill: '#fff', stroke: C.ceramicLine }, grp);
        break;
      case 'shoe':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: C.wood, stroke: C.woodDark }, grp);
        for (let i = 1; i < 4; i++) el('line', { x1: x, y1: y + (h / 4) * i, x2: x + w, y2: y + (h / 4) * i, stroke: C.woodDark }, grp);
        break;
      case 'mat':
        el('rect', { x, y, width: w, height: h, rx: 4, fill: '#d6ccbd', opacity: 0.9 }, grp);
        break;
      case 'washer':
        el('rect', { x, y, width: w, height: h, rx: 3, fill: '#f5f4f1', stroke: C.ceramicLine }, grp);
        el('circle', { cx: x + w / 2, cy: y + h * 0.58, r: Math.min(w, h) * 0.3, fill: '#e6e8ea', stroke: C.metal, 'stroke-width': 2 }, grp);
        break;
      case 'desk':
        el('rect', { x, y, width: w, height: h * 0.6, rx: 3, fill: C.wood, stroke: C.woodDark }, grp);
        el('rect', { x: x + w * 0.38, y: y + h * 0.66, width: w * 0.24, height: h * 0.34, rx: 4, fill: C.woodDark }, grp);
        break;
      case 'shelf':
        el('rect', { x, y, width: w, height: h, rx: 2, fill: C.woodDark }, grp);
        for (let i = 1; i < 5; i++) el('rect', { x: x + 2, y: y + (h / 5) * i - 3, width: w - 4, height: 2, fill: C.wood }, grp);
        break;
      case 'plant': {
        const cx = x + w / 2;
        const cy = y + h * 0.55;
        const r = Math.min(w, h) * 0.5;
        el('rect', { x: cx - r * 0.5, y: cy + r * 0.2, width: r, height: r * 0.7, rx: 2, fill: C.pot }, grp);
        el('circle', { cx: cx - r * 0.35, cy: cy - r * 0.1, r: r * 0.5, fill: C.leaf }, grp);
        el('circle', { cx: cx + r * 0.35, cy: cy - r * 0.1, r: r * 0.5, fill: C.leafDark }, grp);
        el('circle', { cx, cy: cy - r * 0.45, r: r * 0.5, fill: C.leaf }, grp);
        break;
      }
      default:
        el('rect', { x, y, width: w, height: h, rx: 4, fill: C.fabric }, grp);
    }
  }

  /* ---------- 문 그리기 ---------- */
  function drawDoor(g, door, wall, doorW, opts = {}) {
    const half = doorW / 2;
    const grp = el('g', { class: opts.exterior ? 'door exterior' : 'door' }, g);
    if (door.orient === 'v') {
      el('rect', { x: door.x - wall / 2 - 1, y: door.y - half, width: wall + 2, height: doorW, fill: '#fff' }, grp);
      if (!opts.noLeaf) {
        const hx = door.x; const hy = door.y - half;
        el('path', { d: `M${hx},${hy} L${hx + doorW},${hy} A${doorW},${doorW} 0 0 1 ${hx},${hy + doorW}`, class: 'door-leaf' }, grp);
      }
    } else {
      el('rect', { x: door.x - half, y: door.y - wall / 2 - 1, width: doorW, height: wall + 2, fill: '#fff' }, grp);
      if (!opts.noLeaf) {
        const hx = door.x - half; const hy = door.y;
        el('path', { d: `M${hx},${hy} L${hx},${hy + doorW} A${doorW},${doorW} 0 0 0 ${hx + doorW},${hy}`, class: 'door-leaf' }, grp);
      }
    }
  }

  class Renderer {
    constructor(svg) {
      this.svg = svg;
      this.markers = new Map();
      this.colors = new Map();
      this.tips = new Map(); // 캐릭터별 말풍선 꼬리 끝 y (마커 모양마다 머리 높이가 다르다)
      this.pos = new Map();
      this.bubbleData = new Map();
      this.bubbleBox = new Map();
      this.routes = new Map();
      this.roomEls = new Map();
      this.layout = null;
    }

    clear() {
      while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
      this.markers.clear();
      this.colors.clear();
      this.tips.clear();
      this.pos.clear();
      this.bubbleData.clear();
      this.bubbleBox.clear();
      this.routes.clear();
      this.roomEls.clear();
      this.layout = null;
    }

    render(layout, characters) {
      this.clear();
      this.layout = layout;
      const WALL = layout.WALL;
      const DOOR_W = layout.DOOR_W;
      this.svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
      defs(this.svg);

      // 층 패널 (여러 층일 때만)
      const gPanels = el('g', { class: 'level-panels' }, this.svg);
      for (const f of layout.floors || []) {
        el('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 14, class: 'level-panel' }, gPanels);
        el('text', { x: f.x + 16, y: f.y + 23, class: 'level-label' }, gPanels).textContent = f.label;
      }

      const gFloors = el('g', { class: 'floors' }, this.svg);
      const gFurniture = el('g', { class: 'furnitures' }, this.svg);
      const gWalls = el('g', { class: 'walls' }, this.svg);
      const gDoors = el('g', { class: 'doors' }, this.svg);
      const gLabels = el('g', { class: 'labels' }, this.svg);
      this.gRoutes = el('g', { class: 'routes' }, this.svg);
      this.gChars = el('g', { class: 'characters' }, this.svg);

      // 바깥 통로(벽을 맞대지 못한 연결)
      for (const c of layout.connections) {
        if (!c.exterior) continue;
        el('polyline', { points: pointsAttr(c.outside), class: 'outside-path' }, gFloors);
      }

      for (const room of layout.roomList) {
        const g = el('g', { class: 'room', 'data-room': room.name }, gFloors);
        el('rect', { x: room.x, y: room.y, width: room.w, height: room.h, class: 'room-floor' }, g);
        el('rect', { x: room.x, y: room.y, width: room.w, height: room.h, class: 'room-glow' }, g);
        this.roomEls.set(room.name, g);

        for (const f of room.furniture) drawFurniture(gFurniture, f);

        el('rect', { x: room.x, y: room.y, width: room.w, height: room.h, class: 'wall' }, gWalls);

        for (const s of room.stairs || []) {
          const sg = el('g', { class: 'stair' }, gFurniture);
          el('title', {}, sg).textContent = `${s.toLevel} ${s.to}${s.method ? ` · ${s.method}` : ''}`;
          el('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 3 }, sg);
          for (let i = 1; i < 5; i++) el('line', { x1: s.x + (s.w / 5) * i, y1: s.y + 3, x2: s.x + (s.w / 5) * i, y2: s.y + s.h - 3 }, sg);
          el('text', { x: s.cx, y: s.y - 5, class: 'stair-label', 'text-anchor': 'middle' }, sg).textContent = `↕${s.toLevel}`;
        }

        // 방 이름은 왼쪽 위 모서리에 둔다 (캐릭터가 서는 방 가운데를 비워 둔다)
        const lines = wrapLabel(room.name, room.w - 8);
        const label = el('text', { x: room.x + 12, y: room.y + 24, class: 'room-label', 'text-anchor': 'start' }, gLabels);
        lines.forEach((ln, i) => {
          el('tspan', { x: room.x + 12, dy: i === 0 ? 0 : 16 }, label).textContent = ln;
        });

        if (room.exteriorDoor) drawDoor(gDoors, room.exteriorDoor, WALL, DOOR_W, { exterior: true });
      }

      for (const c of layout.connections) {
        if (c.stairs) continue;
        if (c.door) drawDoor(gDoors, c.door, WALL, DOOR_W);
        else {
          drawDoor(gDoors, c.doorA, WALL, DOOR_W, { noLeaf: true });
          drawDoor(gDoors, c.doorB, WALL, DOOR_W, { noLeaf: true });
        }
      }

      for (const ch of characters) {
        const route = el('path', { class: 'route', stroke: ch.color, d: '' }, this.gRoutes);
        route.style.display = 'none';
        this.routes.set(ch.id, route);

        const g = el('g', { class: 'character', 'data-id': ch.id, visibility: 'hidden' }, this.gChars);
        // 지금 행동 중 표시: 동그라미 마커는 둘레 링, 이미지 마커는 발밑 타원
        if (ch.avatar) el('ellipse', { cy: 7, rx: 22, ry: 7, class: 'ring', stroke: ch.color }, g);
        else el('circle', { r: 22, class: 'ring', stroke: ch.color }, g);
        if (ch.avatar) {
          // 이미지 마커: 자르지 않은 캐릭터 그림이 발밑 그림자 위에 서 있다 (발끝이 위치 점 바로 아래)
          el('ellipse', { cy: 7, rx: 13, ry: 3.5, class: 'avatar-shadow' }, g);
          el('image', { href: ch.avatar, class: 'avatar-img', x: -AVATAR_SIZE / 2, y: 8 - AVATAR_SIZE, width: AVATAR_SIZE, height: AVATAR_SIZE, preserveAspectRatio: 'xMidYMax meet' }, g);
          this.tips.set(ch.id, 4 - AVATAR_SIZE); // 말풍선 꼬리는 머리 위에서
        } else {
          el('circle', { cy: 2, r: 13, class: 'shadow' }, g);
          el('circle', { r: 13, class: 'body', fill: ch.color }, g);
          this.tips.set(ch.id, -26);
        }
        if (!ch.avatar && ch.marker && ch.marker !== '●') {
          el('text', { class: 'marker', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g).textContent = ch.marker;
        }
        // 이름표: 방 이름 글자와 겹쳐도 읽히도록 흰 바탕 칩으로 둔다
        const chip = el('g', { class: 'name-chip' }, g);
        const chipBg = el('rect', { class: 'name-bg', y: 21, height: 19, rx: 9.5 }, chip);
        const nameEl = el('text', { y: 34.5, class: 'name', 'text-anchor': 'middle' }, chip);
        nameEl.textContent = ch.name;
        const nameW = (nameEl.getComputedTextLength() || ch.name.length * 11) + 14;
        chipBg.setAttribute('x', -nameW / 2);
        chipBg.setAttribute('width', nameW);

        // 말풍선 (마커와 함께 움직이도록 캐릭터 그룹 안에 둔다)
        const bubble = el('g', { class: 'bubble' }, g);
        bubble.style.display = 'none';
        el('path', { class: 'bubble-bg' }, bubble);
        el('g', { class: 'bubble-dots' }, bubble);
        el('g', { class: 'bubble-body' }, bubble);
        this.markers.set(ch.id, g);
        this.colors.set(ch.id, ch.color);
      }
    }

    /**
     * 캐릭터 위에 대사(speech) 또는 생각(thought) 풍선 표시. 행동은 지도 아래 자막으로 따로 보여 준다.
     * 여러 개를 띄운 뒤 arrangeBubbles()로 겹침을 푼다.
     */
    showBubble(id, { text = '', kind = 'speech' } = {}) {
      if (!this.markers.has(id)) return;
      if (!text) { this.bubbleData.delete(id); this.drawBubble(id, 0); return; }
      this.bubbleData.set(id, { text, kind });
      this.drawBubble(id, 0);
      const bubble = this.markers.get(id).querySelector('.bubble');
      bubble.classList.remove('pop');
      void bubble.getBBox(); // 애니메이션 다시 시작
      bubble.classList.add('pop');
    }

    /** below: 화면 위쪽이 모자랄 때 캐릭터 아래(이름표 밑)에 띄운다 */
    drawBubble(id, offsetX, below = false) {
      const g = this.markers.get(id);
      const bubble = g.querySelector('.bubble');
      const data = this.bubbleData.get(id);
      if (!data) {
        bubble.style.display = 'none';
        this.bubbleBox.delete(id);
        return;
      }
      const { text, kind } = data;
      const thought = kind === 'thought';
      bubble.style.display = '';
      bubble.classList.toggle('thought', thought);
      const bg = bubble.querySelector('.bubble-bg');
      // 대사는 캐릭터 대표색 바탕, 생각은 흰 바탕 (CSS)
      if (thought) bg.removeAttribute('style');
      else bg.style.fill = this.colors.get(id);
      const dots = bubble.querySelector('.bubble-dots');
      const body = bubble.querySelector('.bubble-body');
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      while (body.firstChild) body.removeChild(body.firstChild);

      // 대사는 자르지 않고 전부 보여 준다 (줄만 바꾼다)
      const LINE_H = 19;
      const padX = 12;
      const padY = 8;
      const lines = wrapText(text, 16);
      const boxH = lines.length * LINE_H + padY * 2;
      const { top, b, tip } = bubbleFrame(boxH, below, this.tips.get(id));

      // 글자를 먼저 놓고 폭을 잰 뒤 상자 크기를 정한다
      const items = lines.map((ln, i) => {
        const t = el('text', { class: 'bubble-text', y: top + padY + LINE_H * (i + 1) - 5 }, body);
        t.textContent = ln;
        return t;
      });
      let w = 0;
      for (const t of items) w = Math.max(w, t.getComputedTextLength() || t.textContent.length * 12);
      const boxW = Math.max(40, w + padX * 2);
      const l = offsetX - boxW / 2;
      const r = offsetX + boxW / 2;
      for (const t of items) t.setAttribute('x', l + padX);

      // 꼬리: 상자가 옆으로 밀려도 자기 마커를 가리키도록 상자 안쪽으로 한정
      const rx = thought ? 13 : 10;
      const tx = Math.max(l + 16, Math.min(r - 16, 0));
      // 꼬리는 위에 뜰 때 아랫변, 아래에 뜰 때 윗변에서 나온다
      const topEdge = below && !thought ? ` H${tx - 6} L0,${tip} L${tx + 6},${top}` : '';
      const bottomEdge = !below && !thought ? ` H${tx + 6} L0,${tip} L${tx - 6},${b}` : '';
      bg.setAttribute('d', `M${l + rx},${top}${topEdge} H${r - rx} A${rx},${rx} 0 0 1 ${r},${top + rx} V${b - rx} A${rx},${rx} 0 0 1 ${r - rx},${b}${bottomEdge} H${l + rx} A${rx},${rx} 0 0 1 ${l},${b - rx} V${top + rx} A${rx},${rx} 0 0 1 ${l + rx},${top} Z`);
      if (thought) {
        const edge = below ? top : b;
        const dir = below ? -1 : 1;
        el('circle', { class: 'bubble-dot', cx: tx * 0.55, cy: edge + dir * 4.5, r: 3 }, dots);
        el('circle', { class: 'bubble-dot', cx: tx * 0.2, cy: edge + dir * 10, r: 1.8 }, dots);
      }
      this.bubbleBox.set(id, { w: boxW, h: boxH, off: offsetX, below });
    }

    /**
     * 말풍선 자리 잡기: 보이는 영역(viewBox) 위로 넘치면 캐릭터 아래로 뒤집고,
     * 서로 겹치면 좌우로 벌리고, 옆으로 넘치면 안쪽으로 민다 (꼬리는 각자 마커를 가리킨다)
     */
    arrangeBubbles() {
      const vb = this.svg.viewBox.baseVal;
      const view = vb && vb.width ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : null;
      const EDGE = 6;
      const items = [...this.bubbleBox.entries()]
        .filter(([id]) => this.pos.has(id))
        .map(([id, bx]) => {
          const p = this.pos.get(id);
          const above = bubbleFrame(bx.h, false, this.tips.get(id));
          const below = !!view && p.y + above.top < view.y + EDGE;
          const f = bubbleFrame(bx.h, below, this.tips.get(id));
          return { id, x: p.x, w: bx.w, top: p.y + f.top, bot: p.y + f.b, off: 0, below, prev: bx };
        })
        .sort((a, b) => a.x - b.x);
      // 보이는 영역 안에서 움직일 수 있는 범위 (꼬리는 drawBubble이 상자 안쪽으로 한정해 마커를 계속 가리킨다)
      for (const it of items) {
        it.min = view ? view.x + EDGE + it.w / 2 - it.x : -Infinity;
        it.max = view ? view.x + view.w - EDGE - it.w / 2 - it.x : Infinity;
        it.off = Math.max(it.min, Math.min(it.max, 0));
      }
      const GAP = 8;
      for (let iter = 0; iter < 40; iter++) {
        let moved = false;
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const A = items[i];
            const B = items[j];
            if (A.bot + 4 < B.top || B.bot + 4 < A.top) continue;
            const overlap = (A.x + A.off + A.w / 2 + GAP) - (B.x + B.off - B.w / 2);
            if (overlap <= 0.5) continue;
            // 반씩 벌리되, 한쪽이 가장자리에 막히면 남은 만큼 다른 쪽이 더 움직인다
            const roomA = A.off - A.min;
            const roomB = B.max - B.off;
            let moveA = Math.min(roomA, overlap / 2);
            const moveB = Math.min(roomB, overlap - moveA);
            moveA = Math.min(roomA, overlap - moveB);
            if (moveA + moveB < 0.5) continue; // 둘 다 막혔으면 그대로 둔다
            A.off -= moveA;
            B.off += moveB;
            moved = true;
          }
        }
        if (!moved) break;
      }
      for (const it of items) {
        if (Math.abs(it.off - it.prev.off) > 0.5 || it.below !== it.prev.below) this.drawBubble(it.id, it.off, it.below);
      }
    }

    hideBubbles() {
      this.bubbleData.clear();
      this.bubbleBox.clear();
      for (const g of this.markers.values()) g.querySelector('.bubble').style.display = 'none';
    }

    setPosition(id, pt) {
      const g = this.markers.get(id);
      if (!g) return;
      if (!pt) {
        g.setAttribute('visibility', 'hidden');
        this.pos.delete(id);
        return;
      }
      g.removeAttribute('visibility');
      g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
      this.pos.set(id, { x: pt.x, y: pt.y });
    }

    showRoute(id, points) {
      const r = this.routes.get(id);
      if (!r) return;
      if (!points || points.length < 2) {
        r.style.display = 'none';
        return;
      }
      r.setAttribute('d', pathAttr(points));
      r.style.display = '';
    }

    clearRoutes() {
      for (const r of this.routes.values()) r.style.display = 'none';
    }

    setActive(ids) {
      const set = new Set(ids);
      for (const [id, g] of this.markers) g.classList.toggle('active', set.has(id));
    }

    /** 처음 등장하는 캐릭터를 서서히 나타나게 한다 */
    appear(id) {
      const g = this.markers.get(id);
      if (!g) return;
      g.classList.remove('appear');
      void g.getBBox();
      g.classList.add('appear');
    }

    setMoving(id, moving) {
      const g = this.markers.get(id);
      if (g) g.classList.toggle('moving', !!moving);
    }

    highlightRooms(names) {
      const set = new Set(names);
      for (const [name, g] of this.roomEls) g.classList.toggle('active', set.has(name));
    }
  }

  return { Renderer };
})();
