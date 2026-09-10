/* ============================================================
 * main.js — 导航路由与页面惰性初始化
 * ============================================================ */
(function () {
  "use strict";

  const PAGES = {
    overview: { el: "page-overview", init: null },
    pipeline: { el: "page-pipeline", init: () => window.PipePage.init() },
    basics: { el: "page-basics", init: () => window.BasicsPage.init() },
    ai: { el: "page-ai", init: () => window.AiPage.init() },
    resume: { el: "page-resume", init: null }
  };

  const inited = { overview: true, resume: true };
  let current = "overview";

  function show(page) {
    if (!PAGES[page]) page = "overview";
    current = page;
    document.querySelectorAll(".page").forEach(p => p.classList.remove("visible"));
    document.getElementById(PAGES[page].el).classList.add("visible");
    document.querySelectorAll("#main-nav a").forEach(a => {
      a.classList.toggle("active", a.dataset.page === page);
    });
    if (!inited[page] && PAGES[page].init) {
      inited[page] = true;
      try { PAGES[page].init(); } catch (e) { console.error("init " + page + " failed:", e); }
    }
    window.scrollTo({ top: 0 });
  }

  document.getElementById("main-nav").addEventListener("click", e => {
    const a = e.target.closest("a[data-page]");
    if (a) show(a.dataset.page);
  });
  document.querySelector(".brand").addEventListener("click", () => show("overview"));

  // 总览页流程链（可点击进入流水线）
  window.addEventListener("load", () => {
    const chain = document.getElementById("overview-flow");
    if (chain && window.ArchViz) {
      const gotoStage = (id) => { show("pipeline"); PipePage.gotoStage(id); };
      ArchViz.horizontal(chain, {
        blocks: [
          { label: "RAW 模拟", sub: "Bayer + 噪声", tone: "data", onClick: () => gotoStage("raw") },
          { label: "黑电平校正", sub: "BLC", tone: "conv", onClick: () => gotoStage("blc") },
          { label: "坏点校正", sub: "DPC", tone: "conv", onClick: () => gotoStage("dpc") },
          { label: "阴影校正", sub: "LSC", tone: "conv", onClick: () => gotoStage("lsc") },
          { label: "RAW 降噪", sub: "中值", tone: "conv", onClick: () => gotoStage("rawDenoise") },
          { label: "自动白平衡", sub: "AWB ×3", tone: "conv", onClick: () => gotoStage("awb") },
          { label: "去马赛克", sub: "Demosaic ×2", tone: "conv", onClick: () => gotoStage("demosaic") },
          { label: "降噪", sub: "Bilateral/Median", tone: "conv", onClick: () => gotoStage("denoise") },
          { label: "CCM", sub: "色彩校正", tone: "conv", onClick: () => gotoStage("ccm") },
          { label: "Gamma", sub: "色调编码", tone: "conv", onClick: () => gotoStage("gamma") },
          { label: "锐化", sub: "USM", tone: "conv", onClick: () => gotoStage("sharpen") },
          { label: "色彩增强", sub: "饱和/对比", tone: "conv", onClick: () => gotoStage("color") }
        ]
      });
    }
  });

  show("overview");
})();
