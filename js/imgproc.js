/* ============================================================
 * imgproc.js — 核心图像算法库（纯 JS / 无依赖）
 * 覆盖：RAW 模拟、黑电平、坏点、AWB、去马赛克、降噪、
 *       CCM、Gamma、锐化、色彩增强、滤波、边缘、形态学、
 *       直方图、噪声模型、PSNR / SSIM 评估
 * ============================================================ */
(function () {
  "use strict";
  const IP = {};

  /* ---------- 基础工具 ---------- */
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  IP.clamp = clamp;

  IP.makeCanvas = function (w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  };

  IP.putImageData = function (canvas, imgData) {
    canvas.width = imgData.width; canvas.height = imgData.height;
    canvas.getContext("2d").putImageData(imgData, 0, 0);
  };

  IP.copyImageData = function (img) {
    return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  };

  /* 缩放 ImageData 到指定最大边长（最近邻 + box 近似） */
  IP.resize = function (img, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale >= 1) return img;
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(img.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / scale));
        const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
        out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1];
        out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255;
      }
    }
    return out;
  };

  /* 灰度（Rec.601 亮度），返回 Float32Array */
  IP.toGray = function (img) {
    const n = img.width * img.height, g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      g[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
    }
    return g;
  };

  /* ============================================================
   * 评估指标：PSNR / SSIM
   * ============================================================ */
  IP.psnr = function (a, b) {
    if (a.width !== b.width || a.height !== b.height) return NaN;
    let mse = 0;
    const n = a.data.length;
    for (let i = 0; i < n; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = a.data[i + c] - b.data[i + c];
        mse += d * d;
      }
    }
    mse /= (n / 4) * 3;
    if (mse === 0) return Infinity;
    return 10 * Math.log10(255 * 255 / mse);
  };

  IP.ssim = function (a, b) {
    if (a.width !== b.width || a.height !== b.height) return NaN;
    const w = a.width, h = a.height;
    const ga = IP.toGray(a), gb = IP.toGray(b);
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    // 11×11 高斯窗 σ=1.5
    const K = 11, half = 5, win = new Float32Array(K * K);
    let wsum = 0;
    for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) {
      const v = Math.exp(-((x - half) ** 2 + (y - half) ** 2) / (2 * 1.5 * 1.5));
      win[y * K + x] = v; wsum += v;
    }
    for (let i = 0; i < win.length; i++) win[i] /= wsum;
    let ssimSum = 0, cnt = 0;
    for (let y = half; y < h - half; y += 1) {
      for (let x = half; x < w - half; x += 1) {
        let ma = 0, mb = 0;
        for (let dy = -half; dy <= half; dy++)
          for (let dx = -half; dx <= half; dx++) {
            const wv = win[(dy + half) * K + dx + half];
            const ia = ga[(y + dy) * w + x + dx], ib = gb[(y + dy) * w + x + dx];
            ma += wv * ia; mb += wv * ib;
          }
        let va = 0, vb = 0, cov = 0;
        for (let dy = -half; dy <= half; dy++)
          for (let dx = -half; dx <= half; dx++) {
            const wv = win[(dy + half) * K + dx + half];
            const ia = ga[(y + dy) * w + x + dx] - ma;
            const ib = gb[(y + dy) * w + x + dx] - mb;
            va += wv * ia * ia; vb += wv * ib * ib; cov += wv * ia * ib;
          }
        const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
        ssimSum += s; cnt++;
      }
    }
    return ssimSum / cnt;
  };

  /* ============================================================
   * 噪声模型
   * ============================================================ */
  IP.addGaussianNoise = function (img, sigma) {
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        // Box-Muller
        const u = Math.random() || 1e-9, v = Math.random() || 1e-9;
        out.data[i + c] = clamp(out.data[i + c] + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), 0, 255);
      }
    }
    return out;
  };

  IP.addSaltPepper = function (img, rate) {
    const out = IP.copyImageData(img);
    const n = out.width * out.height;
    for (let k = 0; k < n * rate; k++) {
      const x = (Math.random() * out.width) | 0, y = (Math.random() * out.height) | 0;
      const j = (y * out.width + x) * 4;
      const v = Math.random() < 0.5 ? 0 : 255;
      out.data[j] = out.data[j + 1] = out.data[j + 2] = v;
    }
    return out;
  };

  /* ============================================================
   * RAW / Bayer 模拟（RGGB）
   * ============================================================ */
  /* scene: ImageData（视为线性场景值）
   * opts: { blackLevel, noiseSigma, deadRate, shading, exposure, tintR, tintB } */
  IP.simulateRAW = function (scene, opts) {
    const w = scene.width, h = scene.height;
    const bayer = new Float32Array(w * h);
    const bl = opts.blackLevel, sigma = opts.noiseSigma;
    const exp = opts.exposure ?? 1;
    // 光谱串扰：CFA 通道并非理想窄带，R 通道也会收到少量 G/B 光（CCM 校正的对象）
    const XT = [0.82, 0.13, 0.05, 0.09, 0.85, 0.06, 0.04, 0.11, 0.85];
    const tintR = opts.tintR ?? 1, tintB = opts.tintB ?? 1;
    const cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4;
        // 线性化后的三通道场景值
        const lr = 255 * Math.pow(scene.data[j] / 255, 2.2);
        const lg = 255 * Math.pow(scene.data[j + 1] / 255, 2.2);
        const lb = 255 * Math.pow(scene.data[j + 2] / 255, 2.2);
        // 光谱串扰混合 → 传感器各通道实际接收到的光
        const sr2 = XT[0] * lr + XT[1] * lg + XT[2] * lb;
        const sg2 = XT[3] * lr + XT[4] * lg + XT[5] * lb;
        const sb2 = XT[6] * lr + XT[7] * lg + XT[8] * lb;
        const px = x & 1, py = y & 1;
        let v;
        if (py === 0 && px === 0) v = sr2 * tintR;
        else if (py === 0 && px === 1) v = sg2;
        else if (py === 1 && px === 0) v = sg2;
        else v = sb2 * tintB;
        v *= exp;
        if (opts.shading) {
          const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / (maxR * maxR);
          v *= 1 - 0.25 * r2;
        }
        if (sigma > 0) {
          const u1 = Math.random() || 1e-9, u2 = Math.random() || 1e-9;
          v += sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        }
        bayer[i] = clamp(v + bl, 0, 255);
      }
    }
    // 坏点
    const dead = [];
    if (opts.deadRate > 0) {
      const n = Math.floor(w * h * opts.deadRate);
      for (let k = 0; k < n; k++) {
        const x = (Math.random() * w) | 0, y = (Math.random() * h) | 0;
        bayer[y * w + x] = Math.random() < 0.5 ? bl : 255;
        dead.push([x, y]);
      }
    }
    return { bayer, w, h, dead };
  };

  /* Bayer → 可视化 ImageData（未插值；线性域值很暗，显示时加预览 Gamma） */
  IP.bayerToView = function (raw) {
    const { bayer, w, h } = raw;
    const out = new ImageData(w, h);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = clamp(255 * Math.pow(v / 255, 1 / 2.2), 0, 255);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4;
        const v = lut[clamp(bayer[i], 0, 255) | 0];
        out.data[j] = (y % 2 === 0 && x % 2 === 0) ? v : 0;
        out.data[j + 1] = (x % 2 !== y % 2) ? v : 0;
        out.data[j + 2] = (y % 2 === 1 && x % 2 === 1) ? v : 0;
        out.data[j + 3] = 255;
      }
    }
    return out;
  };

  /* ---------- 黑电平校正 ---------- */
  IP.blackLevelCorrect = function (raw, blackLevel) {
    const { bayer } = raw;
    for (let i = 0; i < bayer.length; i++) bayer[i] = clamp(bayer[i] - blackLevel, 0, 255);
  };

  /* ---------- 镜头阴影校正 LSC（渐晕增益补偿） ----------
     与 simulateRAW 中的 vignette 模型 (1 - 0.25·r²) 对应的逆变换 */
  IP.correctLSC = function (raw, strength) {
    const { bayer, w, h } = raw;
    const cx = w / 2, cy = h / 2, maxR2 = cx * cx + cy * cy;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / maxR2;
        const i = y * w + x;
        bayer[i] = clamp(bayer[i] * (1 + strength * 0.25 * r2), 0, 255);
      }
    }
  };

  /* ---------- RAW 域中值降噪（去马赛克之前） ---------- */
  IP.medianBayer = function (raw, size) {
    const { w, h } = raw;
    const half = size >> 1;
    const copy = raw.bayer.slice();
    const buf = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        buf.length = 0;
        for (let dy = -half; dy <= half; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -half; dx <= half; dx++) buf.push(copy[yy * w + clamp(x + dx, 0, w - 1)]);
        }
        buf.sort((a, b) => a - b);
        raw.bayer[y * w + x] = buf[buf.length >> 1];
      }
    }
  };

  /* ---------- 坏点校正（ADC 上下溢出检测 + 邻域中值替换） ----------
     真实坏点通常表现为钳位在 ADC 量程两端（热像素 255 / 死像素 0）。
     若用「偏离 3×3 中值」判定，高频纹理会被误杀，因此改用 rail 检测。 */
  IP.correctDeadPixels = function (raw, railTolerance) {
    const { bayer, w, h } = raw;
    const tol = railTolerance ?? 3;
    let fixed = 0;
    const isRail = v => v <= tol || v >= 255 - tol;
    const copy = bayer.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!isRail(copy[i])) continue;
        const nb = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) nb.push(copy[i + dy * w + dx]);
        }
        nb.sort((a, b) => a - b);
        const med = nb[4];
        if (!isRail(med)) { bayer[i] = med; fixed++; }
      }
    }
    return fixed;
  };

  /* ============================================================
   * AWB（在 Bayer 上统计，增益作用于 R/B）
   * method: grayworld | dynamicThreshold | perfectReflector
   * ============================================================ */
  IP.computeAWBGains = function (raw, method, strength) {
    const { bayer, w, h } = raw;
    // 全图扫描（步长为 1 才能覆盖 R/G/B 三种相位；y+=2,x+=2 会只采到 R）
    let mr = 0, mg = 0, mb = 0, nr = 0, ng = 0, nb2 = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const px = x & 1, py = y & 1;
        if (py === 0 && px === 0) { mr += bayer[i]; nr++; }
        else if (py === 1 && px === 1) { mb += bayer[i]; nb2++; }
        else { mg += bayer[i]; ng++; }
      }
    }
    mr /= nr || 1; mg /= ng || 1; mb /= nb2 || 1;
    let gR = 1, gB = 1;
    if (method === "grayworld") {
      gR = mg / (mr || 1); gB = mg / (mb || 1);
    } else if (method === "dynamicThreshold") {
      // 仅统计亮度处于中位数 ±25% 内的像素（全扫描）
      const vals = [];
      for (let i = 0; i < bayer.length; i += 5) vals.push(bayer[i]);
      vals.sort((a, b) => a - b);
      const lo = vals[(vals.length * 0.35) | 0], hi = vals[(vals.length * 0.65) | 0];
      let sr = 0, sg = 0, sb = 0, cr = 0, cg = 0, cb = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = bayer[i];
        if (v < lo || v > hi) continue;
        const px = x & 1, py = y & 1;
        if (py === 0 && px === 0) { sr += v; cr++; }
        else if (py === 1 && px === 1) { sb += v; cb++; }
        else { sg += v; cg++; }
      }
      sr /= cr || 1; sg /= cg || 1; sb /= cb || 1;
      gR = sg / (sr || 1); gB = sg / (sb || 1);
    } else if (method === "perfectReflector") {
      // 高光统计
      let sr = 0, sg = 0, sb = 0, c = 0;
      const thr = 220;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, px = x & 1, py = y & 1;
        if (py === 0 && px === 0 && bayer[i] > thr) { sr += bayer[i]; c++; }
        else if (py === 1 && px === 1 && bayer[i] > thr) { sb += bayer[i]; c++; }
        else if (px !== py && bayer[i] > thr) { sg += bayer[i]; c++; }
      }
      if (c > 0) { gR = (sg / (sr || 1)); gB = (sg / (sb || 1)); }
      else { gR = mg / (mr || 1); gB = mg / (mb || 1); }
    }
    gR = clamp(1 + (gR - 1) * strength, 0.2, 4);
    gB = clamp(1 + (gB - 1) * strength, 0.2, 4);
    return { gR, gB };
  };

  IP.applyAWBGains = function (raw, gR, gB) {
    const { bayer, w, h } = raw;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, px = x & 1, py = y & 1;
      if (py === 0 && px === 0) bayer[i] = clamp(bayer[i] * gR, 0, 255);
      else if (py === 1 && px === 1) bayer[i] = clamp(bayer[i] * gB, 0, 255);
    }
  };

  /* ============================================================
   * 去马赛克 Demosaic
   * method: bilinear | edge (边缘自适应)
   * ============================================================ */
  /* 核心：输出 Float32 RGB（线性域不量化），IP.demosaic 为其 8bit 包装 */
  IP.demosaicCore = function (raw, method) {
    const { bayer, w, h } = raw;
    const out = { d: new Float32Array(w * h * 3), w, h };
    const at = (x, y) => bayer[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    const isR = (x, y) => (y % 2 === 0 && x % 2 === 0);
    const isB = (x, y) => (y % 2 === 1 && x % 2 === 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, k = i * 3;
        let r, g, b;
        if (isR(x, y)) { r = at(x, y); g = gAt(x, y); b = bAtR(x, y); }
        else if (isB(x, y)) { b = at(x, y); g = gAt(x, y); r = rAtB(x, y); }
        else {
          g = at(x, y);
          if (y % 2 === 0) { r = rAtGr(x, y); b = bAtGr(x, y); } // G 位于 R 行
          else { r = rAtGb(x, y); b = bAtGb(x, y); }
        }
        out.d[k] = clamp(r, 0, 255);
        out.d[k + 1] = clamp(g, 0, 255);
        out.d[k + 2] = clamp(b, 0, 255);
      }
    }
    // 边缘自适应模式下追加色差平滑：R-G / B-G 色差比亮度低频得多，
    // 平滑色差可显著抑制拉链伪影，也让后续 CCM 不再放大插值误差
    if (method === "edge") {
      const box3 = (src) => {
        const o = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            s += src[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
          o[y * w + x] = s / 9;
        }
        return o;
      };
      const dr = new Float32Array(w * h), db = new Float32Array(w * h);
      for (let i = 0, k = 0; i < w * h; i++, k += 3) { dr[i] = out.d[k] - out.d[k + 1]; db[i] = out.d[k + 2] - out.d[k + 1]; }
      const drs = box3(dr), dbs = box3(db);
      for (let i = 0, k = 0; i < w * h; i++, k += 3) {
        out.d[k] = clamp(out.d[k + 1] + drs[i], 0, 255);
        out.d[k + 2] = clamp(out.d[k + 1] + dbs[i], 0, 255);
      }
    }
    return out;

    /* G 通道 */
    function gAt(x, y) {
      if (method === "bilinear") {
        if (isR(x, y) || isB(x, y))
          return (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4;
        return at(x, y);
      }
      // 边缘自适应：R/B 位置上，按水平/垂直 G 梯度加权
      if (isR(x, y) || isB(x, y)) {
        const dh = Math.abs(at(x - 1, y) - at(x + 1, y));
        const dv = Math.abs(at(x, y - 1) - at(x, y + 1));
        if (dh + 4 < dv) return (at(x - 1, y) + at(x + 1, y)) / 2;
        if (dv + 4 < dh) return (at(x, y - 1) + at(x, y + 1)) / 2;
        return (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4;
      }
      return at(x, y);
    }
    /* 同色差值（对角） */
    function diagAvg(x, y) { return (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) / 4; }
    function bAtR(x, y) { return diagAvg(x, y); }
    function rAtB(x, y) { return diagAvg(x, y); }
    /* R/B 位于 G 位置：同色邻居只存在于一个方向（左右或上下），双线性即最优可用估计 */
    function rAtGr(x, y) { return (at(x - 1, y) + at(x + 1, y)) / 2; }
    function bAtGr(x, y) { return (at(x, y - 1) + at(x, y + 1)) / 2; }
    function rAtGb(x, y) { return (at(x, y - 1) + at(x, y + 1)) / 2; }
    function bAtGb(x, y) { return (at(x - 1, y) + at(x + 1, y)) / 2; }
  };

  IP.demosaicF = IP.demosaicCore;

  IP.demosaic = function (raw, method) {
    const f = IP.demosaicCore(raw, method);
    const out = new ImageData(f.w, f.h);
    for (let i = 0, j = 0, k = 0; i < f.w * f.h; i++, j += 4, k += 3) {
      out.data[j] = f.d[k]; out.data[j + 1] = f.d[k + 1]; out.data[j + 2] = f.d[k + 2];
      out.data[j + 3] = 255;
    }
    return out;
  };

  /* ============================================================
   * 降噪
   * ============================================================ */
  IP.medianFilter = function (img, size) {
    const w = img.width, h = img.height, half = size >> 1;
    const out = IP.copyImageData(img);
    const buf = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          buf.length = 0;
          for (let dy = -half; dy <= half; dy++) {
            const yy = clamp(y + dy, 0, h - 1);
            for (let dx = -half; dx <= half; dx++) {
              const xx = clamp(x + dx, 0, w - 1);
              buf.push(img.data[(yy * w + xx) * 4 + c]);
            }
          }
          buf.sort((a, b) => a - b);
          out.data[(y * w + x) * 4 + c] = buf[buf.length >> 1];
        }
      }
    }
    return out;
  };

  IP.gaussianBlurRGB = function (img, radius, sigma) {
    const w = img.width, h = img.height, r = Math.max(1, radius | 0);
    const kern = [];
    let ksum = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); kern.push(v); ksum += v; }
    for (let i = 0; i < kern.length; i++) kern[i] /= ksum;
    const tmp = new Float32Array(w * h * 3), out = IP.copyImageData(img);
    // 水平
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += kern[k + r] * img.data[(y * w + clamp(x + k, 0, w - 1)) * 4 + c];
        tmp[(y * w + x) * 3 + c] = s;
      }
    }
    // 垂直
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += kern[k + r] * tmp[(clamp(y + k, 0, h - 1) * w + x) * 3 + c];
        out.data[(y * w + x) * 4 + c] = clamp(s, 0, 255);
      }
    }
    return out;
  };

  IP.bilateralFilter = function (img, radius, sigmaColor) {
    const w = img.width, h = img.height, r = radius | 0;
    const out = IP.copyImageData(img);
    const gray = IP.toGray(img);
    const sc2 = 2 * sigmaColor * sigmaColor;
    const spatial = [], ss2 = 2 * (r / 2) * (r / 2) || 1;
    for (let dy = -r; dy <= r; dy++) { spatial.push([]); for (let dx = -r; dx <= r; dx++) spatial[dy + r][dx + r] = Math.exp(-(dx * dx + dy * dy) / ss2); }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = y * w + x, cg = gray[ci];
        let wr = 0, acc0 = 0, acc1 = 0, acc2 = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -r; dx <= r; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            const ni = yy * w + xx;
            const dg = gray[ni] - cg;
            const wt = spatial[dy + r][dx + r] * Math.exp(-(dg * dg) / sc2);
            const j = ni * 4;
            acc0 += wt * img.data[j]; acc1 += wt * img.data[j + 1]; acc2 += wt * img.data[j + 2];
            wr += wt;
          }
        }
        const o = (y * w + x) * 4;
        out.data[o] = clamp(acc0 / wr, 0, 255);
        out.data[o + 1] = clamp(acc1 / wr, 0, 255);
        out.data[o + 2] = clamp(acc2 / wr, 0, 255);
      }
    }
    return out;
  };

  /* 非局部均值（灰度引导、7×7 窗、3×3 patch，用于小图演示） */
  IP.nlmDenoise = function (img, strength) {
    const w = img.width, h = img.height, R = 3, P = 1;
    const gray = IP.toGray(img);
    const out = IP.copyImageData(img);
    const h2 = strength * strength;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let wsum = 0, a0 = 0, a1 = 0, a2 = 0;
        for (let dy = -R; dy <= R; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -R; dx <= R; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            if (!dx && !dy) continue;
            let d2 = 0, cnt = 0;
            for (let py = -P; py <= P; py++) for (let px = -P; px <= P; px++) {
              const i1 = clamp(y + py, 0, h - 1) * w + clamp(x + px, 0, w - 1);
              const i2 = clamp(yy + py, 0, h - 1) * w + clamp(xx + px, 0, w - 1);
              const dd = gray[i1] - gray[i2];
              d2 += dd * dd; cnt++;
            }
            const wt = Math.exp(-Math.max(0, d2 / cnt - 0) / (h2 || 1));
            const j = (yy * w + xx) * 4;
            a0 += wt * img.data[j]; a1 += wt * img.data[j + 1]; a2 += wt * img.data[j + 2];
            wsum += wt;
          }
        }
        const o = (y * w + x) * 4;
        out.data[o] = clamp(a0 / wsum, 0, 255);
        out.data[o + 1] = clamp(a1 / wsum, 0, 255);
        out.data[o + 2] = clamp(a2 / wsum, 0, 255);
      }
    }
    return out;
  };

  /* ============================================================
   * 线性域处理链（Float32 RGB，避免 8-bit 中间量化损失暗部）
   * 结构：{ d: Float32Array(w*h*3), w, h }
   * ============================================================ */
  IP.toFloat = function (img) {
    const n = img.width * img.height, f = new Float32Array(n * 3);
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      f[k] = img.data[j]; f[k + 1] = img.data[j + 1]; f[k + 2] = img.data[j + 2];
    }
    return { d: f, w: img.width, h: img.height };
  };

  /* 线性域 → 显示 ImageData：数字增益 + Gamma 编码 + 8bit 量化（最后一步才量化） */
  IP.fromFloat = function (f, gain, gamma) {
    gain = gain ?? 1; gamma = gamma ?? 2.2;
    const out = new ImageData(f.w, f.h);
    const lut = new Float32Array(1024);
    for (let v = 0; v < 1024; v++) lut[v] = clamp(255 * Math.pow(v / 1023, 1 / gamma), 0, 255);
    for (let i = 0, j = 0, k = 0; i < f.w * f.h; i++, j += 4, k += 3) {
      for (let c = 0; c < 3; c++) {
        const v = clamp(f.d[k + c] * gain, 0, 255);
        out.data[j + c] = v < 4 ? v : lut[clamp((v / 255 * 1023) | 0, 0, 1023)];
      }
      out.data[j + 3] = 255;
    }
    return out;
  };

  IP.bilateralF = function (f, radius, sigmaColor) {
    const w = f.w, h = f.h, r = radius | 0;
    const out = { d: new Float32Array(w * h * 3), w, h };
    const gray = new Float32Array(w * h);
    for (let i = 0, k = 0; i < w * h; i++, k += 3) gray[i] = 0.299 * f.d[k] + 0.587 * f.d[k + 1] + 0.114 * f.d[k + 2];
    const sc2 = 2 * sigmaColor * sigmaColor;
    const ss2 = 2 * (r / 2) * (r / 2) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = y * w + x, cg = gray[ci];
        let wr = 0, acc0 = 0, acc1 = 0, acc2 = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -r; dx <= r; dx++) {
            const xx = clamp(x + dx, 0, w - 1);
            const ni = yy * w + xx;
            const dg = gray[ni] - cg;
            const wt = Math.exp(-(dx * dx + dy * dy) / ss2 - (dg * dg) / sc2);
            const k = ni * 3;
            acc0 += wt * f.d[k]; acc1 += wt * f.d[k + 1]; acc2 += wt * f.d[k + 2];
            wr += wt;
          }
        }
        const o = (y * w + x) * 3;
        out.d[o] = acc0 / wr; out.d[o + 1] = acc1 / wr; out.d[o + 2] = acc2 / wr;
      }
    }
    return out;
  };

  IP.medianF = function (f, size) {
    const w = f.w, h = f.h, half = size >> 1;
    const out = { d: new Float32Array(w * h * 3), w, h };
    const buf = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        buf.length = 0;
        for (let dy = -half; dy <= half; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -half; dx <= half; dx++) {
            buf.push(f.d[(yy * w + clamp(x + dx, 0, w - 1)) * 3 + c]);
          }
        }
        buf.sort((a, b) => a - b);
        out.d[(y * w + x) * 3 + c] = buf[buf.length >> 1];
      }
    }
    return out;
  };

  IP.ccmF = function (f, m) {
    const out = { d: new Float32Array(f.d.length), w: f.w, h: f.h };
    for (let i = 0; i < f.d.length; i += 3) {
      const r = f.d[i], g = f.d[i + 1], b = f.d[i + 2];
      out.d[i] = m[0] * r + m[1] * g + m[2] * b;
      out.d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
      out.d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
    }
    return out;
  };

  /* ============================================================
   * 色彩与色调
   * ============================================================ */
  IP.applyCCM = function (img, m) {
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      out.data[i] = clamp(m[0] * r + m[1] * g + m[2] * b, 0, 255);
      out.data[i + 1] = clamp(m[3] * r + m[4] * g + m[5] * b, 0, 255);
      out.data[i + 2] = clamp(m[6] * r + m[7] * g + m[8] * b, 0, 255);
    }
    return out;
  };

  IP.applyGamma = function (img, gamma) {
    const out = IP.copyImageData(img);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = clamp(255 * Math.pow(v / 255, 1 / gamma), 0, 255);
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = lut[img.data[i]];
      out.data[i + 1] = lut[img.data[i + 1]];
      out.data[i + 2] = lut[img.data[i + 2]];
    }
    return out;
  };

  IP.unsharpMask = function (img, amount, radius) {
    const blurred = IP.gaussianBlurRGB(img, radius, radius / 2 || 1);
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        out.data[i + c] = clamp(img.data[i + c] + amount * (img.data[i + c] - blurred.data[i + c]), 0, 255);
      }
    }
    return out;
  };

  IP.saturationContrast = function (img, sat, contrast) {
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      let rr = gray + (r - gray) * sat, gg = gray + (g - gray) * sat, bb = gray + (b - gray) * sat;
      rr = (rr - 128) * contrast + 128; gg = (gg - 128) * contrast + 128; bb = (bb - 128) * contrast + 128;
      out.data[i] = clamp(rr, 0, 255); out.data[i + 1] = clamp(gg, 0, 255); out.data[i + 2] = clamp(bb, 0, 255);
    }
    return out;
  };

  /* ============================================================
   * 点运算 / 直方图
   * ============================================================ */
  IP.histogram = function (gray, bins) {
    bins = bins || 256;
    const hist = new Float32Array(bins);
    for (let i = 0; i < gray.length; i++) hist[clamp((gray[i] / 256 * bins) | 0, 0, bins - 1)]++;
    return hist;
  };

  IP.histEqualize = function (img) {
    const out = IP.copyImageData(img);
    const gray = IP.toGray(img);
    const hist = IP.histogram(gray);
    const cdf = new Float32Array(256);
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; cdf[v] = acc; }
    const total = gray.length;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = clamp(cdf[v] / total * 255, 0, 255);
    for (let i = 0; i < out.data.length; i += 4) {
      const g = lut[clamp(Math.round(gray[i / 4]), 0, 255)];
      const ratio = g / Math.max(1, gray[i / 4] || 1);
      out.data[i] = clamp(img.data[i] * ratio, 0, 255);
      out.data[i + 1] = clamp(img.data[i + 1] * ratio, 0, 255);
      out.data[i + 2] = clamp(img.data[i + 2] * ratio, 0, 255);
    }
    return out;
  };

  /* 简化 CLAHE：4×4 tile，clip 后双线性混合 */
  IP.clahe = function (img, clipLimit) {
    const w = img.width, h = img.height;
    const gray = IP.toGray(img);
    const TX = 4, TY = 4, tw = Math.ceil(w / TX), th = Math.ceil(h / TY);
    const maps = [];
    for (let ty = 0; ty < TY; ty++) {
      for (let tx = 0; tx < TX; tx++) {
        const hist = new Float32Array(256);
        let cnt = 0;
        for (let y = ty * th; y < Math.min(h, (ty + 1) * th); y++)
          for (let x = tx * tw; x < Math.min(w, (tx + 1) * tw); x++) { hist[clamp(gray[y * w + x] | 0, 0, 255)]++; cnt++; }
        const limit = Math.max(1, clipLimit * cnt / 256);
        let excess = 0;
        for (let v = 0; v < 256; v++) if (hist[v] > limit) { excess += hist[v] - limit; hist[v] = limit; }
        const bonus = excess / 256;
        const cdf = new Float32Array(256);
        let acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v] + bonus; cdf[v] = acc; }
        for (let v = 0; v < 256; v++) cdf[v] = cdf[v] / cnt * 255;
        maps.push(cdf);
      }
    }
    const out = IP.copyImageData(img);
    const mapAt = (tx, ty, v) => maps[clamp(ty, 0, TY - 1) * TX + clamp(tx, 0, TX - 1)][clamp(Math.round(v), 0, 255)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = x / tw - 0.5, fy = y / th - 0.5;
        const tx = clamp(Math.floor(fx), 0, TX - 2), ty = clamp(Math.floor(fy), 0, TY - 2);
        const ax = clamp(fx - tx, 0, 1), ay = clamp(fy - ty, 0, 1);
        const g0 = mapAt(tx, ty, gray[y * w + x]), g1 = mapAt(tx + 1, ty, gray[y * w + x]);
        const g2 = mapAt(tx, ty + 1, gray[y * w + x]), g3 = mapAt(tx + 1, ty + 1, gray[y * w + x]);
        const gv = (g0 * (1 - ax) + g1 * ax) * (1 - ay) + (g2 * (1 - ax) + g3 * ax) * ay;
        const ratio = gv / Math.max(1, gray[y * w + x] || 1);
        const o = (y * w + x) * 4;
        out.data[o] = clamp(img.data[o] * ratio, 0, 255);
        out.data[o + 1] = clamp(img.data[o + 1] * ratio, 0, 255);
        out.data[o + 2] = clamp(img.data[o + 2] * ratio, 0, 255);
      }
    }
    return out;
  };

  /* Otsu 二值化 */
  IP.otsu = function (img) {
    const gray = IP.toGray(img);
    const hist = IP.histogram(gray);
    const total = gray.length;
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = v; }
    }
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      const g = gray[i / 4] > thr ? 255 : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
    }
    return { result: out, threshold: thr };
  };

  /* ============================================================
   * 边缘检测
   * ============================================================ */
  IP.sobel = function (img) {
    const w = img.width, h = img.height;
    const gray = IP.toGray(img);
    const mag = new Float32Array(w * h), dir = new Float32Array(w * h);
    const at = (x, y) => gray[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
        + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * w + x;
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      dir[i] = Math.atan2(gy, gx);
    }
    return { mag, dir, w, h };
  };

  IP.laplacian = function (img) {
    const w = img.width, h = img.height, gray = IP.toGray(img);
    const out = IP.copyImageData(img);
    const at = (x, y) => gray[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      const o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = clamp(128 + v, 0, 255);
    }
    return out;
  };

  /* Canny */
  IP.canny = function (img, lowT, highT) {
    const { mag, dir, w, h } = IP.sobel(img);
    // 1) 非极大值抑制
    const nms = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let a = dir[i] * 180 / Math.PI; if (a < 0) a += 180;
      let m1, m2;
      if (a < 22.5 || a >= 157.5) { m1 = mag[i - 1]; m2 = mag[i + 1]; }
      else if (a < 67.5) { m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; }
      else if (a < 112.5) { m1 = mag[i - w]; m2 = mag[i + w]; }
      else { m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; }
      nms[i] = (mag[i] >= m1 && mag[i] >= m2) ? mag[i] : 0;
    }
    // 2) 双阈值 + 滞后连接
    const out = IP.copyImageData(img);
    const flag = new Uint8Array(w * h); // 0 无 1 强 2 弱
    for (let i = 0; i < w * h; i++) flag[i] = nms[i] >= highT ? 1 : (nms[i] >= lowT ? 2 : 0);
    const stack = [];
    for (let i = 0; i < w * h; i++) if (flag[i] === 1) stack.push(i);
    while (stack.length) {
      const i = stack.pop();
      if (flag[i] !== 1) continue;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (flag[j] === 2) { flag[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < w * h; i++) {
      const v = flag[i] === 1 ? 255 : 0;
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    }
    return out;
  };

  /* ============================================================
   * 形态学（灰度 min/max，用于二值或灰度图）
   * op: erode | dilate | open | close
   * ============================================================ */
  IP.morphology = function (img, op, size) {
    const r = (size >> 1) || 1;
    const er = (im) => {
      const w = im.width, h = im.height, out = IP.copyImageData(im);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let m = 255;
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
            m = Math.min(m, im.data[(clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4 + c]);
          out.data[(y * w + x) * 4 + c] = m;
        }
      }
      return out;
    };
    const di = (im) => {
      const w = im.width, h = im.height, out = IP.copyImageData(im);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let m = 0;
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
            m = Math.max(m, im.data[(clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4 + c]);
          out.data[(y * w + x) * 4 + c] = m;
        }
      }
      return out;
    };
    if (op === "erode") return er(img);
    if (op === "dilate") return di(img);
    if (op === "open") return di(er(img));
    return er(di(img));
  };

  /* 线性卷积（3×3 核演示用） */
  IP.convolve3 = function (img, kernel) {
    const w = img.width, h = img.height, out = IP.copyImageData(img);
    const gray = IP.toGray(img);
    const at = (x, y) => gray[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += kernel[ki++] * at(x + dx, y + dy);
      const o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = clamp(s, 0, 255);
    }
    return out;
  };

  /* 画直方图到 canvas */
  IP.drawHistogram = function (canvas, img) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width = 256, H = canvas.height = 90;
    ctx.fillStyle = "#faf8f2"; ctx.fillRect(0, 0, W, H);
    const colors = ["rgba(179,86,77,.55)", "rgba(62,124,111,.55)", "rgba(91,122,140,.55)"];
    let maxV = 1;
    // 用 R/G/B 三个通道
    const rgbs = [0, 1, 2].map(cc => {
      const hh = new Float32Array(256);
      for (let i = 0; i < img.data.length; i += 4) hh[img.data[i + cc]]++;
      return hh;
    });
    rgbs.forEach(hh => hh.forEach(v => { if (v > maxV) maxV = v; }));
    rgbs.forEach((hh, k) => {
      ctx.strokeStyle = colors[k]; ctx.beginPath();
      for (let v = 0; v < 256; v++) {
        const y = H - (hh[v] / maxV) * (H - 6) - 2;
        if (v === 0) ctx.moveTo(v, y); else ctx.lineTo(v, y);
      }
      ctx.stroke();
    });
  };

  window.IP = IP;
})();
