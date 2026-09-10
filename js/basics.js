/* ============================================================
 * basics.js — 基础图像处理算法交互 Demo（12 个）
 * ============================================================ */
(function () {
  "use strict";

  const DEMOS = [
    {
      title: "灰度化与通道分离", badge: "点运算",
      desc: "人眼对绿色最敏感，因此亮度用加权平均（Rec.601：0.299R + 0.587G + 0.114B）而非简单平均。ISP 中大量算法在 Y 通道上进行。",
      params: [],
      run(scene) {
        const out = IP.copyImageData(scene);
        for (let i = 0; i < out.data.length; i += 4) {
          const g = 0.299 * scene.data[i] + 0.587 * scene.data[i + 1] + 0.114 * scene.data[i + 2];
          out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
        }
        return out;
      }
    },
    {
      title: "直方图均衡", badge: "增强",
      desc: "把累积分布函数拉成线性，重新映射像素值，让灰度分布均匀化。对曝光不足的图像效果显著，但可能过度增强噪声。",
      params: [],
      run(scene) { return IP.histEqualize(scene); }
    },
    {
      title: "CLAHE 自适应直方图均衡", badge: "增强",
      desc: "把图像分块（tile）各自均衡，并对直方图裁剪限幅后把多余像素均摊回去，再块间双线性插值消除块边界。相比全局均衡能增强局部对比且不放大噪声——医疗内窥镜、手机夜景都在用。",
      params: [
        { key: "clip", label: "裁剪限幅", min: 1, max: 8, step: 0.5, def: 3 }
      ],
      run(scene, p) { return IP.clahe(scene, p.clip); }
    },
    {
      title: "高斯模糊", badge: "线性滤波",
      desc: "可分离二维高斯核卷积，频率上等价于低通滤波。是 Canny 边缘、USM 锐化、多尺度金字塔的基元。半径越大图像越「虚」，细节（高频）被抑制。",
      params: [
        { key: "r", label: "半径", min: 1, max: 8, step: 1, def: 3 }
      ],
      run(scene, p) { return IP.gaussianBlurRGB(scene, p.r, p.r); }
    },
    {
      title: "中值滤波", badge: "非线性滤波",
      desc: "取邻域灰度的中位数。对「椒盐」脉冲噪声几乎是完美解（中位数天然抵抗离群值），而高斯模糊会被脉冲点拖出大晕斑。代价是对高斯噪声效果一般。",
      params: [
        { key: "size", label: "核大小", type: "select", options: [[3, "3×3"], [5, "5×5"]], def: 3 }
      ],
      run(scene, p) { return IP.medianFilter(scene, p.size); }
    },
    {
      title: "双边滤波", badge: "非线性滤波",
      desc: "在高斯空间权重之上再加「值域权重」：灰度差越大权重越小。于是平坦区被平滑、边缘被保住——ISP 降噪、美颜磨皮的核心基元之一。",
      params: [
        { key: "sc", label: "值域 σ", min: 5, max: 60, step: 2, def: 25 }
      ],
      run(scene, p) { return IP.bilateralFilter(scene, 4, p.sc); }
    },
    {
      title: "非局部均值 NLM", badge: "非线性滤波",
      desc: "以图像块（而非单像素）的相似度作为权重，在搜索窗内加权平均「长得像」的块。经典的 BM3D 可视为其 + 变换域协作滤波的升级版。",
      params: [
        { key: "h", label: "强度 h", min: 5, max: 40, step: 2, def: 16 }
      ],
      run(scene, p) { return IP.nlmDenoise(IP.resize(scene, 256), p.h); },
      note: "为保交互流畅，NLM 在 256px 缩略图上计算"
    },
    {
      title: "Sobel / Laplacian 梯度", badge: "边缘",
      desc: "Sobel 是带平滑的一阶差分，输出梯度幅值与方向；Laplacian 是二阶差分，对噪声更敏感但定位更尖锐。梯度是边缘检测、对焦评分、锐化的共同基础。",
      params: [
        { key: "op", label: "算子", type: "select", options: [["sobel", "Sobel 幅值"], ["lap", "Laplacian"]], def: "sobel" }
      ],
      run(scene, p) {
        if (p.op === "sobel") {
          const { mag, w, h } = IP.sobel(scene);
          const out = new ImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            const v = IP.clamp(mag[i], 0, 255);
            out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
            out.data[i * 4 + 3] = 255;
          }
          return out;
        }
        return IP.laplacian(scene);
      }
    },
    {
      title: "Canny 边缘检测", badge: "边缘",
      desc: "四步流水线：高斯平滑 → Sobel 求梯度 → 非极大值抑制（把粗边细化成单像素）→ 双阈值 + 滞后连接。至今仍是边缘检测的工业基准。",
      params: [
        { key: "low", label: "低阈值", min: 5, max: 80, step: 2, def: 20 },
        { key: "high", label: "高阈值", min: 20, max: 200, step: 5, def: 60 }
      ],
      run(scene, p) { return IP.canny(scene, p.low, p.high); }
    },
    {
      title: "Otsu 自动二值化", badge: "分割",
      desc: "遍历阈值 t，最大化前景/背景的类间方差，自动找到最优分割点。文档扫描、工业缺陷检测的常用第一步。",
      params: [],
      run(scene) {
        const { result, threshold } = IP.otsu(scene);
        result._note = `自动阈值 t = ${threshold}`;
        return result;
      }
    },
    {
      title: "形态学操作", badge: "形态学",
      desc: "腐蚀取邻域最小值、膨胀取最大值；开运算（先腐蚀后膨胀）去小白点，闭运算（先膨胀后腐蚀）补小黑洞。对二值图是形状清理工具，对灰度图是极值滤波。",
      params: [
        { key: "op", label: "操作", type: "select", options: [["erode", "腐蚀"], ["dilate", "膨胀"], ["open", "开运算"], ["close", "闭运算"]], def: "open" },
        { key: "size", label: "核大小", type: "select", options: [[3, "3×3"], [5, "5×5"], [7, "7×7"]], def: 5 }
      ],
      run(scene, p) {
        const bin = IP.otsu(scene).result;
        return IP.morphology(bin, p.op, p.size);
      }
    },
    {
      title: "噪声模型与实时评估", badge: "评估",
      desc: "给原图加高斯噪声，再显示 PSNR / SSIM 的实时变化。PSNR 由 MSE 决定，SSIM 从亮度/对比度/结构三方面逼近人眼感知——这两个数字就是深度学习论文里的「分数」。",
      params: [
        { key: "sigma", label: "噪声 σ", min: 0, max: 50, step: 2, def: 20 }
      ],
      run(scene, p) {
        const noisy = IP.addGaussianNoise(scene, p.sigma);
        const psnr = IP.psnr(noisy, scene), ssim = IP.ssim(noisy, scene);
        noisy._note = `PSNR = ${psnr.toFixed(2)} dB，SSIM = ${ssim.toFixed(4)}`;
        return noisy;
      }
    }
  ];

  let built = false, sceneIdx = 0, sceneData = null;

  function renderAll() {
    const grid = document.getElementById("basics-grid");
    grid.innerHTML = "";
    DEMOS.forEach(d => {
      const card = document.createElement("div");
      card.className = "card demo-card";
      card.innerHTML = `<h3>${U.esc(d.title)}<span class="badge">${d.badge}</span></h3><p class="desc">${d.desc}</p>`;
      // 参数
      const ctrlBox = document.createElement("div");
      d.params.forEach(p => {
        const row = document.createElement("div");
        row.className = "ctl-row";
        if (p.type === "select") {
          const lab = document.createElement("label"); lab.textContent = p.label;
          const sel = document.createElement("select");
          p.options.forEach(([v, t]) => {
            const o = document.createElement("option");
            o.value = v; o.textContent = t;
            if (p.def === v) o.selected = true;
            sel.appendChild(o);
          });
          sel.dataset.key = p.key;
          row.appendChild(lab); row.appendChild(sel);
        } else {
          const lab = document.createElement("label"); lab.textContent = p.label;
          const rng = document.createElement("input");
          rng.type = "range"; rng.min = p.min; rng.max = p.max; rng.step = p.step; rng.value = p.def;
          rng.dataset.key = p.key;
          const val = document.createElement("span"); val.className = "val"; val.textContent = p.def;
          rng.addEventListener("input", () => { val.textContent = rng.value; });
          row.appendChild(lab); row.appendChild(rng); row.appendChild(val);
        }
        ctrlBox.appendChild(row);
      });
      card.appendChild(ctrlBox);
      // 图
      const imgs = document.createElement("div");
      imgs.className = "demo-imgs";
      const f1 = document.createElement("figure");
      const c1 = document.createElement("canvas"); c1.style.width = "220px";
      f1.appendChild(c1);
      f1.insertAdjacentHTML("beforeend", "<figcaption>原图</figcaption>");
      const f2 = document.createElement("figure");
      const c2 = document.createElement("canvas"); c2.style.width = "220px";
      f2.appendChild(c2);
      const cap = document.createElement("figcaption"); cap.textContent = "结果";
      f2.appendChild(cap);
      imgs.appendChild(f1); imgs.appendChild(f2);
      card.appendChild(imgs);
      if (d.note) card.insertAdjacentHTML("beforeend", `<div class="note" style="margin-bottom:0">${d.note}</div>`);
      grid.appendChild(card);

      const getParams = () => {
        const p = {};
        ctrlBox.querySelectorAll("select").forEach(s => p[s.dataset.key] = isNaN(+s.value) ? s.value : +s.value);
        ctrlBox.querySelectorAll("input[type=range]").forEach(s => p[s.dataset.key] = +s.value);
        return p;
      };
      const update = () => {
        const p = getParams();
        const res = d.run(sceneData, p);
        IP.putImageData(c1, sceneData);
        IP.putImageData(c2, res);
        cap.textContent = res._note || "结果";
      };
      ctrlBox.addEventListener("input", () => { window.requestIdleCallback ? requestIdleCallback(update) : setTimeout(update, 0); });
      ctrlBox.addEventListener("change", update);
      d._update = update;
    });
  }

  function setScene(idx, _btn, uploaded) {
    sceneData = uploaded || U.SCENES[idx].fn();
    DEMOS.forEach(d => d._update && d._update());
  }

  window.BasicsPage = {
    init() {
      if (built) return;
      built = true;
      renderAll();
      U.scenePicker(document.getElementById("basics-scene"), 0, (i, _b, up) => {
        if (!up) sceneIdx = i;
        setScene(i, null, up);
      });
      setScene(0);
    }
  };
})();
