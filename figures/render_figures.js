/*
 * render_figures.js
 * -----------------------------------------------------------------------------
 * Publication figures for "Personal climate agency" (Rudersdal survey):
 * Figures 1-4 and Supplementary Figure 1.
 *
 * The renderer is dependency-free. It turns the JSON files written by
 * data_analysis.Rmd (figures/Figure_<key>_data.json) into standalone SVG files.
 * It contains no statistics: every number drawn comes from the R export.
 *
 *   R:        the figure-render chunk runs it with the V8 package
 *   Node:     node figures/render_figures.js figures   -> figures/Figure_<key>.svg
 *   Browser:  open figures/figures.html                 (preview + download)
 *
 * Geometry is in typographic points (1 SVG unit = 1 pt) at a fixed width of
 * 183 mm (Nature double-column), so font sizes and stroke widths in this file
 * are the printed sizes: 7 pt text, 6 pt tick labels, 8 pt bold panel letters.
 * -----------------------------------------------------------------------------
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FigureRenderer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===========================================================================
  // 1. Style
  // ===========================================================================
  const MM = 72 / 25.4;                       // points per millimetre
  const PAGE_WIDTH_MM = 183;
  const W = PAGE_WIDTH_MM * MM;               // 518.74 pt

  const FONT = {
    family: 'Arial, Helvetica, \'Liberation Sans\', sans-serif',
    text: 7,      // labels, axis titles, legends
    tick: 6,      // tick labels, in-bar values, secondary notes
    panel: 8      // bold panel letters
  };

  const STROKE = { axis: 0.5, grid: 0.4, ci: 0.9, zero: 0.6, connector: 1.2 };

  const COLOR = {
    ink: '#1F2529',
    muted: '#5E6A71',        // secondary text
    grid: '#E3E7EA',
    zero: '#8C9BA5',
    blue: '#1B4F72',         // already taken / overall estimates
    teal: '#5FA8A0',         // relevant, not yet taken (fills)
    tealDark: '#3B8C81',     // teal for points and text (better contrast)
    tealFill: '#D3E8E4',     // remaining-opportunity area
    slate: '#7D8D98',        // opportunity space
    notRelevant: '#E4E6E8',
    roleDot: '#B9C1C7',      // role-specific estimates (Fig. 3)
    connector: '#CFD8DC',    // expected-experienced connector (Fig. 4)
    opportunity: '#5B7F9C',  // Supplementary Fig. 1a
    motivation: '#C97B1A',   // Supplementary Fig. 1b
    boxFill: '#F1F3F4'
  };

  const ROLES = [
    'Consumer (technology)', 'Consumer (curtailment)',
    'Organisational participant', 'Investor', 'Citizen', 'Social role model'
  ];
  const ROLE_LINES = {
    'Consumer (technology)': ['Consumer', '(technology)'],
    'Consumer (curtailment)': ['Consumer', '(curtailment)'],
    'Organisational participant': ['Organisational', 'participant'],
    'Investor': ['Investor'],
    'Citizen': ['Citizen'],
    'Social role model': ['Social', 'role model']
  };
  const ROLE_SHORT = {
    'Consumer (technology)': 'Technology adoption',
    'Consumer (curtailment)': 'Curtailment',
    'Organisational participant': 'Organisational',
    'Investor': 'Investor',
    'Citizen': 'Citizen',
    'Social role model': 'Social role model'
  };

  // ===========================================================================
  // 2. Text measurement
  // Advance widths of Helvetica/Arial (identical metrics), per 1000 em, for
  // printable ASCII 32-126. Used only for layout (column widths, label fitting).
  // ===========================================================================
  const AFM = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
  ];
  function textWidth(s, size, bold) {
    let w = 0;
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      w += (c >= 32 && c <= 126) ? AFM[c - 32] : 556;
    }
    return w / 1000 * size * (bold ? 1.1 : 1);
  }
  const maxWidth = (strings, size, bold) =>
    Math.max(0, ...strings.map(s => textWidth(s, size, bold)));

  // ===========================================================================
  // 3. Number formatting (true minus sign, as required in print)
  // ===========================================================================
  const MINUS = '\u2212';
  function fmt(v, digits = 0, signed = false) {
    const s = Math.abs(v).toFixed(digits);
    if (Number(s) === 0) return (signed ? '' : '') + s;
    return (v < 0 ? MINUS : (signed ? '+' : '')) + s;
  }
  function decimalsOf(step) {
    return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  }
  // Tick labels drop trailing zeros: 0, 0.5, 1 rather than 0.0, 0.5, 1.0.
  function fmtTick(v, digits) {
    const s = fmt(v, digits);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }

  // Percentage labels for stacked bars use conventional rounding of each
  // segment, so they match the percentages quoted in the text. Labels on a
  // bar may therefore sum to 99 or 101.
  const percentLabels = shares => shares.map(s => Math.round(s * 100));

  // ===========================================================================
  // 4. Scales
  // ===========================================================================
  function linear(d0, d1, r0, r1) {
    const f = v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
    f.domain = [d0, d1];
    return f;
  }
  // "Nice" ticks covering [lo, hi]. The domain is padded around the data and
  // extended to the next tick only when that tick is close (or snap = true),
  // so axes stay tight but rarely end just short of a round number.
  function niceAxis(values, { includeZero = true, target = 5, pad = 0.04, snap = false, snapWithin = 0.3 } = {}) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const span = hi - lo || 1;
    lo -= span * pad; hi += span * pad;
    const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const below = Math.floor(lo / step + 1e-9) * step, above = Math.ceil(hi / step - 1e-9) * step;
    if (snap || lo - below < snapWithin * step) lo = below;
    if (snap || above - hi < snapWithin * step) hi = above;
    const ticks = [];
    for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) {
      ticks.push(Math.round(t / step) * step);
    }
    return { lo, hi, ticks, digits: decimalsOf(step) };
  }

  // ===========================================================================
  // 5. Minimal SVG builder (string output: works in Node and in the browser)
  // ===========================================================================
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => (Math.round(v * 100) / 100).toString();

  class Canvas {
    constructor(title) { this.parts = []; this.title = title; }
    add(tag, attrs, content) {
      const a = Object.entries(attrs)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}="${typeof v === 'number' ? num(v) : esc(v)}"`).join(' ');
      this.parts.push(content === undefined ? `<${tag} ${a}/>` : `<${tag} ${a}>${content}</${tag}>`);
    }
    // Text is vertically centred on y via a fixed baseline shift (0.35 em),
    // which renders identically in browsers, librsvg and Illustrator.
    text(x, y, s, { size = FONT.text, anchor = 'start', bold = false, fill = COLOR.ink, rotate } = {}) {
      this.add('text', {
        x, y: y + 0.35 * size, 'font-size': size, 'text-anchor': anchor,
        'font-weight': bold ? 'bold' : undefined, fill,
        transform: rotate ? `rotate(${rotate} ${num(x)} ${num(y)})` : undefined
      }, esc(s));
    }
    line(x1, y1, x2, y2, stroke = COLOR.ink, width = STROKE.axis, dash) {
      this.add('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-dasharray': dash });
    }
    rect(x, y, w, h, fill, rx) {
      this.add('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h), fill, rx });
    }
    circle(cx, cy, r, fill, stroke) {
      this.add('circle', { cx, cy, r, fill, stroke: stroke ? '#FFFFFF' : undefined, 'stroke-width': stroke ? 0.4 : undefined });
    }
    path(d, attrs) { this.add('path', { d, ...attrs }); }
    toString(height) {
      const h = Math.ceil(height);
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${PAGE_WIDTH_MM}mm" height="${num(h / MM)}mm" viewBox="0 0 ${num(W)} ${h}">`,
        `<title>${esc(this.title)}</title>`,
        `<rect x="0" y="0" width="${num(W)}" height="${h}" fill="#FFFFFF"/>`,
        `<g font-family="${FONT.family}" fill="${COLOR.ink}">`,
        ...this.parts,
        '</g>',
        '</svg>', ''
      ].join('\n');
    }
  }

  // ===========================================================================
  // 6. Shared components
  // ===========================================================================
  function panelLabel(c, x, y, letter, title, subtitle) {
    c.text(x, y, letter, { size: FONT.panel, bold: true });
    if (title) c.text(x + 9, y, title);
    if (subtitle) c.text(x + 9, y + 9, subtitle, { size: FONT.tick, fill: COLOR.muted });
  }

  function xAxis(c, x, axis, y, title, { ticks = axis.ticks, digits = axis.digits, x0, x1 } = {}) {
    c.line(x0 ?? x(axis.lo), y, x1 ?? x(axis.hi), y);
    ticks.forEach(t => {
      c.line(x(t), y, x(t), y + 2.5);
      c.text(x(t), y + 8, fmtTick(t, digits), { size: FONT.tick, anchor: 'middle' });
    });
    if (title) c.text((x(axis.lo) + x(axis.hi)) / 2, y + 19, title, { anchor: 'middle' });
  }

  function verticalGrid(c, x, ticks, y0, y1, zero = true) {
    ticks.forEach(t => {
      if (zero && Math.abs(t) < 1e-12) return;
      c.line(x(t), y0, x(t), y1, COLOR.grid, STROKE.grid);
    });
    if (zero) c.line(x(0), y0, x(0), y1, COLOR.zero, STROKE.zero, '2 2');
  }

  function errorBar(c, x, lo, hi, y, color, width = STROKE.ci) {
    c.line(x(lo), y, x(hi), y, color, width);
  }

  // Assign y positions to action rows, adding a gap whenever the role changes.
  function layoutRows(items, top, pitch, gap) {
    let y = top, prev = null;
    return items.map(d => {
      if (prev !== null && d.role !== prev) y += gap;
      prev = d.role;
      const row = { ...d, y };
      y += pitch;
      return row;
    });
  }

  // Bold role labels, vertically centred on their block of rows.
  function roleLabels(c, rows, x) {
    for (const role of ROLES) {
      const r = rows.filter(d => d.role === role);
      if (!r.length) continue;
      const lines = ROLE_LINES[role];
      const mid = (r[0].y + r[r.length - 1].y) / 2;
      lines.forEach((s, i) => c.text(x, mid + (i - (lines.length - 1) / 2) * 8.4, s, { bold: true }));
    }
  }
  const roleColumnWidth = () => maxWidth(Object.values(ROLE_LINES).flat(), FONT.text, true);

  function legendItem(c, x, y, label, color, kind = 'square', r = 2.2, lineWidth = STROKE.ci) {
    if (kind === 'square') c.rect(x, y - 3, 6, 6, color);
    else if (kind === 'dot') c.circle(x + 3, y, r, color);
    else if (kind === 'dotci') { c.line(x - 1, y, x + 7, y, color, lineWidth); c.circle(x + 3, y, r, color); }
    c.text(x + 9, y, label);
    return x + 9 + textWidth(label, FONT.text) + 12;
  }

  function requireFields(rows, fields, where) {
    rows.forEach((r, i) => fields.forEach(f => {
      if (r[f] === undefined || r[f] === null || Number.isNaN(r[f])) {
        throw new Error(`${where}: row ${i + 1} is missing "${f}"`);
      }
    }));
  }

  // ===========================================================================
  // 7. Figure 1 - Opportunity space for personal climate action
  // ===========================================================================
  function figure1(D) {
    requireFields(D.items, ['behaviour_id', 'action', 'role', 'taken', 'untaken', 'not_relevant'], 'Figure 1');
    const c = new Canvas('Figure 1. Opportunity space for personal climate action');

    // ---- a: distributions --------------------------------------------------
    panelLabel(c, 0, 6, 'a');
    const hists = [
      ['opportunity', 'Opportunity space', COLOR.slate],
      ['taken', 'Already taken', COLOR.blue],
      ['remaining', 'Remaining opportunity', COLOR.teal]
    ];
    const ymaxPct = Math.max(...hists.flatMap(([k]) => D.hist[k])) * 100;
    const yAxis = niceAxis([0, ymaxPct], { pad: 0, target: 3, snap: true });
    const aLeft = 30, aRight = W - 6, gapA = 18;
    const pw = (aRight - aLeft - 2 * gapA) / 3;
    const aTop = 22, aBot = 112;
    const y = linear(0, yAxis.hi, aBot, aTop);

    hists.forEach(([key, name, color], i) => {
      const x0 = aLeft + i * (pw + gapA), x1 = x0 + pw;
      legendItem(c, x0, 12, name, color);
      yAxis.ticks.forEach(t => {
        c.line(x0, y(t), x1, y(t), COLOR.grid, STROKE.grid);
        if (i === 0) c.text(x0 - 4, y(t), fmt(t), { size: FONT.tick, anchor: 'end' });
      });
      const step = pw / 19;
      D.hist[key].forEach((p, j) => {
        const h = aBot - y(p * 100);
        c.rect(x0 + j * step + step * 0.12, aBot - h, step * 0.76, h, color);
      });
      const xc = j => x0 + (j + 0.5) * step;
      c.line(x0, aBot, x1, aBot);
      [0, 6, 12, 18].forEach(t => {
        c.line(xc(t), aBot, xc(t), aBot + 2.5);
        c.text(xc(t), aBot + 8, t, { size: FONT.tick, anchor: 'middle' });
      });
    });
    c.text(8, (aTop + aBot) / 2, 'Respondents (%)', { anchor: 'middle', rotate: -90 });
    c.text((aLeft + aRight) / 2, aBot + 19, 'Number of actions', { anchor: 'middle' });

    // ---- b: status of each action ------------------------------------------
    const bTop = aBot + 38;
    panelLabel(c, 0, bTop, 'b');
    const roleW = roleColumnWidth();
    const labelRight = roleW + 10 + maxWidth(D.items.map(d => d.action), FONT.text) ;
    const left = labelRight + 6, right = W - 6;
    const status = [
      ['taken', 'Already taken', COLOR.blue, '#FFFFFF'],
      ['untaken', 'Relevant, not yet taken', COLOR.teal, COLOR.ink],
      ['not_relevant', 'Not relevant', COLOR.notRelevant, COLOR.muted]
    ];
    let lx = left;
    status.forEach(([, name, color]) => { lx = legendItem(c, lx, bTop, name, color); });

    const rows = layoutRows(D.items, bTop + 15, 11, 6);
    roleLabels(c, rows, 0);
    const x = linear(0, 100, left, right);
    rows.forEach(d => {
      c.text(labelRight, d.y, d.action, { anchor: 'end' });
      const labels = percentLabels(status.map(([key]) => d[key]));
      let cum = 0;
      status.forEach(([key, , color, ink], j) => {
        const pct = 100 * d[key];
        const x0 = x(cum), w = x(cum + pct) - x0;
        c.rect(x0, d.y - 3.9, w, 7.8, color);
        if (w >= textWidth(labels[j], FONT.tick) + 2) {
          c.text(x0 + w / 2, d.y, labels[j], { size: FONT.tick, anchor: 'middle', fill: ink });
        }
        cum += pct;
      });
    });
    const axisY = rows[rows.length - 1].y + 8;
    xAxis(c, x, { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100], digits: 0 }, axisY, 'Respondents (%)');
    return c.toString(axisY + 25);
  }

  // ===========================================================================
  // 8. Figure 2 - Socioeconomic differences in the opportunity space
  // ===========================================================================
  function figure2(D) {
    const A = D.panel_a;
    requireFields(A, ['label_dkk', 'label_eur', 'opportunity_mean', 'opportunity_low', 'opportunity_high',
      'taken_mean', 'taken_low', 'taken_high'], 'Figure 2a');
    requireFields(D.panels_bcd, ['term', 'role', 'estimate', 'low', 'high'], 'Figure 2b-d');
    const c = new Canvas('Figure 2. Socioeconomic differences in the opportunity space');

    // ---- a: opportunity space and actions taken by income ------------------
    panelLabel(c, 0, 6, 'a', 'Opportunity space and actions taken, by personal annual income');
    const left = 30, right = W - 18, top = 24, bot = 128;
    const xi = i => left + i * (right - left) / (A.length - 1);
    const y = linear(0, 18, bot, top);
    [0, 6, 12, 18].forEach(t => {
      c.line(left - 6, y(t), right + 6, y(t), t === 0 ? COLOR.ink : COLOR.grid, t === 0 ? STROKE.axis : STROKE.grid);
      c.text(left - 10, y(t), t, { size: FONT.tick, anchor: 'end' });
    });
    const pts = key => A.map((d, i) => `${num(xi(i))},${num(y(d[key]))}`);
    // Remaining opportunity = area between the two lines.
    c.path(`M${pts('opportunity_mean').join('L')}L${pts('taken_mean').reverse().join('L')}Z`, { fill: COLOR.tealFill });
    [['opportunity', COLOR.slate], ['taken', COLOR.blue]].forEach(([k, col]) => {
      c.path(`M${pts(k + '_mean').join('L')}`, { fill: 'none', stroke: col, 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
      A.forEach((d, i) => {
        c.line(xi(i), y(d[k + '_low']), xi(i), y(d[k + '_high']), col, STROKE.ci);
        c.circle(xi(i), y(d[k + '_mean']), 2.1, col);
      });
    });
    // Direct labels instead of a legend.
    // Labels sit just above / below the first two points of their line.
    const oHigh = Math.max(A[0].opportunity_high, A[1].opportunity_high);
    const tLow = Math.min(A[0].taken_low, A[1].taken_low);
    c.text(xi(0) + 6, Math.max(top + 2, y(oHigh) - 5), 'Opportunity space', { fill: COLOR.slate });
    c.text(xi(0) + 6, Math.min(bot - 5, y(tLow) + 5), 'Already taken', { fill: COLOR.blue });
    const midI = Math.floor((A.length - 1) / 2);
    c.text((xi(midI) + xi(midI + 1)) / 2, y((A[midI].opportunity_mean + A[midI].taken_mean) / 2),
      'Remaining opportunity', { anchor: 'middle', fill: COLOR.tealDark });
    A.forEach((d, i) => {
      c.line(xi(i), bot, xi(i), bot + 2.5);
      c.text(xi(i), bot + 8, d.label_dkk, { size: FONT.tick, anchor: 'middle' });
      c.text(xi(i), bot + 16, d.label_eur, { size: FONT.tick, anchor: 'middle', fill: COLOR.muted });
    });
    c.text(8, (top + bot) / 2, 'Actions', { anchor: 'middle', rotate: -90 });
    c.text((left + right) / 2, bot + 28, 'Personal annual income', { anchor: 'middle' });

    // ---- b-d: adjusted associations ----------------------------------------
    const specs = [
      ['income_filled_z', 'b', 'Income (per SD)'],
      ['is_employed', 'c', 'Employed vs not employed'],
      ['age_z', 'd', 'Age (per SD)']
    ];
    const labelRight = maxWidth(ROLES.map(r => ROLE_SHORT[r]), FONT.text);
    const gap = 16, x0all = labelRight + 10, pw = (W - 4 - x0all - 2 * gap) / 3;
    const tTop = bot + 52, boxTop = tTop + 9, rowTop = boxTop + 34, pitch = 13;
    const rowsBot = rowTop + pitch * (ROLES.length - 1);
    ROLES.forEach((r, j) => c.text(labelRight, rowTop + j * pitch, ROLE_SHORT[r], { anchor: 'end' }));

    specs.forEach(([term, letter, title], i) => {
      const x0 = x0all + i * (pw + gap), x1 = x0 + pw;
      const rows = D.panels_bcd.filter(d => d.term === term);
      const overall = rows.find(d => d.role === 'Overall');
      if (!overall) throw new Error(`Figure 2: no overall estimate for ${term}`);
      panelLabel(c, x0, tTop, letter, title);
      c.rect(x0, boxTop, pw, 22, COLOR.boxFill, 1.5);
      c.text(x0 + 4, boxTop + 7, `Overall: ${fmt(overall.actions, 2, true)} actions`, { bold: true });
      c.text(x0 + 4, boxTop + 15.5, `95% CI ${fmt(overall.actions_low, 2, true)} to ${fmt(overall.actions_high, 2, true)}`,
        { size: FONT.tick, fill: COLOR.muted });

      const roleRows = ROLES.map(r => rows.find(d => d.role === r));
      const axis = niceAxis(roleRows.flatMap(d => [d.low, d.high]), { target: 4 });
      const x = linear(axis.lo, axis.hi, x0, x1);
      verticalGrid(c, x, axis.ticks, rowTop - 7, rowsBot + 7);
      roleRows.forEach((d, j) => {
        const yy = rowTop + j * pitch;
        errorBar(c, x, d.low, d.high, yy, COLOR.blue);
        c.circle(x(d.estimate), yy, 2.3, COLOR.blue);
      });
      xAxis(c, x, axis, rowsBot + 9, 'Percentage-point difference');
    });
    return c.toString(rowsBot + 34);
  }

  // ===========================================================================
  // 9. Figure 3 - Factors associated with utilisation, opportunity, motivation
  // ===========================================================================
  function figure3(D) {
    requireFields(D.estimates, ['construct', 'predictor', 'level', 'estimate', 'low', 'high'], 'Figure 3');
    const c = new Canvas('Figure 3. Factors associated with utilisation, perceived opportunity and motivation');
    const panels = [
      { construct: 'Utilisation', letter: 'a', sub: 'among relevant actions', unit: 'Percentage-point difference' },
      { construct: 'Perceived opportunity', letter: 'b', sub: 'among relevant, untaken actions', unit: 'Points (1-5 scale)' },
      { construct: 'Motivation', letter: 'c', sub: 'among relevant, untaken actions', unit: 'Points (1-7 scale)' }
    ];
    const preds = D.predictors;
    const labelRight = Math.max(maxWidth(preds.map(p => p.predictor), FONT.text),
      maxWidth(['Each of the six roles'], FONT.text) + 9);
    const gap = 14, x0all = labelRight + 10, pw = (W - 4 - x0all - 2 * gap) / 3;
    // Mark sizes for this figure: thin CI lines, a clear overall point and
    // small role points.
    const MARK = { ci: 0.8, overallR: 2.2, roleR: 1.35, roleColor: '#A9B4BB', pitch: 13 };

    // legend (top left) and panel headings
    legendItem(c, 0, 4, 'Overall (95% CI)', COLOR.blue, 'dotci', MARK.overallR, MARK.ci);
    legendItem(c, 0, 13, 'Each of the six roles', MARK.roleColor, 'dot', MARK.roleR);

    // rows with group headings
    const rows = [];
    let yy = 38, prevGroup = null;
    preds.forEach(p => {
      if (p.group !== prevGroup) {
        if (prevGroup !== null) yy += 5;
        c.text(labelRight, yy, p.group, { anchor: 'end', bold: true });
        yy += 11; prevGroup = p.group;
      }
      rows.push({ ...p, y: yy });
      c.text(labelRight, yy, p.predictor, { anchor: 'end' });
      yy += MARK.pitch;
    });
    const top = 32, bottom = yy - 6;

    panels.forEach((p, i) => {
      const x0 = x0all + i * (pw + gap), x1 = x0 + pw;
      panelLabel(c, x0, 4, p.letter, p.construct, p.sub);
      const est = D.estimates.filter(d => d.construct === p.construct);
      if (!est.length) throw new Error(`Figure 3: no estimates for ${p.construct}`);
      const vals = est.flatMap(d => d.level === 'Overall' ? [d.low, d.high] : [d.estimate]);
      // Pad the axis so the outermost dot or CI end sits well inside it, and do
      // not extend it to the next tick (that would put tick labels at the panel
      // edges, where they collide with the neighbouring panel).
      const axis = niceAxis(vals, { target: 4, pad: 0.08, snapWithin: 0 });
      const x = linear(axis.lo, axis.hi, x0, x1);
      verticalGrid(c, x, axis.ticks, top, bottom);
      // All estimates for a predictor share one line: role dots first, then the
      // overall CI and point on top.
      rows.forEach(r => {
        const sub = est.filter(d => d.predictor === r.predictor);
        sub.filter(d => d.level !== 'Overall').forEach(d => c.circle(x(d.estimate), r.y, MARK.roleR, MARK.roleColor));
        const o = sub.find(d => d.level === 'Overall');
        if (o) { errorBar(c, x, o.low, o.high, r.y, COLOR.blue, MARK.ci); c.circle(x(o.estimate), r.y, MARK.overallR, COLOR.blue); }
      });
      xAxis(c, x, axis, bottom + 2, p.unit);
    });
    return c.toString(bottom + 27);
  }

  // ===========================================================================
  // 10. Figure 4 - Expected and experienced quality-of-life impacts
  // ===========================================================================
  function figure4(D) {
    const fields = ['n', 'mean', 'low', 'high'];
    requireFields(D.items, ['action', 'role', ...['expected', 'experienced'].flatMap(s => fields.map(f => `${s}_${f}`))], 'Figure 4');
    const c = new Canvas('Figure 4. Expected and experienced quality-of-life impacts');
    const roleW = roleColumnWidth();
    const labelRight = roleW + 10 + maxWidth(D.items.map(d => d.action), FONT.text);
    const x0 = labelRight + 10, x1 = W - 6;
    const lo = D.scale.min, hi = D.scale.max;
    const x = linear(lo, hi, x0, x1);

    let lx = x0 + 10;
    lx = legendItem(c, lx, 4, 'Not yet taken (expected)', COLOR.tealDark, 'dotci');
    legendItem(c, lx + 6, 4, 'Already taken (experienced)', COLOR.blue, 'dotci');

    const rows = layoutRows(D.items, 22, 11.5, 6);
    roleLabels(c, rows, 0);
    const ticks = []; for (let t = lo; t <= hi; t++) ticks.push(t);
    const bottom = rows[rows.length - 1].y + 7;
    verticalGrid(c, x, ticks, 14, bottom);
    rows.forEach(d => {
      c.text(labelRight, d.y, d.action, { anchor: 'end' });
      c.line(x(d.expected_mean), d.y, x(d.experienced_mean), d.y, COLOR.connector, STROKE.connector);
      errorBar(c, x, d.expected_low, d.expected_high, d.y, COLOR.tealDark);
      errorBar(c, x, d.experienced_low, d.experienced_high, d.y, COLOR.blue);
      c.circle(x(d.expected_mean), d.y, 2.3, COLOR.tealDark, true);
      c.circle(x(d.experienced_mean), d.y, 2.3, COLOR.blue, true);
    });
    xAxis(c, x, { lo, hi, ticks, digits: 0 }, bottom + 2);
    c.text(x0, bottom + 18, 'Very negatively', { size: FONT.tick, fill: COLOR.muted });
    c.text(x1, bottom + 18, 'Very positively', { size: FONT.tick, anchor: 'end', fill: COLOR.muted });
    c.text((x0 + x1) / 2, bottom + 27, 'Quality-of-life impact', { anchor: 'middle' });
    return c.toString(bottom + 34);
  }

  // ===========================================================================
  // 11. Supplementary Figure 1 - Perceived opportunity and motivation
  // ===========================================================================
  function figureS1(D) {
    const keys = ['opportunity', 'motivation'];
    requireFields(D.items, ['action', 'role', ...keys.flatMap(k => ['n', 'mean', 'low', 'high'].map(f => `${k}_${f}`))], 'Supplementary Figure 1');
    // One n column is shown; it is only unambiguous if both ratings share it.
    D.items.forEach(d => {
      if (d.opportunity_n !== d.motivation_n) {
        throw new Error(`Supplementary Figure 1: n differs between ratings for "${d.action}"`);
      }
    });
    const c = new Canvas('Supplementary Figure 1. Perceived opportunity and motivation across actions');
    const roleW = roleColumnWidth();
    const labelRight = roleW + 10 + maxWidth(D.items.map(d => d.action), FONT.text);
    const nRight = labelRight + 6 + maxWidth(D.items.map(d => String(d.opportunity_n)), FONT.tick);
    const gap = 22, x0all = nRight + 14, pw = (W - 6 - x0all - gap) / 2;
    const panels = [
      { key: 'opportunity', letter: 'a', title: 'Perceived opportunity', lo: 1, hi: 5, color: COLOR.opportunity },
      { key: 'motivation', letter: 'b', title: 'Motivation', lo: 1, hi: 7, color: COLOR.motivation }
    ];
    const rows = layoutRows(D.items, 26, 11.5, 6);
    roleLabels(c, rows, 0);
    const bottom = rows[rows.length - 1].y + 7;
    c.text(nRight, 16, 'n', { size: FONT.tick, anchor: 'end', fill: COLOR.muted });
    rows.forEach(d => {
      c.text(labelRight, d.y, d.action, { anchor: 'end' });
      c.text(nRight, d.y, d.opportunity_n, { size: FONT.tick, anchor: 'end', fill: COLOR.muted });
    });
    panels.forEach((p, i) => {
      const x0 = x0all + i * (pw + gap), x1 = x0 + pw;
      panelLabel(c, x0, 4, p.letter, p.title);
      const x = linear(p.lo, p.hi, x0, x1);
      const ticks = []; for (let t = p.lo; t <= p.hi; t++) ticks.push(t);
      ticks.forEach(t => c.line(x(t), 14, x(t), bottom, COLOR.grid, STROKE.grid));
      c.line(x(D.overall[p.key]), 14, x(D.overall[p.key]), bottom, COLOR.zero, STROKE.zero, '2 2');
      rows.forEach(d => {
        errorBar(c, x, d[p.key + '_low'], d[p.key + '_high'], d.y, p.color);
        c.circle(x(d[p.key + '_mean']), d.y, 2.3, p.color, true);
      });
      xAxis(c, x, { lo: p.lo, hi: p.hi, ticks, digits: 0 }, bottom + 2, `Rating (${p.lo}-${p.hi})`);
    });
    return c.toString(bottom + 27);
  }

  // ===========================================================================
  // 12. Public API and command-line entry point
  // ===========================================================================
  const FIGURES = { '1': figure1, '2': figure2, '3': figure3, '4': figure4, 'S1': figureS1 };

  function render(key, data) {
    const f = FIGURES[key];
    if (!f) throw new Error(`Unknown figure "${key}"`);
    if (!data) throw new Error(`No data supplied for Figure ${key}`);
    return f(data);
  }

  const api = { render, keys: Object.keys(FIGURES), textWidth, PAGE_WIDTH_MM };

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const fs = require('fs'), path = require('path');
    const dir = path.resolve(process.argv[2] || 'figures');
    let failed = false;
    for (const key of api.keys) {
      const src = path.join(dir, `Figure_${key}_data.json`);
      try {
        const svg = render(key, JSON.parse(fs.readFileSync(src, 'utf8')));
        fs.writeFileSync(path.join(dir, `Figure_${key}.svg`), svg);
        console.log(`Figure ${key}: wrote ${path.join(dir, `Figure_${key}.svg`)}`);
      } catch (e) {
        failed = true;
        console.error(`Figure ${key}: ${e.message}`);
      }
    }
    if (failed) process.exit(1);
  }
  return api;
});

