/* ============================================================
 * mat4.js — 手写三维数学库（严格遵循本系统约定）
 *   右手坐标系 · 列主序存储 · 列向量右乘 v' = M·v
 *   相机看向 -Z · 透视投影映射到 NDC 深度 [-1,1]（OpenGL 风格）
 * ============================================================ */
(function () {
  "use strict";
  const rad = d => d * Math.PI / 180;
  const M4 = {};

  M4.identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /* 矩阵乘法 C = A·B（列主序） */
  M4.mul = function (a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  };
  M4.mulAll = (...ms) => ms.reduce((acc, m) => M4.mul(acc, m));

  /* 变换四维向量 v' = M·v */
  M4.transformVec4 = function (m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
    ];
  };

  /* 透视投影（右手系、朝 -Z、NDC 深度 [-1,1]）
     fovyDeg: 垂直视场角；aspect: 宽高比；n/f: 近远平面距离（正数） */
  M4.perspective = function (fovyDeg, aspect, n, f) {
    const t = 1 / Math.tan(rad(fovyDeg) / 2);
    return new Float32Array([
      t / aspect, 0, 0, 0,
      0, t, 0, 0,
      0, 0, (f + n) / (n - f), -1,
      0, 0, (2 * f * n) / (n - f), 0
    ]);
  };

  /* 正交投影（同一套约定） */
  M4.ortho = function (l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1
    ]);
  };

  /* 视图矩阵 lookAt（右手系：相机空间 X 右 / Y 上 / Z 从屏幕指向观察者，可见物体 z<0） */
  M4.lookAt = function (eye, center, up) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const f = nrm(sub(center, eye));   // 前向（指向目标）
    const s = nrm(crs(f, up));         // 右向
    const u = crs(s, f);               // 上向
    return new Float32Array([
      s[0], u[0], -f[0], 0,
      s[1], u[1], -f[1], 0,
      s[2], u[2], -f[2], 0,
      -dot(s, eye), -dot(u, eye), dot(f, eye), 1
    ]);
  };

  /* 基础变换 */
  M4.rotX = d => { const c = Math.cos(rad(d)), s = Math.sin(rad(d));
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
  M4.rotY = d => { const c = Math.cos(rad(d)), s = Math.sin(rad(d));
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
  M4.rotZ = d => { const c = Math.cos(rad(d)), s = Math.sin(rad(d));
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
  M4.scaleM = s => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  M4.translateM = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  /* 一般 4×4 求逆（伴随矩阵法，列主序；用于把 NDC 视锥角点反投影回世界空间） */
  M4.invert = function (m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
          a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
          a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
          a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
          b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
          b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
          b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    const o = new Float32Array(16);
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  };

  /* 向量工具 */
  M4.normalize = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  M4.cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  M4.sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  window.M4 = M4;
})();
