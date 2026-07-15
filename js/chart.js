// 의존성 없는 간단 SVG 라인 차트
// series: [{ label, color, values: number[], dash?: bool }], labels: string[](날짜)

export function moneyShort(v) {
  if (v == null || isNaN(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(a >= 1e9 ? 0 : 1) + '억';
  if (a >= 1e4) return Math.round(v / 1e4).toLocaleString() + '만';
  return Math.round(v).toLocaleString();
}

export function lineChart({ series, labels, height = 300 }) {
  const W = 820, H = height, padL = 56, padR = 10, padT = 12, padB = 26;
  const all = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  if (!all.length) return '<div class="empty">표시할 데이터가 없습니다</div>';
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.05; max += span * 0.05;
  const n = labels.length;
  const x = i => padL + (n <= 1 ? 0 : (W - padL - padR) * i / (n - 1));
  const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));

  let g = '';
  // y축 눈금 4개
  for (let k = 0; k <= 4; k++) {
    const v = min + (max - min) * k / 4;
    const yy = y(v);
    g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="currentColor" stroke-opacity="0.09"/>`;
    g += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity="0.55">${moneyShort(v)}</text>`;
  }
  // x축 라벨 4개
  for (let k = 0; k <= 3; k++) {
    const i = Math.round((n - 1) * k / 3);
    if (i < 0 || i >= n) continue;
    g += `<text x="${x(i)}" y="${H - 8}" text-anchor="${k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}" font-size="11" fill="currentColor" fill-opacity="0.55">${labels[i]?.slice(0, 7) ?? ''}</text>`;
  }
  // 선
  for (const s of series) {
    let dcmd = '', pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (v == null || !isFinite(v)) { pen = false; continue; }
      dcmd += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      pen = true;
    }
    if (dcmd) g += `<path d="${dcmd}" fill="none" stroke="${s.color}" stroke-width="1.5" ${s.dash ? 'stroke-dasharray="5 4" stroke-width="1.2"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const legend = series.map(s =>
    `<span><span class="sw" style="background:${s.color}"></span>${s.label}</span>`).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div><div class="legend">${legend}</div>`;
}
