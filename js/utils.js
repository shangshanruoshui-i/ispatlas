/* ============================================================
 * utils.js — 场景生成、对比滑块、通用 UI 工具
 * ============================================================ */
(function () {
  "use strict";
  const U = {};

  /* ---------- 程序化生成测试场景（512×384） ---------- */
  const W = 512, H = 384;

  function newScene() {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    return c;
  }

  /* 场景 A：色彩测试卡 + 几何图形（检验色彩/去马赛克） */
  U.sceneColorChart = function () {
    const c = newScene(), ctx = c.getContext("2d");
    ctx.fillStyle = "#ece5d8"; ctx.fillRect(0, 0, W, H);
    // 24 色卡
    const cols = [
      "#7d5a3c", "#a56a2e", "#c7a23a", "#b8b86e", "#7fa66a", "#3f7a5e",
      "#4a7d8c", "#3a5a8c", "#5a4a8c", "#8c4a7d", "#a63a4a", "#c96a4a",
      "#e0d5c0", "#d9c9a8", "#b5a888", "#8a8a7a", "#5d6e6a", "#3d4a55",
      "#f2ede2", "#e8dcc4", "#cfc0a0", "#a89a80", "#7d7568", "#4d4a44"
    ];
    const cw = W / 8, chh = H / 3;
    cols.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect((i % 8) * cw + 2, Math.floor(i / 8) * chh + 2, cw - 4, chh - 4);
    });
    // 细线条（检验锐化与摩尔纹）
    ctx.fillStyle = "#333";
    for (let x = 20; x < W - 20; x += 6) ctx.fillRect(x, chh * 2 + 30, 2, 60);
    ctx.fillStyle = "#333";
    for (let y = chh * 2 + 30; y < chh * 2 + 90; y += 6) ctx.fillRect(W - 140, y, 60, 2);
    // 圆
    const grad = ctx.createRadialGradient(430, 120, 5, 430, 120, 60);
    grad.addColorStop(0, "#e8734d"); grad.addColorStop(1, "#8c3a2e");
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(430, 120, 60, 0, 7); ctx.fill();
    ctx.fillStyle = "#2b4a6e"; ctx.font = "bold 34px Georgia";
    ctx.fillText("ISP", 300, chh * 2 + 120);
    return getImage(c);
  };

  /* 场景 B：合成风景（天空渐变 / 山 / 湖面倒影，检验白平衡与色调） */
  U.sceneLandscape = function () {
    const c = newScene(), ctx = c.getContext("2d");
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, "#f4d9a8"); sky.addColorStop(0.6, "#e8a877"); sky.addColorStop(1, "#c97a5e");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.55);
    // 太阳
    const sun = ctx.createRadialGradient(380, 120, 8, 380, 120, 70);
    sun.addColorStop(0, "#fff3d6"); sun.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = sun; ctx.fillRect(280, 20, 220, 200);
    // 远山
    ctx.fillStyle = "#7a6a7d";
    ctx.beginPath(); ctx.moveTo(0, H * 0.5);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * 0.5 - 40 * Math.sin(x / 90) - 25 * Math.sin(x / 33 + 2));
    ctx.lineTo(W, H * 0.55); ctx.lineTo(0, H * 0.55); ctx.fill();
    // 近山
    ctx.fillStyle = "#4d4a55";
    ctx.beginPath(); ctx.moveTo(0, H * 0.55);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * 0.55 - 55 * Math.sin(x / 60 + 4) - 18 * Math.sin(x / 21));
    ctx.lineTo(W, H * 0.62); ctx.lineTo(0, H * 0.62); ctx.fill();
    // 湖面
    const lake = ctx.createLinearGradient(0, H * 0.62, 0, H);
    lake.addColorStop(0, "#5a7a8c"); lake.addColorStop(1, "#3d5a6e");
    ctx.fillStyle = lake; ctx.fillRect(0, H * 0.62, W, H * 0.38);
    // 倒影波纹
    ctx.strokeStyle = "rgba(240,220,190,.35)";
    for (let y = H * 0.64; y < H; y += 9) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const yy = y + 2.2 * Math.sin(x / 26 + y);
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    return getImage(c);
  };

  /* 场景 C：细节纹理（棋盘 / 放射条纹 / 文字，检验插值与锐化伪影） */
  U.sceneTexture = function () {
    const c = newScene(), ctx = c.getContext("2d");
    ctx.fillStyle = "#f0ece2"; ctx.fillRect(0, 0, W, H);
    // 棋盘
    const s = 12;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#d8d2c2" : "#6a655a";
      ctx.fillRect(20 + x * s, 20 + y * s, s, s);
    }
    // 放射条纹
    ctx.save(); ctx.translate(390, 100);
    for (let a = 0; a < 24; a++) {
      ctx.fillStyle = a % 2 ? "#2e3a44" : "#e8e2d4";
      ctx.beginPath(); ctx.moveTo(0, 0);
      const a1 = a / 24 * Math.PI * 2, a2 = (a + 0.5) / 24 * Math.PI * 2;
      ctx.arc(0, 0, 82, a1, a2); ctx.fill();
    }
    ctx.restore();
    // 渐变条纹（频率递增）
    for (let x = 0; x < 300; x++) {
      const freq = 2 + x / 8;
      const v = 128 + 90 * Math.sin(x * freq / 40);
      ctx.fillStyle = `rgb(${v | 0},${(v * 0.9) | 0},${(v * 0.75) | 0})`;
      ctx.fillRect(20 + x, 160, 1, 70);
    }
    ctx.fillStyle = "#3a4a5a"; ctx.font = "26px Georgia";
    ctx.fillText("Fine Texture 0123", 24, 265);
    ctx.fillStyle = "#8c5a4a"; ctx.font = "italic 20px Georgia";
    ctx.fillText("Zipper & moiré test", 24, 295);
    // 星点
    ctx.fillStyle = "#33302a";
    for (let k = 0; k < 40; k++) {
      const x = 340 + Math.random() * 150, y = 220 + Math.random() * 130;
      ctx.fillRect(x, y, 2, 2);
    }
    return getImage(c);
  };

  function getImage(canvas) {
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  U.SCENES = [
    { name: "色彩测试卡", fn: U.sceneColorChart },
    { name: "合成风景", fn: U.sceneLandscape },
    { name: "细节纹理", fn: U.sceneTexture }
  ];

  /* ---------- 对比滑块查看器 ---------- */
  /* container: 容器; 返回 {setBefore, setAfter, onChange} */
  U.compareViewer = function (container, options) {
    options = options || {};
    const wrap = document.createElement("div");
    wrap.className = "viewer-wrap";
    wrap.style.position = "relative";
    const base = document.createElement("canvas");
    const top = document.createElement("canvas");
    const topWrap = document.createElement("div");
    topWrap.className = "compare-top";
    topWrap.appendChild(top);
    const handle = document.createElement("div");
    handle.className = "compare-handle";
    const tagL = document.createElement("div"); tagL.className = "viewer-tags left"; tagL.textContent = options.leftLabel || "处理前";
    const tagR = document.createElement("div"); tagR.className = "viewer-tags right"; tagR.textContent = options.rightLabel || "处理后";
    wrap.appendChild(base); wrap.appendChild(topWrap); wrap.appendChild(handle);
    wrap.appendChild(tagL); wrap.appendChild(tagR);
    container.appendChild(wrap);

    let pct = options.initPct ?? 0.5;
    function layout() {
      const w = base.width || 1;
      // 上层（处理后）显示在右侧，与标签「左=前 右=后」一致
      topWrap.style.clipPath = `inset(0 0 0 ${pct * 100}%)`;
      handle.style.left = (pct * 100) + "%";
    }
    function setPos(clientX) {
      const rect = wrap.getBoundingClientRect();
      pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      layout();
      options.onChange && options.onChange(pct);
    }
    let dragging = false;
    wrap.addEventListener("pointerdown", e => { dragging = true; setPos(e.clientX); });
    window.addEventListener("pointermove", e => { if (dragging) setPos(e.clientX); });
    window.addEventListener("pointerup", () => { dragging = false; });
    layout();

    return {
      setBefore(imgData) { IP.putImageData(base, imgData); layout(); },
      setAfter(imgData) { IP.putImageData(top, imgData); layout(); },
      setLabels(l, r) { tagL.textContent = l; tagR.textContent = r; }
    };
  };

  /* ---------- 场景选择条 ---------- */
  U.scenePicker = function (container, current, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
    const btns = [];
    U.SCENES.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "btn small" + (i === current ? "" : " ghost");
      b.textContent = s.name;
      b.addEventListener("click", () => {
        btns.forEach((x, k) => x.className = "btn small" + (k === i ? "" : " ghost"));
        onChange(i, b);
      });
      btns.push(b);
      wrap.appendChild(b);
    });
    // 上传
    const up = document.createElement("label");
    up.className = "btn small ghost";
    up.style.cursor = "pointer";
    up.textContent = "上传图片";
    const file = document.createElement("input");
    file.type = "file"; file.accept = "image/*"; file.style.display = "none";
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        btns.forEach(x => x.className = "btn small ghost");
        up.className = "btn small";
        onChange(-1, null, c.getContext("2d").getImageData(0, 0, c.width, c.height));
      };
      img.src = URL.createObjectURL(f);
    });
    up.appendChild(file);
    wrap.appendChild(up);
    container.appendChild(wrap);
    return wrap;
  };

  U.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  window.U = U;
})();
