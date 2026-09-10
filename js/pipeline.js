/* ============================================================
 * pipeline.js — 交互式 ISP 流水线
 * 场景 → RAW 模拟 → 黑电平 → 坏点 → AWB → 去马赛克 → 降噪
 *      → CCM → Gamma → 锐化 → 色彩增强 → PSNR/SSIM 评估
 * ============================================================ */
(function () {
  "use strict";

  /* 步骤定义 */
  const STEPS = [
    { id: "raw", name: "RAW 模拟", toggle: false, desc: "从 sRGB 场景模拟传感器成像：sRGB 线性化 → 光谱串扰（CFA 非理想窄带）→ RGGB 马赛克采样 → 色温偏移 → 高斯读出噪声 → 坏点 → 镜头阴影。", params: [
      { key: "noiseSigma", label: "读出噪声 σ", min: 0, max: 24, step: 1, def: 8 },
      { key: "deadRate", label: "坏点率 %", min: 0, max: 2, step: 0.1, def: 0.3, scale: 0.01 },
      { key: "exposure", label: "曝光增益", min: 0.3, max: 2, step: 0.05, def: 1 },
      { key: "tintR", label: "色温偏移 R", min: 0.7, max: 1.5, step: 0.02, def: 1.14 },
      { key: "tintB", label: "色温偏移 B", min: 0.6, max: 1.5, step: 0.02, def: 0.82 },
      { key: "shading", label: "镜头阴影", type: "switch", def: true }
    ]},
    { id: "blc", name: "黑电平校正", def: true, desc: "传感器在零光照下仍有非零读数（暗电流 / ADC 偏置），先减去黑电平。本演示在 RAW 中混入 +48 的偏置。", params: [] },
    { id: "dpc", name: "坏点校正", def: true, desc: "真实坏点（热像素/死像素）通常钳位在 ADC 量程两端。检测处于上下溢出的像素并用 3×3 邻域中值替换。注意：若用「偏离中值即判坏点」的方式，高频纹理会被误杀——这是工程实现里常见的坑。", params: [
      { key: "tol", label: "rail 容差", min: 1, max: 10, step: 1, def: 3 }
    ]},
    { id: "lsc", name: "镜头阴影校正", def: true, desc: "镜头渐晕使画面四角变暗（RAW 模拟中注入了 1−0.25·r² 的暗角）。LSC 按标定好的增益图对四角补偿亮度，是 RAW 域的关键级——缺失它，最终成图四角会明显发暗。", params: [
      { key: "strength", label: "校正强度", min: 0, max: 1.2, step: 0.05, def: 1 }
    ]},
    { id: "rawDenoise", name: "RAW 域降噪", def: true, desc: "工程上先在插值前的单通道 RAW 上降噪（级级联在 AWB 之前），避免噪声在去马赛克时被放大并产生彩色噪点。3×3 中值对读出噪声中的脉冲分量非常有效。", params: [
      { key: "size", label: "核大小", type: "select", options: [[3, "3×3"], [5, "5×5"]], def: 3 }
    ]},
    { id: "awb", name: "自动白平衡", def: true, desc: "在 Bayer 域统计各通道能量，计算 R/B 增益以补偿光源色温（对应 RAW 模拟中的色温偏移）。灰度世界假设场景平均色为灰；动态阈值只统计中亮度像素，更稳健；完美反射体假设高光为白。", params: [
      { key: "method", label: "算法", type: "select", options: [["grayworld", "灰度世界"], ["dynamicThreshold", "动态阈值"], ["perfectReflector", "完美反射体"]], def: "dynamicThreshold" },
      { key: "strength", label: "强度", min: 0, max: 1.5, step: 0.05, def: 1 }
    ]},
    { id: "demosaic", name: "去马赛克", def: true, desc: "从单通道 Bayer 阵列恢复三通道 RGB（线性域，Float32 直通 Gamma 编码，避免中间量化）。双线性最简单但在高频区产生拉链伪影；边缘自适应版本在插值 G 通道前判断边缘方向，减少彩色摩尔纹。本级输出预览已做 Gamma 编码。", params: [
      { key: "method", label: "算法", type: "select", options: [["bilinear", "双线性"], ["edge", "边缘自适应"]], def: "edge" }
    ]},
    { id: "denoise", name: "降噪", def: true, desc: "对插值后的 RGB 降噪（工程上通常先在 RAW 域降噪，此处为演示放在插值后）。双边滤波保边；中值滤波对脉冲噪声有效。", params: [
      { key: "method", label: "算法", type: "select", options: [["bilateral", "双边滤波"], ["median", "中值滤波"]], def: "bilateral" },
      { key: "strength", label: "强度", min: 5, max: 40, step: 1, def: 16 }
    ]},
    { id: "ccm", name: "CCM 色彩校正", def: true, desc: "传感器光谱响应与 sRGB 标准不一致（见 RAW 模拟中的串扰系数），用 3×3 矩阵把相机 RGB 映射到 sRGB。本系统的 CCM 取串扰矩阵的严格逆，可在线性域精确还原颜色。", params: [
      { key: "strength", label: "强度", min: 0, max: 1.2, step: 0.05, def: 1 }
    ]},
    { id: "gamma", name: "Gamma 与曝光", def: true, desc: "传感器响应是线性的，而显示与人眼感知是非线性的。数字增益补偿曝光，Gamma(≈1/2.2) 编码到 sRGB 空间。", params: [
      { key: "gain", label: "数字增益", min: 0.5, max: 2.5, step: 0.05, def: 1 },
      { key: "gamma", label: "Gamma", min: 1.6, max: 3.0, step: 0.05, def: 2.2 }
    ]},
    { id: "sharpen", name: "锐化 (USM)", def: true, desc: "镜头低通滤镜与去马赛克都会损失高频。非锐化掩模 = 原图 + k×(原图 − 高斯模糊)，增强边缘对比。", params: [
      { key: "amount", label: "强度", min: 0, max: 2, step: 0.05, def: 0.7 },
      { key: "radius", label: "半径", min: 1, max: 5, step: 1, def: 2 }
    ]},
    { id: "color", name: "色彩增强", def: true, desc: "饱和度与对比度的最终润色，模拟手机 ISP 的风格化后处理。", params: [
      { key: "sat", label: "饱和度", min: 0, max: 2, step: 0.05, def: 1.1 },
      { key: "contrast", label: "对比度", min: 0.7, max: 1.5, step: 0.05, def: 1.05 }
    ]}
  ];

  /* CCM = RAW 模拟中光谱串扰矩阵 XT 的严格逆（行归一化保持白色） */
  const CCM = [1.243, -0.182, -0.060, -0.129, 1.206, -0.078, -0.042, -0.148, 1.189];

  const state = {
    sceneIdx: 0, scene: null,
    params: {}, enabled: {},
    results: {}, order: [], selected: "final",
    metrics: null, raw: null, gt: null
  };

  STEPS.forEach(s => {
    state.enabled[s.id] = s.def !== undefined ? s.def : (s.toggle !== false);
    state.params[s.id] = {};
    (s.params || []).forEach(p => state.params[s.id][p.key] = p.scale ? p.def * p.scale : p.def);
  });

  let viewer = null, built = false;

  function getScene() { return state.scene; }

  /* ---------- 运行流水线 ---------- */
  function run() {
    const scene = getScene();
    if (!scene) return;
    const t0 = performance.now();
    state.gt = scene;
    const sim = state.params.raw;
    // RAW 模拟（每次重新随机噪声）
    const raw = IP.simulateRAW(scene, {
      blackLevel: 48, noiseSigma: sim.noiseSigma, deadRate: sim.deadRate,
      shading: sim.shading, exposure: sim.exposure,
      tintR: sim.tintR, tintB: sim.tintB
    });
    state.raw = raw;

    // 构建执行序列
    const stages = []; // {id, input, output}
    let cur = { type: "raw", data: raw };
    stages.push({ id: "raw", input: IP.bayerToView(raw), output: IP.bayerToView(raw) });

    const pushStage = (id, inputView, outputRawOrImg, isRaw) => {
      stages.push({
        id, input: inputView,
        output: isRaw ? IP.bayerToView(outputRawOrImg) : outputRawOrImg,
        outData: outputRawOrImg, outIsRaw: isRaw
      });
    };

    const view = r => IP.bayerToView(r);

    // 黑电平
    if (state.enabled.blc) {
      const inp = view(raw);
      IP.blackLevelCorrect(raw, 48);
      pushStage("blc", inp, raw, true);
    }
    // 坏点
    if (state.enabled.dpc) {
      const inp = view(raw);
      IP.correctDeadPixels(raw, state.params.dpc.tol);
      pushStage("dpc", inp, raw, true);
    }
    // 镜头阴影校正
    if (state.enabled.lsc) {
      const inp = view(raw);
      IP.correctLSC(raw, state.params.lsc.strength);
      pushStage("lsc", inp, raw, true);
    }
    // RAW 域降噪
    if (state.enabled.rawDenoise) {
      const inp = view(raw);
      IP.medianBayer(raw, state.params.rawDenoise.size);
      pushStage("rawDenoise", inp, raw, true);
    }
    // AWB
    if (state.enabled.awb) {
      const inp = view(raw);
      const p = state.params.awb;
      const g = IP.computeAWBGains(raw, p.method, p.strength);
      IP.applyAWBGains(raw, g.gR, g.gB);
      pushStage("awb", inp, raw, true);
      stages[stages.length - 1].gains = g;
    }
    // 去马赛克（输出线性域 Float32，显示时做 Gamma 编码预览）
    let rgbF;
    {
      const inp = view(raw);
      rgbF = IP.demosaicF(raw, state.params.demosaic.method);
      pushStage("demosaic", inp, IP.fromFloat(rgbF), false);
    }
    // 降噪（线性域）
    if (state.enabled.denoise) {
      const p = state.params.denoise;
      const out = p.method === "bilateral"
        ? IP.bilateralF(rgbF, 3, p.strength)
        : IP.medianF(rgbF, 3);
      pushStage("denoise", IP.fromFloat(rgbF), IP.fromFloat(out), false);
      rgbF = out;
    }
    // CCM（线性域）
    if (state.enabled.ccm) {
      const s = state.params.ccm.strength;
      const m = CCM.map((v, i) => 1 + (v - 1) * s);
      const out = IP.ccmF(rgbF, m);
      pushStage("ccm", IP.fromFloat(rgbF), IP.fromFloat(out), false);
      rgbF = out;
    }
    // Gamma 编码（线性域 → 显示域，8bit 量化只发生在这里）
    let rgb;
    {
      const p = state.params.gamma;
      rgb = IP.fromFloat(rgbF, p.gain, p.gamma);
      pushStage("gamma", IP.fromFloat(rgbF, 1, 1), rgb, false);
    }
    // 锐化
    if (state.enabled.sharpen) {
      const p = state.params.sharpen;
      const out = IP.unsharpMask(rgb, p.amount, p.radius);
      pushStage("sharpen", rgb, out, false);
      rgb = out;
    }
    // 色彩增强
    if (state.enabled.color) {
      const p = state.params.color;
      const out = IP.saturationContrast(rgb, p.sat, p.contrast);
      pushStage("color", rgb, out, false);
      rgb = out;
    }

    const dt = performance.now() - t0;
    state.results = {};
    stages.forEach(s => state.results[s.id] = s);
    state.order = stages.map(s => s.id);
    state.finalImg = rgb;

    // 指标
    const psnr = IP.psnr(rgb, scene);
    const ssim = IP.ssim(rgb, scene);
    state.metrics = { psnr, ssim, ms: dt };

    renderChips();
    renderMetrics();
    select(state.selected === "final" || state.order.includes(state.selected) ? state.selected : "final");
  }

  /* ---------- UI ---------- */
  function renderChips() {
    const strip = document.getElementById("pipe-chips");
    strip.innerHTML = "";
    const mk = (id, label, on, active) => {
      const c = document.createElement("div");
      c.className = "chip" + (on ? "" : " off") + (active ? " active" : "");
      c.innerHTML = (id === "final" ? `<span class="dot"></span>` : `<span class="idx">${id}</span>`) + label;
      c.addEventListener("click", () => select(id));
      strip.appendChild(c);
    };
    state.order.forEach((id, i) => {
      const s = STEPS.find(x => x.id === id);
      mk(String(i + 1).padStart(2, "0"), s.name, state.enabled[id], state.selected === id);
    });
    mk("✓", "最终结果", true, state.selected === "final");
  }

  function select(id) {
    state.selected = id;
    renderChips();
    const viewerBox = document.getElementById("pipe-viewer");
    const info = document.getElementById("pipe-stage-info");
    if (id === "final") {
      viewer.setLabels("参考图 (Ground Truth)", "流水线输出");
      viewer.setBefore(state.gt);
      viewer.setAfter(state.finalImg);
      info.innerHTML = `<b>最终结果</b> — 与参考图的实时指标见下方（若所有模块开启，理论上越接近参考图越好）。`;
    } else {
      const s = STEPS.find(x => x.id === id);
      const r = state.results[id];
      if (!r) return;
      viewer.setLabels("该级输入", "该级输出");
      viewer.setBefore(r.input);
      viewer.setAfter(r.output);
      let extra = "";
      if (id === "awb" && r.gains) extra = ` 增益：R ×${r.gains.gR.toFixed(2)}，B ×${r.gains.gB.toFixed(2)}。`;
      info.innerHTML = `<b>${s.name}</b> — ${s.desc}${extra}`;
    }
    renderControl(id);
  }

  function renderControl(id) {
    const box = document.getElementById("pipe-controls");
    box.innerHTML = "";
    if (id === "final") { box.innerHTML = `<div class="note">点击上方任一级流水线节点可查看 / 调节该级参数；修改后点「运行流水线」重新计算。噪声与坏点每次运行都会重新随机。</div>`; return; }
    const s = STEPS.find(x => x.id === id);
    const card = document.createElement("div");
    card.className = "card";
    if (s.toggle !== false) {
      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = state.enabled[id];
      cb.addEventListener("change", () => { state.enabled[id] = cb.checked; });
      sw.appendChild(cb);
      sw.appendChild(document.createTextNode(" 启用本级"));
      card.appendChild(sw);
    }
    (s.params || []).forEach(p => {
      const row = document.createElement("div");
      row.className = "ctl-row";
      if (p.type === "select") {
        const lab = document.createElement("label"); lab.textContent = p.label;
        const sel = document.createElement("select");
        p.options.forEach(([v, t]) => {
          const o = document.createElement("option"); o.value = v; o.textContent = t;
          if (state.params[id][p.key] === v) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => { state.params[id][p.key] = sel.value; });
        row.appendChild(lab); row.appendChild(sel);
      } else if (p.type === "switch") {
        row.innerHTML = "";
        const lab = document.createElement("label"); lab.textContent = p.label;
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!state.params[id][p.key];
        cb.addEventListener("change", () => { state.params[id][p.key] = cb.checked; });
        row.appendChild(cb); row.appendChild(lab);
      } else {
        const lab = document.createElement("label"); lab.textContent = p.label;
        const rng = document.createElement("input");
        rng.type = "range"; rng.min = p.min; rng.max = p.max; rng.step = p.step;
        const scale = p.scale || 1;
        rng.value = state.params[id][p.key] / scale;
        const val = document.createElement("span");
        val.className = "val";
        val.textContent = fmt(state.params[id][p.key]);
        rng.addEventListener("input", () => {
          state.params[id][p.key] = rng.value * scale;
          val.textContent = fmt(rng.value * scale);
        });
        row.appendChild(lab); row.appendChild(rng); row.appendChild(val);
      }
      card.appendChild(row);
    });
    const tip = document.createElement("div");
    tip.className = "note"; tip.style.marginBottom = "0";
    tip.innerHTML = s.desc;
    card.appendChild(tip);
    box.appendChild(card);
  }

  function fmt(v) { return (Math.round(v * 100) / 100).toString(); }

  function renderMetrics() {
    const box = document.getElementById("pipe-metrics");
    const m = state.metrics;
    box.innerHTML = `
      <div class="metric"><b>${m.psnr === Infinity ? "∞" : m.psnr.toFixed(2)}</b><span>PSNR (dB) vs 参考图</span></div>
      <div class="metric"><b>${m.ssim.toFixed(4)}</b><span>SSIM vs 参考图</span></div>
      <div class="metric"><b>${(m.ms / 1000).toFixed(2)}s</b><span>流水线耗时 (JS 实时)</span></div>
      <div class="metric"><b>${state.order.length}</b><span>启用级数</span></div>
      <div style="flex-basis:100%" class="note">说明：指标相对「场景参考图」计算。开启自动白平衡、色彩增强等会主动改变色调风格的模块后指标下降是<b>预期行为</b>——真实 ISP 在「忠实还原」与「观感好看」之间取舍；关闭噪声/坏点/色温偏移并关掉风格化模块，可看到指标显著上升。</div>`;
  }

  function setScene(idx, _btn, uploaded) {
    if (uploaded) { state.scene = uploaded; }
    else { state.sceneIdx = idx; state.scene = U.SCENES[idx].fn(); }
    run();
  }

  function download() {
    if (!state.finalImg) return;
    const c = IP.makeCanvas(state.finalImg.width, state.finalImg.height);
    IP.putImageData(c, state.finalImg);
    const a = document.createElement("a");
    a.download = "ispatlas-output.png";
    a.href = c.toDataURL("image/png");
    a.click();
  }

  window.PipePage = {
    init() {
      if (built) return;
      built = true;
      viewer = U.compareViewer(document.getElementById("pipe-viewer"), { leftLabel: "参考图", rightLabel: "流水线输出" });
      U.scenePicker(document.getElementById("pipe-scene"), state.sceneIdx, setScene);
      document.getElementById("pipe-run").addEventListener("click", run);
      document.getElementById("pipe-download").addEventListener("click", download);
      // 总览流程链
      ArchViz.horizontal(document.getElementById("pipe-flow"), {
        blocks: STEPS.map(s => ({
          label: s.name,
          sub: s.id === "raw" ? "传感器" : "模块",
          tone: s.id === "raw" ? "data" : "conv",
          onClick: () => select(s.id)
        }))
      });
      setScene(0);
    },
    gotoStage(id) { select(id); }
  };
})();
