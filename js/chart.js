// 의존성 없는 상호작용 SVG 라인 차트 — 호버 툴팁 + 가로 확대(면적 고정, 스크롤)
// series: [{ label, color, values: number[], dash?: bool }], labels: string[](날짜)
// 그리는 건 lineChart()가 아니라 bindCharts()가 (마운트 후 실제 폭을 재서) 한다.

export function moneyShort(v) {
  if (v == null || isNaN(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(a >= 1e9 ? 0 : 1) + '억';
  if (a >= 1e4) return Math.round(v / 1e4).toLocaleString() + '만';
  return Math.round(v).toLocaleString();
}

const registry = new Map(); // id -> { series, labels, height, format, zoom, geom, lastW }
let seq = 0;

// 표 안에 넣는 초소형 추세선. 값 배열만 받아 SVG 한 조각을 돌려준다.
// 구간 등락(첫값 대비 끝값)으로 색을 정한다 — 오름 빨강/내림 파랑(국내 관행, CSS 변수 사용).
export function sparkline(values, { w = 76, h = 24, pad = 2 } = {}) {
  const v = (values || []).filter(x => x != null && isFinite(x));
  if (v.length < 2) return `<span class="spark-none">–</span>`;
  let min = Math.min(...v), max = Math.max(...v);
  if (min === max) { min -= 1; max += 1; }
  const n = v.length;
  const x = i => (pad + (w - pad * 2) * i / (n - 1)).toFixed(1);
  const y = k => (pad + (h - pad * 2) * (1 - (k - min) / (max - min))).toFixed(1);
  let d = '';
  for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i) + ' ' + y(v[i]);
  const up = v[n - 1] >= v[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${x(n - 1)}" cy="${y(v[n - 1])}" r="1.8" fill="${color}"/></svg>`;
}

// 셸만 반환한다(툴바·스크롤 영역·툴팁·범례). 실제 SVG는 bindCharts에서 그린다.
// markers: [{date, label}] — 그 날짜에 세로 점선과 라벨을 찍는다(자본이 한 번에 조정된 지점 표시용).
export function lineChart({ series, labels, height = 300, format = moneyShort, markers = [] }) {
  const id = 'ch' + (++seq);
  registry.set(id, { series, labels, height, format, markers, zoom: 1, geom: null, lastW: 0 });
  const legend = series.map(s =>
    `<span><span class="sw" style="background:${s.color}"></span>${s.label}</span>`).join('');
  return `
    <div class="chartbox" data-chart="${id}">
      <div class="chart-toolbar">
        <button type="button" class="btn small" data-zoom="in">확대 +</button>
        <button type="button" class="btn small" data-zoom="reset">전체</button>
        <span class="chart-zoom muted small"></span>
        <span class="chart-hint muted small">선 위에 마우스를 올리면 값이 보입니다</span>
      </div>
      <div class="chart-scroll" style="height:${height}px"></div>
      <div class="chart-tip" hidden></div>
      <div class="legend">${legend}</div>
    </div>`;
}

function geomFor(cfg, W, H) {
  const padL = 56, padR = 12, padT = 12, padB = 26;
  const all = cfg.series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let min = all.length ? Math.min(...all) : 0, max = all.length ? Math.max(...all) : 1;
  if (min === max) { min -= 1; max += 1; }
  const span = max - min; min -= span * 0.05; max += span * 0.05;
  return { W, H, padL, padR, padT, padB, min, max, n: cfg.labels.length };
}
const gx = (G, i) => G.padL + (G.n <= 1 ? 0 : (G.W - G.padL - G.padR) * i / (G.n - 1));
const gy = (G, v) => G.padT + (G.H - G.padT - G.padB) * (1 - (v - G.min) / (G.max - G.min));

function svgFor(cfg, W, H) {
  const G = geomFor(cfg, W, H);
  cfg.geom = G;
  const plotW = W - G.padL - G.padR;
  let g = '';
  for (let k = 0; k <= 4; k++) { // y 눈금
    const v = G.min + (G.max - G.min) * k / 4, yy = gy(G, v);
    g += `<line x1="${G.padL}" y1="${yy}" x2="${W - G.padR}" y2="${yy}" stroke="currentColor" stroke-opacity="0.09"/>`;
    g += `<text x="${G.padL - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity="0.55">${moneyShort(v)}</text>`;
  }
  const ticks = Math.max(3, Math.min(12, Math.round(plotW / 90))); // 확대할수록 촘촘히
  for (let k = 0; k <= ticks; k++) { // x 라벨
    const i = Math.round((G.n - 1) * k / ticks);
    if (i < 0 || i >= G.n) continue;
    const anchor = k === 0 ? 'start' : k === ticks ? 'end' : 'middle';
    g += `<text x="${gx(G, i)}" y="${H - 8}" text-anchor="${anchor}" font-size="11" fill="currentColor" fill-opacity="0.55">${(cfg.labels[i] || '').slice(0, 7)}</text>`;
  }
  for (const s of cfg.series) { // 선
    let d = '', pen = false;
    for (let i = 0; i < G.n; i++) {
      const v = s.values[i];
      if (v == null || !isFinite(v)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + gx(G, i).toFixed(1) + ' ' + gy(G, v).toFixed(1);
      pen = true;
    }
    if (d) g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6" ${s.dash ? 'stroke-dasharray="5 4" stroke-width="1.2"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  // 표시 지점(현금 입력으로 자본이 조정된 날) — 세로 점선 + 위쪽 라벨
  for (const mk of (cfg.markers || [])) {
    const i = cfg.labels.indexOf(mk.date);
    if (i < 0) continue;
    const mx = gx(G, i);
    g += `<line x1="${mx.toFixed(1)}" y1="${G.padT}" x2="${mx.toFixed(1)}" y2="${H - G.padB}" `
       + `stroke="currentColor" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3"/>`;
    const anchor = mx > W - 90 ? 'end' : 'start';
    const tx = anchor === 'end' ? mx - 4 : mx + 4;
    g += `<text x="${tx.toFixed(1)}" y="${G.padT + 10}" text-anchor="${anchor}" font-size="10.5" `
       + `fill="currentColor" fill-opacity="0.7">${mk.label}</text>`;
  }
  g += `<g class="hoverlayer"></g>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block" role="img">${g}</svg>`;
}

// 뷰 렌더 후 호출 — 각 차트에 실제 폭 기준 그리기·확대·호버를 붙인다.
export function bindCharts(root) {
  for (const box of root.querySelectorAll('.chartbox')) initBox(box);
}

function initBox(box) {
  const id = box.dataset.chart;
  const cfg = registry.get(id);
  if (!cfg) return;
  const scroll = box.querySelector('.chart-scroll');
  const tip = box.querySelector('.chart-tip');
  const zlabel = box.querySelector('.chart-zoom');

  const hideTip = () => {
    tip.hidden = true;
    const hl = scroll.querySelector('.hoverlayer');
    if (hl) hl.innerHTML = '';
  };
  const draw = () => {
    const Cw = scroll.clientWidth || 320;
    const W = Math.max(Cw, Math.round(Cw * cfg.zoom));
    cfg.lastW = Cw;
    scroll.innerHTML = svgFor(cfg, W, cfg.height);
    scroll.scrollLeft = cfg.zoom > 1 ? scroll.scrollWidth : 0; // 확대 시 최신(오른쪽)부터
    zlabel.textContent = cfg.zoom > 1.05 ? `×${cfg.zoom.toFixed(1)}` : '';
    hideTip();
  };

  box.querySelector('[data-zoom=in]').addEventListener('click', () => { cfg.zoom = Math.min(cfg.zoom * 1.7, 8); draw(); });
  box.querySelector('[data-zoom=reset]').addEventListener('click', () => { cfg.zoom = 1; draw(); });

  const showAt = (clientX, clientY) => {
    const svg = scroll.querySelector('svg');
    const G = cfg.geom;
    if (!svg || !G || G.n < 1) return;
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width * G.W;
    let i = Math.round((px - G.padL) / Math.max(1, G.W - G.padL - G.padR) * (G.n - 1));
    i = Math.max(0, Math.min(G.n - 1, i));
    const cx = gx(G, i);
    let ov = `<line x1="${cx.toFixed(1)}" y1="${G.padT}" x2="${cx.toFixed(1)}" y2="${G.H - G.padB}" stroke="currentColor" stroke-opacity="0.28"/>`;
    const rows = [];
    for (const s of cfg.series) {
      const v = s.values[i];
      const ok = v != null && isFinite(v);
      if (ok) ov += `<circle cx="${cx.toFixed(1)}" cy="${gy(G, v).toFixed(1)}" r="3.4" fill="${s.color}" stroke="var(--card)" stroke-width="1.3"/>`;
      rows.push(`<div class="tip-row"><span class="sw" style="background:${s.color}"></span><span class="tip-nm">${s.label}</span><span class="tip-v">${ok ? cfg.format(v) : '—'}</span></div>`);
    }
    const hl = svg.querySelector('.hoverlayer');
    if (hl) hl.innerHTML = ov;
    tip.innerHTML = `<div class="tip-date">${cfg.labels[i] || ''}</div>${rows.join('')}`;
    tip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = clientX - boxRect.left + 14;
    let top = clientY - boxRect.top + 14;
    if (left + tw > box.clientWidth) left = clientX - boxRect.left - tw - 14;
    if (left < 2) left = 2;
    if (top + th > box.clientHeight) top = box.clientHeight - th - 4;
    if (top < 2) top = 2;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };

  scroll.addEventListener('mousemove', e => showAt(e.clientX, e.clientY));
  scroll.addEventListener('mouseleave', hideTip);
  // 터치: 톡 눌러 값 보기 (드래그 스크롤은 그대로)
  scroll.addEventListener('touchstart', e => { if (e.touches[0]) showAt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });

  draw();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { if (scroll.clientWidth !== cfg.lastW) draw(); });
    ro.observe(scroll);
  }
}
