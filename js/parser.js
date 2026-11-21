/* ===========================================================
 * OOC 파서 (2단계 입력)
 *  1단계 parseHouse(text)        → { house, adjacency, errors, warnings }
 *  2단계 parseSchedule(text, house) → { characters, schedule, errors, warnings }
 * 레이아웃·렌더링과 독립적으로 동작한다.
 *
 * 오류 객체: { line, value, message, fix }
 *   line: 1부터 시작하는 줄 번호 (전체 문서 문제는 null)
 * =========================================================== */
const OOCParser = (() => {
  const HOUSE_SECTIONS = ['HOUSE', 'ROOMS', 'CONNECTIONS'];
  const SCHEDULE_SECTIONS = ['CHARACTERS', 'SCHEDULE'];
  const TIME_RE = /^(\d{1,2}):([0-5]\d)$/;
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const DEFAULT_COLORS = ['#F06292', '#5688E8', '#4DB6AC', '#FFB74D', '#9575CD', '#E57373'];
  const BULLET_RE = /^(?:[-•*·▪●○◦]|\d+[.)])\s*/;

  const connKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** 인접 리스트 기반 BFS 최단 경로. 없으면 null. */
  function shortestPath(adj, from, to) {
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const u = queue.shift();
      for (const v of adj.get(u) || []) {
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === to) {
          const path = [];
          for (let n = v; n !== null; n = prev.get(n)) path.unshift(n);
          return path;
        }
        queue.push(v);
      }
    }
    return null;
  }

  /** "지하 1층" → -1, "2층" → 2, "옥상층" → 'roof', 모르면 null */
  function floorOf(text) {
    const s = String(text || '');
    let m = s.match(/지하\s*(\d+)/) || s.match(/\bB\s*(\d+)/i);
    if (m) return -Number(m[1]);
    if (/옥상|루프|rooftop|roof/i.test(s)) return 'roof';
    m = s.match(/(\d+)\s*층/) || s.match(/(\d+)\s*F\b/i);
    if (m) return Number(m[1]);
    return null;
  }

  /** "북동쪽" → {x:1,y:-1}. 남쪽이 +y(화면 아래). 방향 단서가 없으면 null */
  function positionOf(text) {
    const s = String(text || '');
    const x = (/동/.test(s) ? 1 : 0) - (/서/.test(s) ? 1 : 0);
    const y = (/남/.test(s) ? 1 : 0) - (/북/.test(s) ? 1 : 0);
    if (x || y) return { x, y };
    if (/중앙|가운데|중심/.test(s)) return { x: 0, y: 0 };
    return null;
  }

  const floorLabel = (f) => (f < 0 ? `지하 ${-f}층` : `${f}층`);

  const DAY = 24 * 60;
  const ROLLOVER_GAP = 6 * 60; // 이만큼 넘게 시각이 뒤로 가면 자정을 넘긴 것으로 본다

  /**
   * 적힌 순서(줄 번호)대로 보며 자정을 넘긴 줄에 하루를 더한다.
   * ev.minutes는 첫날 0시 기준 누적 분, ev.day는 0(첫날)/1(다음 날)…
   * items: { line, minutes }가 있는 배열 (다른 곳에서도 같은 규칙을 쓰도록 공개)
   */
  function rollOverMidnight(items) {
    let offset = 0;
    let last = null;
    for (const ev of [...items].sort((a, b) => a.line - b.line)) {
      if (last !== null && ev.minutes + offset < last - ROLLOVER_GAP) offset += DAY;
      ev.minutes += offset;
      ev.day = offset / DAY;
      last = ev.minutes;
    }
    return items;
  }

  /* 채팅 플랫폼이 답 끝에 붙이는 문구 */
  const WATERMARK_RE = /\s*이 대화는 AI로 만들어진 가상의 대화입니다\.?/g;
  const ALL_SECTIONS = [...HOUSE_SECTIONS, ...SCHEDULE_SECTIONS];
  const TIME_LINE_RE = /^\d{1,2}:\d{2}\s*\|/;

  /**
   * 섹션별 데이터 줄 판별. 'data' 읽음 / 'skip' 건너뜀 / 'end' 섹션이 끝난 것으로 본다.
   * 채팅 기록을 통째로 붙여넣어도 AI 답 뒤의 서술·다른 OOC가 섹션 내용으로 섞이지 않게 한다.
   */
  function classify(section, line) {
    const body = line.replace(BULLET_RE, '').trim();
    switch (section) {
      case 'HOUSE':
        if (/^(ROOM|CONNECTION)\s*:/i.test(body)) return 'data';
        return /^[^:：[\]]{1,12}[:：]/.test(body) ? 'data' : 'end';
      case 'ROOMS':
      case 'CONNECTIONS':
        if (/[[\]]/.test(body)) return 'end';
        if (/^공간명\s*\|/.test(body)) return 'skip'; // OOC 양식의 자리표시 줄
        return body.includes('|') || (section === 'ROOMS' && BULLET_RE.test(line)) ? 'data' : 'end';
      case 'CHARACTERS':
        if (/^CHARACTER\s*:/i.test(body)) return 'data';
        return /^[A-Za-z가-힣0-9_]+\s*\|\s*name\s*=/i.test(body) ? 'data' : 'end';
      case 'SCHEDULE':
        // 시각으로 시작하는 줄만 읽는다. 양식의 "HH:MM | ..." 자리표시나 서술은 건너뛴다
        return TIME_LINE_RE.test(body) ? 'data' : 'skip';
      default:
        return 'skip';
    }
  }

  /* 섹션 헤더 처리 공통: 줄 → { type: 'section'|'line', ... }. 이 단계 섹션이 아닌 것은 내용째 건너뛴다 */
  function splitLines(text, known) {
    const out = [];
    let section = null;
    const lines = String(text || '').split(/\r?\n/);
    const enter = (name, lineNo) => {
      section = known.includes(name) ? name : null;
      if (section) out.push({ type: 'section', name, lineNo });
    };
    lines.forEach((raw, i) => {
      const lineNo = i + 1;
      let line = raw.replace(WATERMARK_RE, '').trim();
      if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('```')) return;
      const sec = line.match(/^\[([^\]]+)\]$/);
      if (sec) {
        const name = sec[1].trim().toUpperCase();
        if (ALL_SECTIONS.includes(name)) enter(name, lineNo);
        else section = null; // [규칙], [출력 예시], [OOC: ...] 같은 머리말: 내용째 건너뛴다
        return;
      }
      // 줄 바꿈이 빠져 "…대사 [SCHEDULE]"처럼 헤더가 줄 끝에 붙은 경우
      const tail = line.match(/^(.*\S)\s*\[(HOUSE|ROOMS|CONNECTIONS|CHARACTERS|SCHEDULE)\]$/i);
      let next = null;
      if (tail) { line = tail[1]; next = tail[2].toUpperCase(); }
      if (section) {
        const kind = classify(section, line);
        if (kind === 'data') out.push({ type: 'line', section, lineNo, line: line.replace(BULLET_RE, '').trim() });
        else if (kind === 'end') section = null;
      }
      if (next) enter(next, lineNo);
    });
    return out;
  }

  /* ===========================================================
   * 1단계: 집 구조
   * =========================================================== */
  function parseHouse(text) {
    const errors = [];
    const warnings = [];
    const meta = [];
    const rooms = [];
    const connections = [];
    const roomLines = new Map();
    const seenSections = new Set();

    const addError = (line, value, message, fix) => errors.push({ line, value, message, fix });
    const addWarning = (line, value, message, fix) => warnings.push({ line, value, message, fix });

    function addRoom(name, lineNo, fields = {}) {
      if (!name) {
        addError(lineNo, '', '공간명이 비어 있습니다.', '`- 거실 | 1층 | 남쪽 | 용도`처럼 공간명을 먼저 적으세요.');
        return;
      }
      if (/[|>]/.test(name)) {
        addError(lineNo, name, '공간명에 구분자(|, >)를 쓸 수 없습니다.', '구분자를 뺀 이름으로 바꾸세요.');
        return;
      }
      if (roomLines.has(name)) {
        addError(lineNo, name, `공간명 "${name}"이(가) ${roomLines.get(name)}줄과 중복됩니다.`, '공간명은 고유해야 합니다. 하나를 지우거나 이름을 바꾸세요.');
        return;
      }
      roomLines.set(name, lineNo);
      rooms.push({
        name,
        line: lineNo,
        floorText: fields.floor || '',
        floor: floorOf(fields.floor) ?? floorOf(name),
        positionText: fields.position || '',
        position: positionOf(fields.position),
        purpose: fields.purpose || '',
        implicit: !!fields.implicit,
      });
    }

    function addConnection(a, b, method, lineNo, raw) {
      if (!a || !b) {
        addError(lineNo, raw, '연결은 두 공간명이 필요합니다.', '`- 거실 | 주방 | 오픈형 통로` 형식으로 쓰세요.');
        return;
      }
      if (a === b) {
        addError(lineNo, raw, '같은 공간을 자기 자신과 연결할 수 없습니다.', '서로 다른 두 공간을 적으세요.');
        return;
      }
      connections.push({ a, b, method: method || '', line: lineNo });
    }

    // 같은 섹션이 다시 나오면(채팅 기록에 OOC와 답이 여러 번 있는 경우) 내용이 있는 마지막 것을 쓴다
    const resetPending = new Set();
    for (const item of splitLines(text, HOUSE_SECTIONS)) {
      if (item.type === 'section') {
        if (seenSections.has(item.name)) resetPending.add(item.name);
        seenSections.add(item.name);
        continue;
      }
      const { section, lineNo, line } = item;
      if (resetPending.delete(section)) {
        if (section === 'HOUSE') meta.length = 0;
        if (section === 'ROOMS') { rooms.length = 0; roomLines.clear(); }
        if (section === 'CONNECTIONS') connections.length = 0;
      }
      if (section === 'HOUSE') {
        // 예전 형식: ROOM: 이름 / CONNECTION: 방A-방B
        const legacy = line.match(/^(ROOM|CONNECTION)\s*:\s*(.*)$/i);
        if (legacy) {
          const value = normName(legacy[2]);
          if (legacy[1].toUpperCase() === 'ROOM') addRoom(value, lineNo);
          else {
            const parts = value.split('-').map(normName);
            if (parts.length !== 2) addError(lineNo, value, '연결은 정확히 두 방 이름을 `-`로 이어야 합니다.', '예: `CONNECTION: 거실-주방`');
            else addConnection(parts[0], parts[1], '', lineNo, value);
          }
          continue;
        }
        const kv = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (kv && kv[2].trim()) meta.push({ key: kv[1].trim(), value: kv[2].trim() });
      } else if (section === 'ROOMS') {
        const [name, floor, position, ...rest] = line.split('|').map((s) => s.trim());
        addRoom(normName(name), lineNo, { floor, position, purpose: rest.join(' | ') });
      } else {
        const parts = line.split('|').map((s) => s.trim());
        if (parts.length < 2) {
          addError(lineNo, line, '연결 줄은 `공간명 | 연결된 공간명 | 연결 방식` 형식이어야 합니다.', '공간명 사이를 `|`로 구분하세요.');
          continue;
        }
        addConnection(normName(parts[0]), normName(parts[1]), parts.slice(2).join(' | '), lineNo, line);
      }
    }

    /* ---------- 문서 전체 검증 ---------- */
    if (!seenSections.size) {
      addError(null, '', '집 구조 섹션을 찾지 못했습니다.', '[ROOMS]와 [CONNECTIONS] 섹션이 포함된 집 구조 OOC를 붙여넣으세요.');
    }

    // 연결에만 나온 공간(예: 2층 중앙 홀)은 자동으로 추가
    const declared = new Set(rooms.map((r) => r.name));
    for (const c of connections) {
      for (const n of [c.a, c.b]) {
        if (declared.has(n)) continue;
        declared.add(n);
        addRoom(n, c.line, { implicit: true });
        addWarning(c.line, n, `"${n}"은(는) [ROOMS]에 없어서 연결 정보로 자동 추가했습니다.`, '오타라면 [ROOMS]의 공간명과 똑같이 맞추세요.');
      }
    }
    if (!rooms.length && seenSections.size) {
      addError(null, '[ROOMS]', '선언된 공간이 없습니다.', '[ROOMS] 아래에 `- 공간명 | 층수 | 위치 | 용도`를 하나 이상 적으세요.');
    }

    const adj = new Map(rooms.map((r) => [r.name, []]));
    const seenConn = new Set();
    const validConnections = [];
    for (const c of connections) {
      const k = connKey(c.a, c.b);
      if (seenConn.has(k)) {
        addWarning(c.line, `${c.a} | ${c.b}`, '이미 선언된 연결입니다. 중복은 무시됩니다.', '중복 줄을 지워도 됩니다.');
        continue;
      }
      seenConn.add(k);
      validConnections.push(c);
      adj.get(c.a).push(c.b);
      adj.get(c.b).push(c.a);
    }

    /* ---------- 층 정리 ---------- */
    const numeric = rooms.map((r) => r.floor).filter((f) => typeof f === 'number');
    const roofFloor = (numeric.length ? Math.max(...numeric) : 1) + 1;
    const roofs = rooms.filter((r) => r.floor === 'roof');
    for (const r of roofs) r.floor = roofFloor;
    // 층을 모르는 공간은 이웃의 층을 물려받는다(없으면 1층)
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rooms) {
        if (r.floor !== null) continue;
        const nb = adj.get(r.name).map((n) => rooms.find((x) => x.name === n)).find((x) => x.floor !== null);
        if (nb) { r.floor = nb.floor; changed = true; }
      }
    }
    for (const r of rooms) {
      if (r.floor === null) r.floor = 1;
      r.floorLabel = roofs.length && r.floor === roofFloor ? '옥상' : floorLabel(r.floor);
    }
    const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b)
      .map((f) => ({ floor: f, label: rooms.find((r) => r.floor === f).floorLabel }));

    // 연결이 끊긴 영역 경고 (계단 연결 포함)
    if (rooms.length > 1) {
      const visited = new Set();
      const comps = [];
      for (const r of rooms) {
        if (visited.has(r.name)) continue;
        const comp = [];
        const stack = [r.name];
        visited.add(r.name);
        while (stack.length) {
          const u = stack.pop();
          comp.push(u);
          for (const v of adj.get(u)) if (!visited.has(v)) { visited.add(v); stack.push(v); }
        }
        comps.push(comp);
      }
      if (comps.length > 1) {
        addWarning(null, comps.map((c) => c.join(', ')).join(' / '), `서로 연결되지 않은 영역이 ${comps.length}개 있습니다. 그 사이로는 이동할 수 없습니다.`, '하나의 집으로 묶으려면 영역 사이에 연결을 추가하세요.');
      }
    }

    return {
      house: { meta, rooms, connections: validConnections, floors },
      adjacency: adj,
      errors,
      warnings,
    };
  }

  /* ===========================================================
   * 2단계: 캐릭터와 동선
   * =========================================================== */
  /** opts.names: 유저가 입력한 캐릭터 이름 [1번, 2번]. [CHARACTERS]가 없으면 이것으로 PC, NPC를 만든다 */
  function parseSchedule(text, house, opts = {}) {
    const errors = [];
    const warnings = [];
    const characters = [];
    const schedule = [];
    const charLines = new Map();
    const seenSections = new Set();

    const addError = (line, value, message, fix) => errors.push({ line, value, message, fix });
    const addWarning = (line, value, message, fix) => warnings.push({ line, value, message, fix });

    const roomNames = house.rooms.map((r) => r.name);
    const roomSet = new Set(roomNames);
    const adj = new Map(roomNames.map((n) => [n, []]));
    const seenConn = new Set();
    for (const c of house.connections) {
      seenConn.add(connKey(c.a, c.b));
      adj.get(c.a).push(c.b);
      adj.get(c.b).push(c.a);
    }

    /* 공간명 해석: 정확히 일치 → 공백 무시 일치 → 한쪽이 다른 쪽을 포함하는 유일한 후보 */
    const squash = (s) => s.replace(/\s+/g, '');
    const resolved = new Map();
    function resolveRoom(raw, lineNo) {
      const name = normName(raw);
      if (roomSet.has(name)) return name;
      if (resolved.has(name)) return resolved.get(name);
      let hit = roomNames.find((r) => squash(r) === squash(name));
      if (!hit) {
        const cands = roomNames.filter((r) => squash(r).includes(squash(name)) || squash(name).includes(squash(r)));
        if (cands.length === 1) [hit] = cands;
      }
      if (hit) {
        resolved.set(name, hit);
        addWarning(lineNo, name, `"${name}"을(를) "${hit}"(으)로 읽었습니다.`, '정확한 공간명을 쓰면 이 경고가 사라집니다.');
        return hit;
      }
      const near = roomNames.filter((r) => [...name].some((ch) => ch.trim() && r.includes(ch))).slice(0, 4);
      addError(lineNo, name, `공간 "${name}"이(가) 집 구조에 없습니다.`,
        near.length ? `집 구조의 공간명을 그대로 쓰세요. 예: ${near.join(', ')}` : `집 구조의 공간명을 그대로 쓰세요: ${roomNames.join(', ')}`);
      return null;
    }

    function parseCharacter(line, lineNo) {
      const body = line.replace(/^CHARACTER\s*:\s*/i, '');
      const parts = body.split('|').map((s) => s.trim());
      const id = parts[0];
      if (!id) {
        addError(lineNo, line, '캐릭터 ID가 비어 있습니다.', '`CHARACTER: PC | name=...`처럼 ID를 먼저 적으세요.');
        return;
      }
      // 나눠 받은 답을 이어 붙이면 같은 캐릭터가 다시 나올 수 있다: 처음 선언만 쓴다
      if (charLines.has(id)) return;
      const ch = {
        id,
        name: id,
        color: DEFAULT_COLORS[characters.length % DEFAULT_COLORS.length],
        marker: '●',
        line: lineNo,
      };
      for (const attr of parts.slice(1)) {
        if (!attr) continue;
        const eq = attr.indexOf('=');
        if (eq < 0) {
          addError(lineNo, attr, `속성 "${attr}"의 형식이 잘못되었습니다.`, '`name=값`처럼 `=`로 키와 값을 구분하세요.');
          continue;
        }
        const k = attr.slice(0, eq).trim().toLowerCase();
        const v = attr.slice(eq + 1).trim();
        if (k === 'name') {
          if (!v) addError(lineNo, attr, 'name 값이 비어 있습니다.', '표시할 이름을 적거나 속성을 지우세요.');
          else ch.name = v;
        } else if (k === 'color') {
          if (!HEX_RE.test(v)) addError(lineNo, v, `색상값 "${v}"이(가) 올바른 HEX 형식이 아닙니다.`, '`#F06292`처럼 # 뒤에 6자리(또는 3자리) 16진수로 적으세요.');
          else ch.color = v;
        } else if (k === 'marker') {
          ch.marker = v || '●';
        } else {
          addWarning(lineNo, attr, `알 수 없는 속성 "${k}"은(는) 무시됩니다.`, 'name, color, marker만 지원합니다.');
        }
      }
      charLines.set(id, lineNo);
      characters.push(ch);
    }

    const seenEvents = new Set();
    function parseEvent(line, lineNo) {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length < 4) {
        addError(lineNo, line, `시간표 줄은 4~5개 필드여야 하는데 ${parts.length}개입니다.`, '`HH:MM | 캐릭터ID | 행동 | 공간` 또는 `HH:MM | 캐릭터ID | 행동 | 공간A>공간B | 대사` 형식으로 쓰세요.');
        return;
      }
      // 대사 안에 | 가 들어간 경우는 나머지를 모두 대사로 본다
      const [time, charId, action, loc] = parts;
      const sayRaw = parts.slice(4).join(' | ');
      // 같은 답을 두 번 붙여넣은 경우: 완전히 같은 줄은 한 번만 쓴다
      const key = parts.join('|');
      if (seenEvents.has(key)) return;
      seenEvents.add(key);
      // 5번째 필드: 대사. 괄호로 감싸면 생각, 아니면 말풍선
      let say = null;
      if (sayRaw) {
        const thought = sayRaw.match(/^[(（]\s*(.*?)\s*[)）]$/);
        const text = (thought ? thought[1] : sayRaw).replace(/^["“]|["”]$/g, '').trim();
        if (text) say = { text, kind: thought ? 'thought' : 'speech' };
      }
      let ok = true;
      const tm = time.match(TIME_RE);
      if (!tm || Number(tm[1]) > 23) {
        addError(lineNo, time, `시각 "${time}"이(가) HH:MM(24시간) 형식이 아닙니다.`, '예: 07:05, 18:30');
        ok = false;
      }
      if (!charId) {
        addError(lineNo, line, '캐릭터 ID가 비어 있습니다.', '두 번째 필드에 [CHARACTERS]에 선언한 ID를 적으세요.');
        ok = false;
      }
      if (!action) {
        addError(lineNo, line, '행동이 비어 있습니다.', '세 번째 필드에 행동을 적으세요. 예: 기상, 아침 식사');
        ok = false;
      }
      if (!loc) {
        addError(lineNo, line, '위치/경로가 비어 있습니다.', '네 번째 필드에 공간명 또는 `공간A>공간B` 경로를 적으세요.');
        ok = false;
      }
      let route = null;
      let room = null;
      if (loc) {
        const names = loc.split('>').map((s) => s.trim());
        if (names.some((r) => !r)) {
          addError(lineNo, loc, '경로에 빈 공간명이 있습니다.', '`>` 앞뒤에 공간명을 빠짐없이 적으세요. 예: 침실>거실>주방');
          ok = false;
        } else {
          const res = names.map((n) => resolveRoom(n, lineNo));
          if (res.some((r) => !r)) ok = false;
          else if (res.length > 1) route = res;
          else [room] = res;
        }
      }
      if (!ok) return;
      const hh = String(Number(tm[1])).padStart(2, '0');
      schedule.push({
        line: lineNo,
        time: `${hh}:${tm[2]}`,
        minutes: Number(tm[1]) * 60 + Number(tm[2]),
        charId,
        action,
        room,
        route,
        say,
      });
    }

    for (const item of splitLines(text, SCHEDULE_SECTIONS)) {
      if (item.type === 'section') { seenSections.add(item.name); continue; }
      if (item.section === 'CHARACTERS') parseCharacter(item.line, item.lineNo);
      else parseEvent(item.line, item.lineNo);
    }

    /* ---------- 문서 전체 검증 ---------- */
    const names = (opts.names || []).map((n) => String(n || '').trim());
    if (!seenSections.has('CHARACTERS') && names.some(Boolean)) {
      names.forEach((name, i) => {
        if (!name) return;
        characters.push({ id: ['PC', 'NPC'][i] || String(i + 1), name, color: DEFAULT_COLORS[i % DEFAULT_COLORS.length], marker: '●', line: null });
      });
      seenSections.add('CHARACTERS');
    }
    if (!schedule.length) {
      addError(null, '[SCHEDULE]', '동선 줄을 찾지 못했습니다.', 'AI 답의 [SCHEDULE] 아래 `07:00 | PC | 행동 | 공간` 같은 줄이 들어 있는지 확인하세요.');
    }

    // [CHARACTERS]에 없는 ID(예: PC/NPC만 쓰고 선언을 빠뜨린 경우)는 그 ID로 캐릭터를 만든다
    const charIds = new Set(characters.map((c) => c.id));
    for (const ev of schedule) {
      if (charIds.has(ev.charId)) continue;
      charIds.add(ev.charId);
      const i = characters.length;
      characters.push({ id: ev.charId, name: ev.charId, color: DEFAULT_COLORS[i % DEFAULT_COLORS.length], marker: '●', line: null });
    }
    const slotOf = (c) => ({ PC: 0, NPC: 1 }[c.id.toUpperCase()] ?? 9);
    characters.sort((x, y) => slotOf(x) - slotOf(y));

    /* AI 답의 끊긴 이동은 집 구조의 최단 경로로 이어 붙이고, 고친 줄은 모아서 한 번에 알린다 */
    const fixed = [];
    const unreachable = [];
    const join = (path, more) => [...path, ...more.slice(1)];
    for (const ev of schedule) {
      if (!ev.route) continue;
      let route = [ev.route[0]];
      for (let i = 1; i < ev.route.length; i++) {
        const a = route[route.length - 1];
        const b = ev.route[i];
        if (a === b) continue; // 같은 공간이 연달아 나오면 하나로
        if (seenConn.has(connKey(a, b))) { route.push(b); continue; }
        const gap = shortestPath(adj, a, b);
        if (!gap) { unreachable.push(ev); ev.invalid = true; break; }
        route = join(route, gap); // AI가 걸어간다고 적은 이동이라 중간 공간만 채운다 (화면 조정 카드는 띄우지 않음)
        if (!fixed.includes(ev.line)) fixed.push(ev.line);
      }
      if (route.length > 1) ev.route = route;
      else { ev.room = route[0]; ev.route = null; }
    }

    // 자정 넘김: AI가 적은 순서대로 보며 시각이 크게(6시간 넘게) 뒤로 가면 다음 날로 본다
    // (예: 23:30 다음의 00:15는 아침이 아니라 다음 날 새벽). 조금 뒤로 가는 건 순서만 바로잡는다
    rollOverMidnight(schedule);

    // 시각순 정렬(같은 시각은 입력 순서 유지) 후 위치 연속성: 직전 위치와 시작 공간이 다르면 경로를 앞에 이어 붙인다
    schedule.sort((x, y) => x.minutes - y.minutes || x.line - y.line);
    const pos = new Map();
    const seenSlot = new Map();
    for (const ev of schedule) {
      if (ev.invalid) continue;
      const slot = `${ev.minutes}|${ev.charId}`;
      if (seenSlot.has(slot)) {
        addWarning(ev.line, `${ev.time} ${ev.charId}`, `${ev.charId}의 ${ev.time} 줄이 ${seenSlot.get(slot)}줄에도 있습니다. 나중 줄을 씁니다.`, '');
      }
      seenSlot.set(slot, ev.line);

      const cur = pos.get(ev.charId);
      const start = ev.route ? ev.route[0] : ev.room;
      if (cur && cur !== start) {
        const lead = shortestPath(adj, cur, start);
        if (!lead) { unreachable.push(ev); ev.invalid = true; continue; }
        ev.route = join(lead, ev.route || [ev.room]);
        ev.room = null;
        ev.implicit = true; // 직전 위치에서 사라져 다른 곳에 나타남: 재생 때 화면 조정 카드 대상
        if (!fixed.includes(ev.line)) fixed.push(ev.line);
      }
      pos.set(ev.charId, ev.route ? ev.route[ev.route.length - 1] : ev.room);
    }

    for (const ev of unreachable) {
      addError(ev.line, ev.route ? ev.route.join('>') : ev.room, '집 구조에서 서로 이어지지 않은 공간으로 이동합니다.', '1단계 집 구조에 두 공간 사이의 연결을 추가하세요.');
    }
    if (fixed.length) {
      fixed.sort((a, b) => a - b);
      addWarning(null, `${fixed.join(', ')}줄`, `AI 답에서 중간 공간이 빠진 이동 ${fixed.length}곳을 집 구조의 최단 경로로 이어 붙였습니다.`, '');
    }

    return { characters, schedule, errors, warnings };
  }

  return { parseHouse, parseSchedule, shortestPath, connKey, rollOverMidnight };
})();
