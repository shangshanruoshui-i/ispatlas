/* ============================================================
 * graphics.js — 渲染管线 · 几何变换交互页
 * 约定：右手系 · 列向量 v'=Mv · 相机朝 -Z · NDC 深度 [-1,1]
 *
 * 四视图同步演示完整几何阶段：
 *   世界空间(第三方视角) → 相机空间(View) → NDC 裁剪空间 → 屏幕像素(Viewport)
 * 附：顶点全链路追踪、M/V/P/P·V 实时矩阵、深度非线性曲线、简答 QA
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 场景几何 ---------- */
  const S = 0.85; // 立方体半边长
  const CUBE_VERTS = [
    [-S, -S, -S], [S, -S, -S], [S, S, -S], [-S, S, -S],
    [-S, -S, S], [S, -S, S], [S, S, S], [-S, S, S]
  ];
  const CUBE_FACES = [
    [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]
  ];
  const CUBE_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const GRID_Y = -0.7, GRID_EXT = 2, GRID_STEP = 0.5;
  const AX_LEN = 1.9;
  const AX_COLORS = { x: "#b3564d", y: "#7a9e3b", z: "#5b7a8c" };
  const LIGHT = M4.normalize([-0.45, 0.85, 0.5]);

  /* ---------- 状态 ---------- */
  const state = {
    theta: -38, phi: 24, radius: 6.2,       // 轨道相机
    fov: 45, near: 0.4, far: 9,             // 透视参数
    ortho: false, orthoSize: 2.6,
    rx: 14, ry: 28, scale: 1,               // 模型变换
    spin: false, showFrustum: true,
    traceIdx: 6
  };

  const fmt = x => { if (!isFinite(x)) return "—"; const v = Math.abs(x) < 5e-4 ? 0 : x; return v.toFixed(2); };
  const fmtArr = (a, n) => a.slice(0, n || a.length).map(fmt).join(", ");

  /* ---------- 画布 ---------- */
  let CW = {}, // canvases
      built = false;

  function setupCanvas(id, w, h) {
    const c = document.getElementById(id);
    c.width = w * 2; c.height = h * 2;
    const ctx = c.getContext("2d");
    ctx.scale(2, 2);
    return { c, ctx, w, h };
  }

  /* ---------- 矩阵与投影 ---------- */
  function eyePos() {
    const t = state.theta * Math.PI / 180, p = state.phi * Math.PI / 180;
    const target = [0, 0.15, 0];
    return [
      target[0] + state.radius * Math.cos(p) * Math.sin(t),
      target[1] + state.radius * Math.sin(p),
      target[2] + state.radius * Math.cos(p) * Math.cos(t)
    ];
  }

  function computeMats(asp) {
    const M = M4.mulAll(M4.rotY(state.ry), M4.rotX(state.rx), M4.scaleM(state.scale));
    const eye = eyePos(), target = [0, 0.15, 0];
    const V = M4.lookAt(eye, target, [0, 1, 0]);
    const P = state.ortho
      ? M4.ortho(-state.orthoSize * asp, state.orthoSize * asp, -state.orthoSize, state.orthoSize, state.near, state.far)
      : M4.perspective(state.fov, asp, state.near, state.far);
    return { M, V, P, eye, target, PV: M4.mul(P, V) };
  }

  /* 齐次坐标投影到画布（含透视除法与 y 翻转）；w≤0 视为不可投影 */
  function projectTo(m, p, w, h) {
    const c = M4.transformVec4(m, [p[0], p[1], p[2], 1]);
    if (c[3] <= 1e-6) return { ok: false, w: c[3], clip: c };
    const ndc = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
    const X = Math.max(-1e4, Math.min(1e4, (ndc[0] + 1) * 0.5 * w));
    const Y = Math.max(-1e4, Math.min(1e4, (1 - ndc[1]) * 0.5 * h));
    return { ok: true, x: X, y: Y, ndc, w: c[3], clip: c, outside: Math.abs(ndc[0]) > 1 || Math.abs(ndc[1]) > 1 || Math.abs(ndc[2]) > 1 };
  }

  /* 裁剪空间 → NDC（不做视口） */
  function toNDC(clip) {
    if (clip[3] <= 1e-6) return null;
    return [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
  }

  /* 在 NDC 单元体内做多边形裁剪（Sutherland–Hodgman，6 个半空间） */
  function clipPolyNDC(poly) {
    const planes = [
      p => 1 - p[0], p => p[0] + 1,
      p => 1 - p[1], p => p[1] + 1,
      p => 1 - p[2], p => p[2] + 1
    ];
    let out = poly;
    for (const dist of planes) {
      const inp = out; out = [];
      if (!inp.length) break;
      for (let i = 0; i < inp.length; i++) {
        const a = inp[i], b = inp[(i + 1) % inp.length];
        const da = dist(a), db = dist(b);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
    }
    return out;
  }

  /* ---------- 绘制小工具 ---------- */
  function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  function dot(ctx, p, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(p.x || p[0], p.y || p[1], r, 0, 7);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
  }
  function label(ctx, x, y, text, color) {
    ctx.fillStyle = color || "#8a857a"; ctx.font = "10px sans-serif";
    ctx.fillText(text, x, y);
  }

  /* 面片：给定点集与面索引，按观察空间深度由远及近填充 */
  function drawSolid(ctx, ptsWorld, faces, viewZ, proj, alpha) {
    const order = faces.map((f, i) => ({ f, z: viewZ[i] })).sort((a, b) => a.z - b.z);
    for (const { f } of order) {
      const pp = f.map(i => proj[i]);
      if (pp.some(p => !p.ok)) continue;
      // 面法线（世界空间）光照
      const w0 = ptsWorld[f[0]], w1 = ptsWorld[f[1]], w2 = ptsWorld[f[2]];
      const n = M4.normalize(M4.cross(M4.sub(w1, w0), M4.sub(w2, w0)));
      const L = 0.52 + 0.48 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      ctx.beginPath();
      pp.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = `rgba(62,124,111,${(alpha || 0.88) * L})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(28,58,52,.85)"; ctx.lineWidth = 1.1; ctx.stroke();
    }
  }

  function drawAxesAndGrid(ctx, proj) {
    // 地面网格
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(150,143,128,.34)";
    for (let v = -GRID_EXT; v <= GRID_EXT + 1e-6; v += GRID_STEP) {
      const a = proj([v, GRID_Y, -GRID_EXT]), b = proj([v, GRID_Y, GRID_EXT]);
      if (a.ok && b.ok) line(ctx, a, b);
      const c = proj([-GRID_EXT, GRID_Y, v]), d = proj([GRID_EXT, GRID_Y, v]);
      if (c.ok && d.ok) line(ctx, c, d);
    }
    // 坐标轴
    const axes = [[[0, 0, 0], [AX_LEN, 0, 0], AX_COLORS.x, "X"],
                  [[0, 0, 0], [0, AX_LEN, 0], AX_COLORS.y, "Y"],
                  [[0, 0, 0], [0, 0, AX_LEN], AX_COLORS.z, "Z"]];
    for (const [o, e, col, name] of axes) {
      const a = proj(o), b = proj(e);
      if (a.ok && b.ok) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.8; line(ctx, a, b);
        label(ctx, b.x + 3, b.y + 3, name, col);
      }
    }
  }

  function drawCubeWire(ctx, proj) {
    ctx.strokeStyle = "rgba(28,58,52,.9)"; ctx.lineWidth = 1.3;
    for (const [a, b] of CUBE_EDGES) {
      const pa = proj(CUBE_VERTS[a]), pb = proj(CUBE_VERTS[b]);
      if (pa.ok && pb.ok) line(ctx, pa, pb);
    }
  }

  /* ============================================================
   * 各面板渲染
   * ============================================================ */
  function render() {
    const world = CW.world, view = CW.view, ndcC = CW.ndc, scr = CW.screen, dep = CW.depth;
    const aspW = world.w / world.h;
    const { M, V, P, PV, eye } = computeMats(aspW);
    const PVscr = M4.mul(M4.mul(P, V), M); // 仅用于屏幕面板（含模型）

    // —— 全部点的各阶段坐标 ——
    const vWorld = CUBE_VERTS.map(p => M4.transformVec4(M, [p[0], p[1], p[2], 1]).slice(0, 3));
    const vView = vWorld.map(p => M4.transformVec4(V, [p[0], p[1], p[2], 1]).slice(0, 3));
    const vClip = vWorld.map(p => M4.transformVec4(P, M4.transformVec4(V, [p[0], p[1], p[2], 1])));
    const vNdc = vClip.map(c => toNDC(c));

    // 面片观察深度（用于画家算法）
    const faceViewZ = CUBE_FACES.map(f => f.reduce((s, i) => s + vView[i][2], 0) / f.length);

    /* ===== 面板 1：世界空间（第三方视角） ===== */
    {
      const { ctx, w, h } = world;
      ctx.clearRect(0, 0, w, h);
      const proj = p => projectTo(PV, p, w, h);
      drawAxesAndGrid(ctx, proj);
      // 视锥体（NDC 角点反投影）
      if (state.showFrustum) {
        const inv = M4.invert(PV);
        if (inv) {
          const cs = [];
          for (const zz of [-1, 1]) for (const yy of [-1, 1]) for (const xx of [-1, 1]) {
            const q = M4.transformVec4(inv, [xx, yy, zz, 1]);
            cs.push([q[0] / q[3], q[1] / q[3], q[2] / q[3]]);
          }
          const NEAR = [0, 1, 3, 2], FAR = [4, 5, 7, 6];
          ctx.strokeStyle = "rgba(168,129,79,.9)"; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
          for (const loop of [NEAR, FAR]) {
            ctx.beginPath();
            loop.forEach((i, k) => { const p = proj(cs[i]); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
            ctx.closePath(); ctx.stroke();
          }
          for (let i = 0; i < 4; i++) { const a = proj(cs[NEAR[i]]), b = proj(cs[FAR[i]]); if (a.ok && b.ok) line(ctx, a, b); }
          ctx.setLineDash([]);
          const e = proj(eye);
          if (e.ok) { dot(ctx, e, 4.5, "#a8814f", "#fff"); label(ctx, e.x + 7, e.y - 6, "camera(eye)", "#a8814f"); }
          const n = proj(cs[0]); if (n.ok) label(ctx, n.x - 24, n.y + 12, "near", "#a8814f");
          const f = proj(cs[4]); if (f.ok) label(ctx, f.x - 20, f.y + 12, "far", "#a8814f");
        }
      }
      drawSolid(ctx, vWorld, CUBE_FACES, faceViewZ, vWorld.map(p => projectTo(PV, p, w, h)), 0.9);
      drawCubeWire(ctx, proj);
      // 追踪顶点（金色）
      const g = proj(vWorld[state.traceIdx]);
      if (g.ok) dot(ctx, g, 5, "#d4a437", "#fff");
    }

    /* ===== 面板 2：相机空间（View）=====
       点位 = V·M·v；用固定辅助相机从 +Z 方向观察，使 -Z 指向屏幕内 */
    {
      const { ctx, w, h } = view;
      ctx.clearRect(0, 0, w, h);
      const Va = M4.lookAt([0, 1.1, 6.4], [0, 0, -2.6], [0, 1, 0]);
      const Pa = M4.perspective(42, w / h, 0.1, 60);
      const PVa = M4.mul(Pa, Va);
      const projV = p => projectTo(PVa, p, w, h);
      // 相机坐标系原点与三轴（视图空间本身）
      const vAxes = [[[0, 0, 0], [1.6, 0, 0], AX_COLORS.x, "Xc"],
                     [[0, 0, 0], [0, 1.6, 0], AX_COLORS.y, "Yc"],
                     [[0, 0, 0], [0, 0, -1.9], AX_COLORS.z, "-Zc (视线)"]];
      for (const [o, e, col, name] of vAxes) {
        const a = projV(o), b = projV(e);
        if (a.ok && b.ok) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; line(ctx, a, b); label(ctx, b.x + 2, b.y + 3, name, col); }
      }
      // 视锥（在视图空间中即原点向 -Z 的棱台）
      const t = Math.tan(state.fov * Math.PI / 360), aW = world.w / world.h;
      ctx.strokeStyle = "rgba(168,129,79,.95)"; ctx.lineWidth = 1.1; ctx.setLineDash([4, 3]);
      if (!state.ortho) {
        const nr = [[-t * state.near * aW, -t * state.near, -state.near], [t * state.near * aW, -t * state.near, -state.near],
                    [t * state.near * aW, t * state.near, -state.near], [-t * state.near * aW, t * state.near, -state.near]];
        const fr = [[-t * state.far * aW, -t * state.far, -state.far], [t * state.far * aW, -t * state.far, -state.far],
                    [t * state.far * aW, t * state.far, -state.far], [-t * state.far * aW, t * state.far, -state.far]];
        for (const loop of [nr, fr]) {
          ctx.beginPath();
          loop.forEach((p, k) => { const q = projV(p); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
          ctx.closePath(); ctx.stroke();
        }
        for (let i = 0; i < 4; i++) { const a = projV(nr[i]), b = projV(fr[i]); if (a.ok && b.ok) line(ctx, a, b); }
        label(ctx, projV(nr[0]).x - 8, projV(nr[0]).y + 12, "near", "#a8814f");
        label(ctx, projV(fr[0]).x - 8, projV(fr[0]).y + 12, "far", "#a8814f");
      } else {
        const os = state.orthoSize * aW;
        const nb = [[-os, -state.orthoSize, -state.near], [os, -state.orthoSize, -state.near], [os, state.orthoSize, -state.near], [-os, state.orthoSize, -state.near]];
        const fb = [[-os, -state.orthoSize, -state.far], [os, -state.orthoSize, -state.far], [os, state.orthoSize, -state.far], [-os, state.orthoSize, -state.far]];
        for (const loop of [nb, fb]) {
          ctx.beginPath();
          loop.forEach((p, k) => { const q = projV(p); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
          ctx.closePath(); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      dot(ctx, projV([0, 0, 0]), 4, "#a8814f", "#fff");
      label(ctx, projV([0, 0, 0]).x + 6, projV([0, 0, 0]).y + 12, "eye = 原点", "#a8814f");
      // 几何体（视图空间坐标直接投影）
      drawSolid(ctx, vView, CUBE_FACES, faceViewZ, vView.map(p => projV(p)), 0.9);
      ctx.strokeStyle = "rgba(28,58,52,.9)"; ctx.lineWidth = 1.2;
      for (const [a, b] of CUBE_EDGES) { const pa = projV(vView[a]), pb = projV(vView[b]); if (pa.ok && pb.ok) line(ctx, pa, pb); }
      const g = projV(vView[state.traceIdx]); if (g.ok) dot(ctx, g, 4.5, "#d4a437", "#fff");
    }

    /* ===== 面板 3：NDC 裁剪空间 ===== */
    {
      const { ctx, w, h } = ndcC;
      ctx.clearRect(0, 0, w, h);
      const iso = M4.mulAll(M4.rotX(-20), M4.rotY(-32), M4.scaleM(Math.min(w, h) / 3.4));
      const cx = w / 2, cy = h / 2 + 4;
      const projN = p => { const q = M4.transformVec4(iso, [p[0], p[1], p[2], 1]); return { ok: true, x: q[0] + cx, y: cy - q[1] }; };
      // 裁剪立方体 [-1,1]³
      const C = [];
      for (const zz of [-1, 1]) for (const yy of [-1, 1]) for (const xx of [-1, 1]) C.push([xx, yy, zz]);
      const E8 = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
      ctx.strokeStyle = "rgba(91,122,140,.75)"; ctx.lineWidth = 1.1; ctx.setLineDash([3, 3]);
      for (const [a, b] of E8) line(ctx, projN(C[a]), projN(C[b]));
      ctx.setLineDash([]);
      // NDC 三轴
      for (const [e, col, name] of [[[1.35, 0, 0], AX_COLORS.x, "x"], [[0, 1.35, 0], AX_COLORS.y, "y"], [[0, 0, 1.35], AX_COLORS.z, "z"]]) {
        const b = projN(e); ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        line(ctx, projN([0, 0, 0]), b); label(ctx, b.x + 2, b.y + 3, name, col);
      }
      // 几何体的 NDC 点云（面用半透明填充保序）
      const ndcProj = vNdc.map(p => p ? projN(p) : { ok: false });
      drawSolid(ctx, vNdc.map(p => p || [9, 9, 9]), CUBE_FACES, faceViewZ, ndcProj, 0.82);
      ctx.strokeStyle = "rgba(28,58,52,.85)"; ctx.lineWidth = 1;
      for (const [a, b] of CUBE_EDGES) { const pa = ndcProj[a], pb = ndcProj[b]; if (pa.ok && pb.ok) line(ctx, pa, pb); }
      // 越界顶点标红
      vNdc.forEach((p, i) => {
        if (!p) return;
        const out = Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1 || Math.abs(p[2]) > 1;
        const q = projN(p);
        if (out) dot(ctx, q, 3.4, "rgba(179,86,77,.95)", "#fff");
      });
      const g = vNdc[state.traceIdx]; if (g) dot(ctx, projN(g), 4.5, "#d4a437", "#fff");
      label(ctx, 8, h - 6, "÷w 后：四棱锥 → [-1,1]³ 立方体；红点 = 越界待裁剪", "#8a857a");
    }

    /* ===== 面板 4：屏幕像素（Viewport，含真实裁剪） ===== */
    {
      const { ctx, w, h } = scr;
      ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, w, h);
      const mapN = p => ({ ok: true, x: (p[0] + 1) * 0.5 * w, y: (1 - p[1]) * 0.5 * h });
      // 面片：先在裁剪空间对 6 个半空间 S-H 裁剪，再除 w、视口映射
      const order = CUBE_FACES.map((f, i) => ({ f, z: faceViewZ[i] })).sort((a, b) => a.z - b.z);
      for (const { f } of order) {
        const clips = f.map(i => vClip[i]);
        // 裁剪空间多边形：对 6 个半空间 S-H 裁剪
        let poly = clips.map(c => c.slice());
        const planes = [
          (p) => p[3] + p[0], (p) => p[3] - p[0],
          (p) => p[3] + p[1], (p) => p[3] - p[1],
          (p) => p[3] + p[2], (p) => p[3] - p[2]
        ];
        for (const dist of planes) {
          const inp = poly; poly = [];
          if (!inp.length) break;
          for (let i = 0; i < inp.length; i++) {
            const A = inp[i], B = inp[(i + 1) % inp.length];
            const da = dist(A), db = dist(B);
            if (da >= 0) poly.push(A);
            if ((da >= 0) !== (db >= 0)) {
              const t = da / (da - db);
              poly.push([0, 1, 2, 3].map(k => A[k] + (B[k] - A[k]) * t));
            }
          }
        }
        if (poly.length < 3) continue;
        const n = M4.normalize(M4.cross(
          M4.sub(vWorld[f[1]], vWorld[f[0]]), M4.sub(vWorld[f[2]], vWorld[f[0]])));
        const L = 0.52 + 0.48 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        ctx.beginPath();
        poly.forEach((c, k) => {
          const nd = toNDC(c); const p = mapN(nd);
          k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = `rgba(62,124,111,${0.9 * L})`; ctx.fill();
        ctx.strokeStyle = "rgba(28,58,52,.8)"; ctx.lineWidth = 1; ctx.stroke();
      }
      // 金色顶点（若在视锥内）
      const gNdc = vNdc[state.traceIdx];
      if (gNdc && Math.abs(gNdc[0]) <= 1 && Math.abs(gNdc[1]) <= 1 && Math.abs(gNdc[2]) <= 1) {
        dot(ctx, mapN(gNdc), 5, "#d4a437", "#fff");
      }
      // 视口边框
      ctx.strokeStyle = "#c4bfaf"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
      label(ctx, 8, 14, "viewport: x′=(x+1)/2·W, y′=(1−y)/2·H", "#8a857a");
    }

    /* ===== 深度非线性曲线 ===== */
    {
      const { ctx, w, h } = dep;
      ctx.clearRect(0, 0, w, h);
      const pad = { l: 30, r: 10, t: 12, b: 20 };
      const X0 = pad.l, X1 = w - pad.r, Y0 = pad.t, Y1 = h - pad.b;
      const zvMin = -state.far, zvMax = -state.near;
      const ndcAt = zv => {
        const c = M4.transformVec4(P, [0, 0, zv, 1]);
        return c[2] / c[3];
      };
      // 坐标轴
      ctx.strokeStyle = "#d8d2c2"; ctx.lineWidth = 1;
      line(ctx, [X0, Y0], [X0, Y1]); line(ctx, [X0, (Y0 + Y1) / 2], [X1, (Y0 + Y1) / 2]);
      label(ctx, X0 - 22, Y0 + 8, "z′=1", "#8a857a");
      label(ctx, X0 - 22, Y1, "z′=-1", "#8a857a");
      label(ctx, X1 - 20, Y1 + 14, "z=-near", "#8a857a");
      label(ctx, X0, Y1 + 14, "z=-far", "#8a857a");
      // 曲线
      ctx.strokeStyle = "#3e7c6f"; ctx.lineWidth = 1.8; ctx.beginPath();
      const NPTS = 90;
      for (let i = 0; i <= NPTS; i++) {
        const zv = zvMin + (zvMax - zvMin) * i / NPTS;
        const zz = ndcAt(zv);
        const x = X0 + (X1 - X0) * (i / NPTS);
        const y = Y1 - (zz + 1) / 2 * (Y1 - Y0);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      // 金色顶点的 z
      const gz = vView[state.traceIdx][2];
      if (gz <= zvMax && gz >= zvMin) {
        const zz = ndcAt(gz);
        const x = X0 + (X1 - X0) * ((gz - zvMin) / (zvMax - zvMin));
        const y = Y1 - (zz + 1) / 2 * (Y1 - Y0);
        dot(ctx, { x, y }, 4, "#d4a437", "#fff");
        label(ctx, x + 5, y - 4, "追踪顶点", "#a8814f");
      }
      if (state.ortho) label(ctx, w / 2 - 52, Y0 + 4, "正交投影：深度线性", "#8a857a");
    }

    /* ===== HTML 面板：矩阵 / 顶点追踪 ===== */
    renderMatrixPanel(M, V, P, PV);
    renderTrace(vWorld, vView, vClip, vNdc, scr);
  }

  /* ---------- 矩阵面板 ---------- */
  function matHTML(m, title) {
    let cells = "";
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) cells += `<span>${fmt(m[c * 4 + r])}</span>`;
    return `<div><div class="mat-title">${title}</div><div class="mat">${cells}</div></div>`;
  }
  function renderMatrixPanel(M, V, P, PV) {
    document.getElementById("gfx-matrices").innerHTML =
      `<div class="mat-row2">${matHTML(M, "M 模型 = R<sub>y</sub>·R<sub>x</sub>·S")}${matHTML(V, "V 视图 = lookAt")}${matHTML(P, `P ${state.ortho ? "正交" : "透视"}`)}${matHTML(PV, "P·V")}</div>
       <p class="note" style="margin:10px 0 0">列主序存储、列向量右乘：<b>v<sub>clip</sub> = P·(V·(M·v))</b>，矩阵从右往左作用。</p>`;
  }

  /* ---------- 顶点追踪面板 ---------- */
  function renderTrace(vWorld, vView, vClip, vNdc, scr) {
    const i = state.traceIdx;
    const vLocal = CUBE_VERTS[i];
    const c = vClip[i], nd = vNdc[i];
    const inside = nd && Math.abs(nd[0]) <= 1 && Math.abs(nd[1]) <= 1 && Math.abs(nd[2]) <= 1;
    const sp = nd ? { x: (nd[0] + 1) * 0.5 * scr.w, y: (1 - nd[1]) * 0.5 * scr.h } : null;
    const box = (val, warn) => `<div class="trace-val${warn ? " warn" : ""}">${val}</div>`;
    document.getElementById("gfx-trace").innerHTML = `
      <div class="mc-head"><h4>顶点全链路追踪 <span class="year">#${i}（金色）</span></h4>
        <button class="btn small ghost" id="gfx-cycle">切换追踪顶点</button></div>
      <div class="trace-grid">
        <div class="trace-space">局部 local</div>${box(`(${fmtArr(vLocal)})`)}</div>
      <div class="trace-grid">
        <div class="trace-space">世界 world</div>${box(`(${fmtArr(vWorld[i])})　← M·v`)}</div>
      <div class="trace-grid">
        <div class="trace-space">相机 view</div>${box(`(${fmtArr(vView[i])})　← V·v${vView[i][2] < 0 ? "　(z&lt;0 在相机前方 ✓)" : "　(z&gt;0 在相机后方!)"}`)}</div>
      <div class="trace-grid">
        <div class="trace-space">裁剪 clip</div>${box(`(${fmtArr(c, 4)})　w = −z<sub>view</sub>`, c[3] <= 0)}</div>
      <div class="trace-grid">
        <div class="trace-space">NDC（÷w）</div>${inside ? box(`(${fmtArr(nd)})`) : box(nd ? `(${fmtArr(nd)})　越界 → 待裁剪` : "w≤0，无法除法（顶点在相机之后）", true)}</div>
      <div class="trace-grid">
        <div class="trace-space">屏幕 px</div>${inside ? box(`(${sp.x.toFixed(0)}, ${sp.y.toFixed(0)})　x′=(x+1)/2·W, y′=(1−y)/2·H`) : box("—", true)}</div>
      <p class="note" style="margin:10px 0 0">${inside
        ? "该顶点位于视锥内：裁剪测试 −w ≤ x,y,z ≤ w 全部通过。"
        : "该顶点当前在视锥外：所在图元会被裁剪（见「屏幕像素」面板中被切掉的部分）。点击上方滑块或拖动视图可把它带回视锥内。"}</p>`;
    const btn = document.getElementById("gfx-cycle");
    if (btn) btn.addEventListener("click", () => { state.traceIdx = (state.traceIdx + 1) % 8; scheduleRender(); });
  }

  /* ---------- 渲染调度 ----------
     策略：事件驱动同步渲染（拖动/滑块/开关即时重绘，首帧同步出图），
     rAF 仅用于「自动旋转」动画；后台标签页中 rAF 被冻结时交互渲染依然可用。 */
  let rendering = false;
  function scheduleRender() {
    if (rendering) return;
    rendering = true;
    try { render(); } catch (e) { console.error("gfx render:", e); }
    rendering = false;
  }
  let spinRaf = 0;
  function spinLoop() {
    if (!state.spin) return;
    state.ry = (state.ry + 0.35) % 360;
    scheduleRender();
    spinRaf = requestAnimationFrame(spinLoop);
  }

  /* ---------- 交互 ---------- */
  function bindPointer(cv) {
    let dragging = false, lx = 0, ly = 0;
    const rect = () => cv.c.getBoundingClientRect();
    const scale = (e) => { const r = rect(); return { x: (e.clientX - r.left) * (cv.w / r.width), y: (e.clientY - r.top) * (cv.h / r.height) }; };
    cv.c.style.touchAction = "none";
    cv.c.addEventListener("pointerdown", e => { dragging = true; lx = e.clientX; ly = e.clientY; cv.c.setPointerCapture(e.pointerId); });
    cv.c.addEventListener("pointermove", e => {
      if (!dragging) return;
      state.theta -= (e.clientX - lx) * 0.4;
      state.phi = Math.max(-4, Math.min(78, state.phi + (e.clientY - ly) * 0.3));
      lx = e.clientX; ly = e.clientY;
      scheduleRender();
    });
    cv.c.addEventListener("pointerup", () => { dragging = false; });
    cv.c.addEventListener("wheel", e => {
      e.preventDefault();
      state.radius = Math.max(2.6, Math.min(15, state.radius * (1 + e.deltaY * 0.001)));
      scheduleRender();
    }, { passive: false });
  }

  function bindControls() {
    const g = id => document.getElementById(id);
    const bindRange = (id, key, cb) => {
      const el = g(id), val = g(id + "-val");
      el.addEventListener("input", () => {
        state[key] = +el.value;
        if (val) val.textContent = fmt(+el.value);
        cb && cb();
        scheduleRender();
      });
    };
    bindRange("gfx-fov", "fov");
    bindRange("gfx-near", "near");
    bindRange("gfx-far", "far");
    bindRange("gfx-ortho-size", "orthoSize");
    bindRange("gfx-rx", "rx");
    bindRange("gfx-ry", "ry");
    bindRange("gfx-scale", "scale");
    g("gfx-ortho").addEventListener("change", e => {
      state.ortho = e.target.checked;
      g("gfx-fov-row").style.display = state.ortho ? "none" : "";
      g("gfx-ortho-size-row").style.display = state.ortho ? "" : "none";
      scheduleRender();
    });
    g("gfx-spin").addEventListener("change", e => {
      state.spin = e.target.checked;
      if (state.spin) spinLoop(); else cancelAnimationFrame(spinRaf);
    });
    g("gfx-frustum").addEventListener("change", e => { state.showFrustum = e.target.checked; scheduleRender(); });
    bindPointer(CW.world);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (built) return;
    built = true;
    CW.world = setupCanvas("gfx-world", 660, 430);
    CW.view = setupCanvas("gfx-view", 320, 235);
    CW.ndc = setupCanvas("gfx-ndc", 320, 235);
    CW.screen = setupCanvas("gfx-screen", 320, 235);
    CW.depth = setupCanvas("gfx-depth", 300, 150);
    bindControls();
    ArchViz.horizontal(document.getElementById("gfx-flow"), {
      blocks: [
        { label: "顶点数据", sub: "局部坐标 VBO", tone: "data" },
        { label: "模型变换 M", sub: "局部 → 世界", tone: "conv" },
        { label: "视图变换 V", sub: "世界 → 相机", tone: "conv" },
        { label: "投影 P", sub: "相机 → 裁剪", tone: "conv" },
        { label: "裁剪", sub: "−w ≤ x,y,z ≤ w", tone: "stage" },
        { label: "透视除法", sub: "÷w → NDC", tone: "stage" },
        { label: "视口变换", sub: "NDC → 像素", tone: "stage" },
        { label: "光栅化", sub: "三角形 → 片元", tone: "io" },
        { label: "片段着色", sub: "纹理 / 光照", tone: "io" },
        { label: "输出合并", sub: "深度 / 混合测试", tone: "io" }
      ]
    });
    scheduleRender(); // 同步首帧（不依赖 rAF，后台标签页也能出图）
  }

  window.GraphicsPage = { init };
})();
