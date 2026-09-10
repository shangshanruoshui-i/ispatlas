/* ============================================================
 * ai.js — 深度学习图鉴页
 * 每个领域配「传统算法近似效果示意」：
 *   输入退化 → 内置传统算法处理（模拟期望效果，非模型真实输出）
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 退化/恢复示意 ---------- */
  function darken(img, k, noise) {
    const out = IP.copyImageData(img);
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = IP.clamp(out.data[i] * k + (noise ? (Math.random() - 0.5) * noise : 0), 0, 255);
      out.data[i + 1] = IP.clamp(out.data[i + 1] * k + (noise ? (Math.random() - 0.5) * noise : 0), 0, 255);
      out.data[i + 2] = IP.clamp(out.data[i + 2] * k + (noise ? (Math.random() - 0.5) * noise : 0), 0, 255);
    }
    return out;
  }
  function brightenGamma(img, gain, gamma) {
    let o = IP.copyImageData(img);
    for (let i = 0; i < o.data.length; i += 4) {
      o.data[i] = IP.clamp(o.data[i] * gain, 0, 255);
      o.data[i + 1] = IP.clamp(o.data[i + 1] * gain, 0, 255);
      o.data[i + 2] = IP.clamp(o.data[i + 2] * gain, 0, 255);
    }
    return IP.applyGamma(o, gamma);
  }
  function upscale(img, w, h) {
    const c1 = IP.makeCanvas(img.width, img.height);
    IP.putImageData(c1, img);
    const c2 = IP.makeCanvas(w, h);
    const ctx = c2.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c1, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  const SCHEMS = {
    lowlight(s) {
      const inp = darken(s, 0.2, 14);
      const out = IP.bilateralFilter(brightenGamma(inp, 4.6, 2.2), 3, 22);
      return { inp, out, cap: "输入：×0.2 照度 + 噪声 ｜ 期望：提亮 + 保边降噪（示意：数字增益 + Gamma + 双边滤波）" };
    },
    denoise(s) {
      const inp = IP.addGaussianNoise(s, 26);
      const out = IP.bilateralFilter(inp, 3, 28);
      return { inp, out, cap: "输入：σ=26 高斯噪声 ｜ 期望：去噪保边（示意：双边滤波）" };
    },
    demosaic(s) {
      const raw = IP.simulateRAW(s, { blackLevel: 48, noiseSigma: 6, deadRate: 0.001, shading: false, exposure: 1 });
      const inp = IP.bayerToView(raw);
      const out = IP.applyGamma(IP.demosaic(raw, "edge"), 2.2);
      return { inp, out, cap: "输入：含噪 Bayer 马赛克 ｜ 期望：插值恢复三通道 + 校正（示意：边缘自适应插值 + Gamma）" };
    },
    allinone(s) {
      const inp = IP.addGaussianNoise(IP.gaussianBlurRGB(darken(s, 0.75, 0), 2, 2), 14);
      const out = IP.saturationContrast(IP.clahe(IP.bilateralFilter(inp, 3, 24), 3), 1.05, 1.0);
      return { inp, out, cap: "输入：模糊 + 噪声 + 偏暗混合退化 ｜ 期望：单模型自适应修复（示意：双边 + CLAHE 组合）" };
    },
    sr(s) {
      const small = IP.resize(s, 128);
      const inp = upscale(small, s.width, s.height);
      const out = IP.unsharpMask(inp, 1.0, 2);
      return { inp, out, cap: "输入：×4 下采样后放大（细节丢失）｜ 期望：重建高频纹理（示意：上采样 + USM 锐化）" };
    },
    deblur(s) {
      const inp = IP.gaussianBlurRGB(s, 4, 3);
      const out = IP.unsharpMask(inp, 1.4, 4);
      return { inp, out, cap: "输入：模拟运动/失焦模糊 ｜ 期望：恢复清晰边缘（示意：USM 反卷积近似）" };
    },
    e2e(s) {
      const raw = IP.simulateRAW(s, { blackLevel: 48, noiseSigma: 10, deadRate: 0.002, shading: true, exposure: 0.8 });
      const inp = IP.bayerToView(raw);
      let out = IP.demosaic(raw, "edge");
      out = IP.bilateralFilter(out, 3, 18);
      out = IP.applyGamma(out, 2.2);
      out = IP.unsharpMask(out, 0.6, 2);
      return { inp, out, cap: "输入：完整模拟 RAW（噪声/坏点/阴影）｜ 期望：一步渲染成图（示意：本系统流水线的压缩版）" };
    },
    "lowlight-srgb"(s) {
      const inp = darken(s, 0.3, 6);
      const out = IP.clahe(brightenGamma(inp, 3.2, 2.2), 3);
      return { inp, out, cap: "输入：暗光 sRGB ｜ 期望：自适应提亮（示意：Gamma + CLAHE）" };
    }
  };

  let built = false;

  function render() {
    const root = document.getElementById("ai-content");
    root.innerHTML = "";

    AIDATA.categories.forEach(cat => {
      const sec = document.createElement("div");
      sec.className = "ai-cat";
      sec.innerHTML = `<h3>${U.esc(cat.name)}</h3><p class="cat-sub">${U.esc(cat.sub)}</p>`;
      root.appendChild(sec);

      // 领域示意
      if (SCHEMS[cat.schem]) {
        const box = document.createElement("div");
        box.className = "card";
        box.style.marginBottom = "18px";
        const row = document.createElement("div");
        row.className = "schem-row";
        const c1 = document.createElement("canvas"); c1.style.width = "300px";
        const c2 = document.createElement("canvas"); c2.style.width = "300px";
        const ar = document.createElement("div"); ar.className = "schem-arrow"; ar.textContent = "⟶";
        row.appendChild(c1); row.appendChild(ar); row.appendChild(c2);
        box.appendChild(row);
        sec.appendChild(box);
        // 惰性计算示意
        const fill = () => {
          const s = U.SCENES[0].fn(); // 色彩测试卡最能暴露伪影
          const { inp, out, cap } = SCHEMS[cat.schem](s);
          IP.putImageData(c1, inp); IP.putImageData(c2, out);
          row.insertAdjacentHTML("beforeend", `<div class="schem-cap">${U.esc(cap)}</div>`);
        };
        (window.requestIdleCallback ? requestIdleCallback(fill) : setTimeout(fill, 30));
      }

      cat.models.forEach(m => {
        const card = document.createElement("div");
        card.className = "card model-card";
        card.innerHTML = `<div class="mc-head"><h4>${U.esc(m.name)}<span class="year">${U.esc(m.year)}</span></h4><span class="mc-tag">${U.esc(m.tag)}</span></div>`;

        const grid = document.createElement("div");
        grid.className = "mc-grid";

        // 左：结构图
        if (m.arch) {
          const archBox = document.createElement("div");
          archBox.className = "arch-box";
          grid.appendChild(archBox);
          if (m.arch.mode === "h") ArchViz.horizontal(archBox, m.arch);
          else ArchViz.vertical(archBox, m.arch);
          const cap = document.createElement("div");
          cap.className = "arch-cap";
          cap.textContent = "模型结构示意（自绘）";
          archBox.appendChild(cap);
        }

        // 右：解释 + 规格 + 指标 + 仓库
        const right = document.createElement("div");
        const ul = document.createElement("ul");
        ul.className = "explain-list";
        m.explain.forEach(e => ul.insertAdjacentHTML("beforeend", `<li>${U.esc(e)}</li>`));
        right.appendChild(ul);

        if (m.specs && m.specs.length) {
          const sg = document.createElement("div");
          sg.className = "spec-grid";
          m.specs.forEach(s => sg.insertAdjacentHTML("beforeend", `<span class="spec-pill"><b>${U.esc(s.k)}</b>：${U.esc(s.v)}</span>`));
          right.appendChild(sg);
        }

        if (m.metrics && m.metrics.length) {
          const tb = document.createElement("table");
          tb.className = "metrics";
          tb.innerHTML = `<tr><th>指标（论文自报，供参考）</th><th>数值</th></tr>`;
          m.metrics.forEach(x => tb.insertAdjacentHTML("beforeend", `<tr><td>${U.esc(x.k)}</td><td><b>${U.esc(x.v)}</b></td></tr>`));
          right.appendChild(tb);
        }

        if (m.repos && m.repos.length) {
          const rl = document.createElement("div");
          rl.className = "repo-links";
          m.repos.forEach(r => rl.insertAdjacentHTML("beforeend", `<a href="${r.url}" target="_blank" rel="noopener">GitHub · ${U.esc(r.name)}</a>`));
          right.appendChild(rl);
        }

        if (m.resume) {
          right.insertAdjacentHTML("beforeend", `<div class="resume-note">简历提示：${U.esc(m.resume)}</div>`);
        }

        grid.appendChild(right);
        card.appendChild(grid);
        sec.appendChild(card);
      });
    });
  }

  window.AiPage = {
    init() {
      if (built) return;
      built = true;
      render();
    }
  };
})();
