/* ============================================================
 * archviz.js — 模型/流水线结构图渲染器
 * vertical:  自上而下块图 + 跳连弧线（SVG）
 * horizontal: 横向流程链（HTML，可点击跳转）
 * ============================================================ */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  const TONES = {
    io:    { fill: "#5b7a8c" },   // 输入/输出
    conv:  { fill: "#3e7c6f" },   // 卷积
    attn:  { fill: "#a8814f" },   // 注意力/Transformer
    stage: { fill: "#7a766c" },   // 阶段/模块组
    data:  { fill: "#8c6a5b" },   // 数据/噪声
    loss:  { fill: "#b3564d" }    // 损失
  };

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- 纵向结构图 ----------
     spec = { blocks: [{label, sub, tone}], skips: [[from, to, label]] }
     from/to 为 blocks 下标，弧线从 from 底部绕右侧连到 to 顶部 */
  function vertical(container, spec, opts) {
    opts = opts || {};
    const BW = opts.blockWidth || 330, LW = opts.labelWidth || 400;
    const GAP = 26, PAD_T = 16, PAD_B = 16;
    const SKIP_W = (spec.skips && spec.skips.length) ? 150 : 0;
    const W = LW + SKIP_W;
    const heights = spec.blocks.map(b => b.sub ? (b.label.length > 18 ? 66 : 56) : 38);
    const ys = [];
    let y = PAD_T;
    for (const hgt of heights) { ys.push(y); y += hgt + GAP; }
    const H = y - GAP + PAD_B;
    const bx = (W - SKIP_W - BW) / 2;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "arch-svg" });
    svg.style.maxWidth = (W) + "px";

    // defs: 箭头
    const defs = el("defs", {});
    const marker = el("marker", { id: "av-arrow-" + Math.random().toString(36).slice(2, 8), markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: "auto" });
    marker.appendChild(el("path", { d: "M0,0 L6,3 L0,6 Z", fill: "#9a958a" }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    spec.blocks.forEach((b, i) => {
      const tone = TONES[b.tone] || TONES.stage;
      const g = el("g", {});
      const rect = el("rect", {
        x: bx, y: ys[i], width: BW, height: heights[i], rx: 9,
        fill: tone.fill, opacity: b.dim ? 0.55 : 0.94
      });
      g.appendChild(rect);
      const isWide = b.label.length > 18;
      if (b.sub) {
        g.appendChild(el("text", { x: bx + BW / 2, y: ys[i] + (isWide ? 24 : 23), "text-anchor": "middle", class: "blk-label" }, b.label));
        // sub 可能较长，允许两行
        const subLines = b.sub.split("\n");
        subLines.slice(0, 2).forEach((sl, k) => {
          g.appendChild(el("text", {
            x: bx + BW / 2, y: ys[i] + (isWide ? 41 : 40) + k * 12,
            "text-anchor": "middle", class: "blk-sub"
          }, sl));
        });
      } else {
        g.appendChild(el("text", { x: bx + BW / 2, y: ys[i] + heights[i] / 2 + 4.5, "text-anchor": "middle", class: "blk-label" }, b.label));
      }
      svg.appendChild(g);
      // 下行箭头
      if (i < spec.blocks.length - 1) {
        svg.appendChild(el("line", {
          x1: bx + BW / 2, y1: ys[i] + heights[i] + 2, x2: bx + BW / 2, y2: ys[i + 1] - 5,
          stroke: "#9a958a", "stroke-width": 1.4, "marker-end": `url(#${marker.id})`
        }));
      }
    });

    // 跳连弧线
    (spec.skips || []).forEach(([from, to, label]) => {
      const y1 = ys[from] + heights[from];
      const y2 = ys[to];
      const x0 = bx + BW;
      const cx = W - 30;
      const path = el("path", {
        d: `M ${x0} ${y1} C ${cx} ${y1 + 20}, ${cx} ${y2 - 20}, ${x0} ${y2}`,
        fill: "none", stroke: "#b3a17c", "stroke-width": 1.6, "stroke-dasharray": "5 4",
        opacity: 0.9
      });
      svg.appendChild(path);
      // 端点小圆
      svg.appendChild(el("circle", { cx: x0, cy: y1, r: 3, fill: "#b3a17c" }));
      svg.appendChild(el("circle", { cx: x0, cy: y2, r: 3, fill: "#b3a17c" }));
      if (label) {
        const t = el("text", { x: cx - 4, y: (y1 + y2) / 2, "text-anchor": "end", class: "skip-label" }, label);
        svg.appendChild(t);
      }
    });

    container.innerHTML = "";
    container.appendChild(svg);
  }

  /* ---------- 横向流程链（HTML） ----------
     spec = { blocks: [{label, sub, tone, onClick}] } */
  function horizontal(container, spec) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "flow-chain";
    spec.blocks.forEach((b, i) => {
      const node = document.createElement("div");
      node.className = "flow-node";
      const tone = TONES[b.tone] || TONES.stage;
      node.style.borderTop = `3px solid ${tone.fill}`;
      node.innerHTML = `<b>${b.label}</b><span>${b.sub || ""}</span>`;
      if (b.onClick) node.addEventListener("click", b.onClick);
      wrap.appendChild(node);
      if (i < spec.blocks.length - 1) {
        const ar = document.createElement("div");
        ar.className = "flow-arrow";
        ar.textContent = "→";
        wrap.appendChild(ar);
      }
    });
    container.appendChild(wrap);
  }

  window.ArchViz = { vertical, horizontal, TONES };
})();
