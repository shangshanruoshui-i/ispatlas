/* ============================================================
 * ai-data.js — 深度学习 ISP / 图像修复算法图鉴数据
 * 结构图用 ArchViz.vertical / .horizontal 渲染
 * 指标均为论文自报数值（约值，供参考）
 * ============================================================ */
window.AIDATA = {
  categories: [
    /* ============================================================
       1. 低照度 RAW 成像
    ============================================================ */
    {
      id: "lowlight", name: "低照度 RAW 成像", sub: "从几乎全黑的 RAW 直接恢复可见图像——手机夜景模式的学术原型",
      schem: "lowlight",
      models: [
        {
          name: "Learning to See in the Dark (SID)", year: "CVPR 2018", tag: "端到端低照度 RAW",
          arch: { mode: "v", skips: [[2, 4, "U-Net 跳连 (concat)"]], blocks: [
            { label: "输入 RAW", sub: "Bayer 打包 H/2×W/2×4\n减黑电平 / 乘 ISO 增益", tone: "data" },
            { label: "浅层卷积组", sub: "Conv 3×3 ×2, C=16", tone: "conv" },
            { label: "U-Net 编码器", sub: "Conv + 池化 ×4\n通道 32→64→128→256", tone: "conv" },
            { label: "瓶颈层", sub: "Conv 3×3, C=256", tone: "conv" },
            { label: "U-Net 解码器", sub: "上采样 + 跳连拼接 ×4", tone: "conv" },
            { label: "输出 sRGB 图像", sub: "Conv → H×W×3", tone: "io" }
          ] },
          explain: [
            "核心洞察：极暗条件下应该绕开传统长曝光 ISP，直接在网络中完成「增益、去噪、白平衡、色调映射」全流程，让数据决定一切。",
            "输入不是 3 通道 RGB，而是把 Bayer RAW 按空间打包成 4 通道（R/Gr/Gb/B），空间分辨率减半，保留马赛克结构信息。",
            "采用带跳连的 U-Net：低照度去噪严重病态，需要编码器的低频语义 + 解码器的高频细节互补。",
            "训练时黑电平与增益做随机数据增广，使一个模型覆盖不同 ISO 与光照。"
          ],
          specs: [
            { k: "输入", v: "Bayer RAW (4ch 打包)" },
            { k: "输出", v: "sRGB 图像" },
            { k: "损失", v: "L1" },
            { k: "数据集", v: "SID (Sony / Fujifilm)" }
          ],
          metrics: [
            { k: "Sony 子集 PSNR", v: "≈28.9 dB" },
            { k: "对比传统管线", v: "亮度提升 100~300× 下仍可用" }
          ],
          repos: [
            { name: "cchen156/Learning-to-See-in-the-Dark", url: "https://github.com/cchen156/Learning-to-See-in-the-Dark" }
          ],
          resume: "复现 SID 是低照度方向最经典的项目起点：数据管线（RAW 打包）+ U-Net + 消融，全部可在一块 4090 上完成。"
        },
        {
          name: "ELD 物理噪声建模", year: "CVPR 2020", tag: "噪声形成模型",
          arch: { mode: "h", blocks: [
            { label: "信号相关噪声", sub: "光子散粒 (方差∝信号)", tone: "data" },
            { label: "信号无关噪声", sub: "读出 / 暗电流", tone: "data" },
            { label: "行/列固定模式噪声", sub: "FPN", tone: "data" },
            { label: "ADC 量化", tone: "stage" },
            { label: "校准参数估计", sub: "仅拍少数平场图", tone: "conv" },
            { label: "合成配对数据 → 训练去噪网", tone: "io" }
          ] },
          explain: [
            "真实低照度配对数据采集极其昂贵（需要同机位变 ISO 长曝光），ELD 用物理噪声形成模型「造」出训练数据。",
            "把噪声拆解为信号相关（散粒）、信号无关（读出）、FPN 与量化四个物理来源，各用一个参数化分布描述。",
            "参数只需对每台相机标定一次（拍少量平场/暗场图），之后即可在任意曝光下合成逼真噪声 RAW。",
            "是「物理先验 + 深度网络」混合流派的代表作，工业界传感器标定流程与其高度相似。"
          ],
          specs: [
            { k: "输入", v: "平场标定图 → 噪声参数" },
            { k: "输出", v: "合成 (noisy, clean) 训练对" },
            { k: "下游", v: "任意 RAW 去噪网络" }
          ],
          metrics: [
            { k: "效果", v: "合成数据训练 ≈ 真实数据训练（差 <0.5dB）" }
          ],
          repos: [],
          resume: "把「传感器物理」写进简历的最好素材：讲得清散粒噪声、读出噪声和 FPN 的差别。"
        },
        {
          name: "PMN 联合噪声建模与去噪", year: "TPAMI 2023 (旷视)", tag: "配对数据 + 噪声建模",
          arch: { mode: "v", blocks: [
            { label: "真实配对 RAW 数据", sub: "短曝噪声图 ↔ 长曝干净图", tone: "data" },
            { label: "噪声建模网络", sub: "以信号值 / 增益 / 色温为条件的异方差噪声分布", tone: "stage" },
            { label: "采样式数据增广", sub: "从噪声模型采样注入干净图", tone: "conv" },
            { label: "去噪网络", sub: "联合优化（与噪声模型互馈）", tone: "attn" },
            { label: "输出干净 RAW", tone: "io" }
          ] },
          explain: [
            "ELD 依赖人工标定，PMN 让噪声模型与去噪网络一起从配对数据中「学」出来。",
            "噪声模型以信号幅值、模拟增益、数字增益、白平衡增益为条件，能覆盖真实传感器噪声随工况的变化。",
            "训练时从噪声分布采样增广，去噪器反过来又约束噪声模型——两阶段互相提升。",
            "旷视量产前射流程的论文化版本，工业相关性很高。"
          ],
          specs: [
            { k: "输入", v: "配对 RAW（含噪声模型条件）" },
            { k: "输出", v: "干净 RAW" },
            { k: "损失", v: "去噪 L1 + 噪声分布对齐" }
          ],
          metrics: [
            { k: "效果", v: "SID / ELD 数据集上全面超越 ELD 固定模型" }
          ],
          repos: [
            { name: "megvii-research/PMN", url: "https://github.com/megvii-research/PMN" }
          ],
          resume: "在 SID 复现之上的自然升级点：把「改进噪声建模」作为自己的创新模块。"
        }
      ]
    },

    /* ============================================================
       2. 图像降噪
    ============================================================ */
    {
      id: "denoise", name: "图像降噪", sub: "从 CNN 残差学习到无激活函数网络——所有修复任务的公共底座",
      schem: "denoise",
      models: [
        {
          name: "DnCNN", year: "2017 (TPAMI)", tag: "残差学习开山",
          arch: { mode: "v", blocks: [
            { label: "含噪图像 x", tone: "io" },
            { label: "Conv 3×3×64 + ReLU", tone: "conv" },
            { label: "重复 ×15", sub: "Conv 3×3×64 + BatchNorm + ReLU", tone: "stage" },
            { label: "Conv 3×3 → 预测噪声 v̂", sub: "残差学习：网络只学噪声", tone: "conv" },
            { label: "输出 y = x − v̂", tone: "io" }
          ] },
          explain: [
            "第一个把「残差学习」引入去噪的工作：让网络预测噪声本身而非干净图，把去噪退化成均值为零的回归问题，显著降低学习难度。",
            "BN + 残差的组合让深度 CNN 在去噪上首次全面超越 BM3D 一族传统方法。",
            "同一个框架可扩展到超分 / JPEG 去压缩伪影（统一的「残差」视角）。"
          ],
          specs: [
            { k: "输入/输出", v: "含噪灰度图 / 干净图" },
            { k: "损失", v: "MSE" },
            { k: "数据集", v: "BSD400 + Waterloo (合成噪声)" }
          ],
          metrics: [ { k: "BSD68 σ=25", v: "≈29.2 dB" } ],
          repos: [ { name: "cszn/DnCNN", url: "https://github.com/cszn/DnCNN" } ],
          resume: "最适合作为「第一篇复现」：结构简单、训练半小时，重点在消融（有无残差/BN）。"
        },
        {
          name: "NAFNet", year: "ECCV 2022", tag: "无激活函数基线",
          arch: { mode: "v", skips: [[2, 4, "编码→解码 跳连 (SCA 门控)"]], blocks: [
            { label: "输入图像 x", sub: "H×W×3", tone: "io" },
            { label: "浅层特征提取", sub: "3×3 Conv", tone: "conv" },
            { label: "编码器 ×4", sub: "NAFBlock：LayerNorm → 简化通道注意力\n(SimpleGate) → FFN(SimpleGate + SCA)", tone: "attn" },
            { label: "瓶颈 NAFBlock ×N", tone: "attn" },
            { label: "解码器 ×4", sub: "上采样 + 跳连融合", tone: "attn" },
            { label: "重建", sub: "1×1 Conv + 全局残差 y = x + F(x)", tone: "conv" },
            { label: "输出 y", tone: "io" }
          ] },
          explain: [
            "核心论点：修复网络里的非线性激活函数（ReLU/GELU）可以全部去掉。NAFBlock 用 SimpleGate（特征通道对半拆分后逐元素相乘）提供非线性，用 SCA（逐通道 1×1 卷积全局注意力）替代昂贵的自注意力。",
            "去掉激活与大部分归一化后，同样的算力下精度更高、速度更快，成为降噪/去模糊任务最常用的强基线。",
            "U 形多尺度 + 跳连结构保留细节，全局残差让网络专注学习退化部分。"
          ],
          specs: [
            { k: "输入/输出", v: "RGB / RGB（全局残差）" },
            { k: "损失", v: "PSNR 损失 (Lcharb) + PSNR-b 感知版" },
            { k: "数据集", v: "SIDD（真实手机噪声）/ GoPro（模糊）" }
          ],
          metrics: [
            { k: "SIDD 验证集", v: "≈40.3 dB" },
            { k: "GoPro 去模糊", v: "≈34.3 dB" }
          ],
          repos: [ { name: "megvii-research/NAFNet", url: "https://github.com/megvii-research/NAFNet" } ],
          resume: "复现到论文指标 + 换掉某个模块做消融 + TensorRT 量化，是最稳妥的一套简历组合拳。"
        },
        {
          name: "Restormer", year: "CVPR 2022 Oral", tag: "高效 Transformer 修复",
          arch: { mode: "v", skips: [[2, 4, "编码→解码 跳连"]], blocks: [
            { label: "退化图像", tone: "io" },
            { label: "浅层卷积 + 编码器", sub: "MDTA：Multi-DConv 头转置注意力\n（在通道维算注意力，线性复杂度）", tone: "attn" },
            { label: "GDFN 门控前馈", sub: "深度卷积 + 门控双分支 FFN", tone: "attn" },
            { label: "多尺度 U 形主干", sub: "4 级分辨率，通道逐级翻倍", tone: "stage" },
            { label: "对称解码器", sub: "上采样 + 跳连融合", tone: "attn" },
            { label: "3×3 Conv 重建 + 残差", tone: "io" }
          ] },
          explain: [
            "解决「Transformer 无法处理高分辨率图像」的问题：MDTA 不在像素间算注意力，而是对每个 head 的 (C×C) 通道协方差做 softmax，复杂度随分辨率线性而非平方增长。",
            "GDFN 用两条 1×1+3×3 深度卷积分支相乘做门控，选择性地让信息通过。",
            "一个模型同时拿下去噪、去雨、去模糊 SOTA，是通用修复主干的代表作。"
          ],
          specs: [
            { k: "输入/输出", v: "RGB / RGB" },
            { k: "损失", v: "Charbonnier + 频域损失" },
            { k: "数据集", v: "GoPro / SIDD / Rain100L 等" }
          ],
          metrics: [
            { k: "GoPro 去模糊", v: "≈34.4 dB" },
            { k: "SIDD 去噪", v: "≈39.7 dB" }
          ],
          repos: [ { name: "swz30/Restormer", url: "https://github.com/swz30/Restormer" } ],
          resume: "面试高频：能讲清「通道注意力为什么能替代空间注意力、复杂度怎么降下来」就赢了大多数人。"
        }
      ]
    },

    /* ============================================================
       3. 联合去马赛克与降噪
    ============================================================ */
    {
      id: "demosaic", name: "联合去马赛克与降噪", sub: "ISP 里最经典的两步耦合问题——深度学习首次胜过流水线设计的地方",
      schem: "demosaic",
      models: [
        {
          name: "Deep Joint Demosaicking and Denoising (DMCNN)", year: "SIGGRAPH Asia 2016 / 2017", tag: "两阶段插值引导",
          arch: { mode: "v", blocks: [
            { label: "含噪 Bayer RAW", tone: "data" },
            { label: "Stage 1：CI 网络", sub: "插值结果引导：把双线性插值图\n与 RAW 拼接输入，同时完成全色插值 + 去噪", tone: "conv" },
            { label: "Stage 2：精修网络", sub: "以 Stage 1 输出为引导\n在原始 Bayer 上二次估计残差", tone: "conv" },
            { label: "输出干净 RGB", tone: "io" }
          ] },
          explain: [
            "把「先插值再降噪」的顺序依赖反转：让网络同时利用 RAW 与粗插值结果，端到端地解决两个耦合任务。",
            "两阶段「插值引导」设计：第一阶段建立全色估计，第二阶段在其引导下精修，比单阶段更稳。",
            "论文证明：在含噪输入下，联合处理的 PSNR 显著高于任何「分步」组合——这是深度学习在 ISP 模块级的第一批标志性胜利。"
          ],
          specs: [
            { k: "输入", v: "含噪 Bayer RAW" },
            { k: "输出", v: "干净 sRGB" },
            { k: "损失", v: "L2" },
            { k: "数据集", v: "Kodak/Microsoft 合成含噪数据" }
          ],
          metrics: [ { k: "含噪条件", v: "较「插值→降噪」分步管线 PSNR 明显更高（约 +1~2dB）" } ],
          repos: [ { name: "mgharbi/demosaicnet_caffe", url: "https://github.com/mgharbi/demosaicnet_caffe" } ],
          resume: "与本系统流水线页联动最好：在页面上用「双线性插值 + 后置降噪」复现分步方案的伪影，即是论文动机的活教材。"
        },
        {
          name: "Iterative Residual Network (deep_demosaick)", year: "CVPRW 2020 (Skoltech)", tag: "迭代残差精修",
          arch: null,
          explain: [
            "把去马赛克+去噪建模为「粗估计 → 残差 → 再估计」的迭代精修循环，每次迭代都在前一结果上预测残差。",
            "迭代共享权重，参数量可控，性能随迭代次数上升，适合端侧算力预算受限的场景。",
            "在 LOD (joint demosaicing + denoising) 公开基准上长期是参照方法之一。"
          ],
          specs: [
            { k: "输入/输出", v: "Bayer RAW / RGB" },
            { k: "结构", v: "权重共享的迭代残差 CNN" }
          ],
          metrics: [ { k: "LOD 基准", v: "迭代 3 次左右收敛" } ],
          repos: [ { name: "cig-skoltech/deep_demosaick", url: "https://github.com/cig-skoltech/deep_demosaick" } ],
          resume: "小而完整的方向：数据合成（Bayer 采样 + 噪声）→ 训练 → 与本系统传统插值算法对比，两周可出结果。"
        }
      ]
    },

    /* ============================================================
       4. All-in-One 修复
    ============================================================ */
    {
      id: "allinone", name: "All-in-One / 盲修复", sub: "一个模型吃下噪声、雨、模糊、低照度——近三年最热的研究方向之一",
      schem: "allinone",
      models: [
        {
          name: "AirNet", year: "CVPR 2022", tag: "对比学习退化编码",
          arch: { mode: "v", blocks: [
            { label: "未知退化输入", tone: "data" },
            { label: "CBDE 退化编码器", sub: "MoCo 式对比学习\n把各种退化映射到统一特征空间", tone: "stage" },
            { label: "CBAG 引导注意力", sub: "退化特征 → 生成逐层调制信号\n注入修复主干每个 Transformer 块", tone: "attn" },
            { label: "Restormer 式修复主干", tone: "conv" },
            { label: "输出干净图像", tone: "io" }
          ] },
          explain: [
            "All-in-One 的关键不是主干，而是「如何感知退化」。AirNet 用对比学习（正样本=同退化不同视角，负样本=不同退化）学出一个连续退化空间。",
            "修复主干的每一层都被退化特征调制（Content-Guided Attention），等效于「隐式选择处理算法」。",
            "训练时混合去噪 / 去雨 / 去模糊三种任务的数据，推理时不需要任何退化先验。"
          ],
          specs: [
            { k: "输入", v: "未知退化的 RGB" },
            { k: "输出", v: "干净 RGB" },
            { k: "损失", v: "CBDE 对比损失 + 修复 L1" }
          ],
          metrics: [ { k: "3×3 任务混合基准", v: "单模型 ≈ 各任务专用模型水平" } ],
          repos: [ { name: "XLearning-SCU/2022-CVPR-AirNet", url: "https://github.com/XLearning-SCU/2022-CVPR-AirNet" } ],
          resume: "讲清楚「对比学习在这里为什么 work」比堆指标更能体现理解深度。"
        },
        {
          name: "PromptIR", year: "NeurIPS 2023", tag: "可学习提示",
          arch: { mode: "v", blocks: [
            { label: "未知退化输入", tone: "data" },
            { label: "浅层特征提取", sub: "3×3 Conv", tone: "conv" },
            { label: "Prompt 生成模块", sub: "可学习 Prompt 组件池\n+ 输入感知的稀疏组合权重", tone: "attn" },
            { label: "Transformer 修复主干 ×N", sub: "PromptBlock：Prompt 与特征\n在空间与通道维交互调制", tone: "attn" },
            { label: "重建 + 全局残差", tone: "io" }
          ] },
          explain: [
            "把「退化感知」重述为 prompt learning：维护一组可学习的 prompt 组件，网络根据输入预测组合系数（可稀疏化），动态拼出当前退化对应的「指令」。",
            "PromptBlock 让 prompt 与图像特征逐层交互，比 AirNet 的一次性全局调制更细粒度。",
            "可视化组合系数可以看到模型对噪声/雨/模糊的「软路由」，解释性强，面试好展示。"
          ],
          specs: [
            { k: "输入", v: "未知退化 RGB" },
            { k: "输出", v: "干净 RGB" },
            { k: "损失", v: "L1" }
          ],
          metrics: [ { k: "同基准", v: "较 AirNet 平均 PSNR 再 +1dB 左右（自报）" } ],
          repos: [ { name: "va1shn9v/PromptIR", url: "https://github.com/va1shn9v/PromptIR" } ],
          resume: "「Prompt 不止属于 NLP」的好故事；可做创新点：把 ISP 退化（马赛克/摩尔纹）加入任务集。"
        },
        {
          name: "AdaIR", year: "ICLR 2025", tag: "频域挖掘与调制",
          arch: null,
          explain: [
            "观察到不同退化在频域留下不同指纹（噪声=高频、模糊=中频衰减、低照度=整体幅度压缩）。",
            "在 U 形主干中加入频率挖掘与调制模块（FFT 分解高低频，分别调制后再逆变换回空域）。",
            "以更少的参数在 All-in-One 基准上超过 PromptIR 一档，代表「频域先验 + All-in-One」的最新趋势。"
          ],
          specs: [
            { k: "输入", v: "未知退化 RGB" },
            { k: "关键模块", v: "频域分解调制 (FFT/IFFT)" }
          ],
          metrics: [ { k: "All-in-One 基准", v: "平均 PSNR 进一步领先（自报）" } ],
          repos: [ { name: "c-yn/AdaIR", url: "https://github.com/c-yn/AdaIR" } ],
          resume: "2025 新作，简历上写「跟进 ICLR'25 前沿并复现」非常加分。"
        }
      ]
    },

    /* ============================================================
       5. 超分辨率
    ============================================================ */
    {
      id: "sr", name: "超分辨率", sub: "ISP 中与 zoom / 数字变焦直接对接的模块",
      schem: "sr",
      models: [
        {
          name: "SwinIR", year: "ICCVW 2021", tag: "Swin Transformer 用于修复",
          arch: { mode: "v", skips: [[2, 3, "局部残差 + 长跳连"]], blocks: [
            { label: "输入 LR（bicubic 上采样拼接）", tone: "io" },
            { label: "浅层特征提取", sub: "3×3 Conv", tone: "conv" },
            { label: "RSTB ×N", sub: "Swin Transformer 层：窗口自注意力 W-MSA\n+ 移位窗口 SW-MSA，块级残差", tone: "attn" },
            { label: "3×3 Conv + 长跳连", sub: "全局残差学习", tone: "conv" },
            { label: "上采样模块", sub: "Conv + PixelShuffle (×2/×3/×4)", tone: "conv" },
            { label: "输出 HR", tone: "io" }
          ] },
          explain: [
            "把 Swin Transformer 的窗口注意力搬进修复任务：窗口内算注意力控制计算量，窗口移位（shift）保证跨窗信息交流。",
            "RSTB = 若干 Swin 层 + 一个卷积 + 残差连接，让 CNN 与 Transformer 混合互补。",
            "证明了对「平移等变、局部纹理」的图像任务，精心设计的 CNN 残差与窗口注意力同等重要——纯 ViT 式全局注意力并非必需。"
          ],
          specs: [
            { k: "输入/输出", v: "LR / HR (×2 ×3 ×4)" },
            { k: "损失", v: "L1" },
            { k: "数据集", v: "DIV2K + Flickr2K（800+2650 张）" }
          ],
          metrics: [ { k: "Set5 ×4", v: "≈32.9 dB（-L 版自报）" } ],
          repos: [ { name: "JingyunLiang/SwinIR", url: "https://github.com/JingyunLiang/SwinIR" } ],
          resume: "训练轻量版（real-SR 或 ×2）即可单卡完成；也可只做预训练权重测试 + 真实场景对比报告。"
        },
        {
          name: "HAT", year: "CVPR 2023", tag: "混合注意力",
          arch: null,
          explain: [
            "同时利用「窗口自注意力 + 通道注意力 + 跨窗口连接」，并引入同任务预训练（large-model + pretraining 策略）。",
            "发现：预训练对 Transformer 超分的提升远大于对 CNN 的提升，据此把 SwinIR 的记录整体推进。",
            "结构与训练策略两层贡献都值得在面试里展开。"
          ],
          specs: [
            { k: "输入/输出", v: "LR / HR" },
            { k: "关键", v: "混合注意力 + 任务预训练" }
          ],
          metrics: [ { k: "Set5 ×4", v: "≈33.3 dB（自报）" } ],
          repos: [ { name: "XPixelGroup/HAT", url: "https://github.com/XPixelGroup/HAT" } ],
          resume: "适合作为「SwinIR 之上的改进对照」出现，体现对领域进展的追踪。"
        }
      ]
    },

    /* ============================================================
       6. 去模糊
    ============================================================ */
    {
      id: "deblur", name: "去模糊", sub: "手抖 / 运动模糊——ISP 中与 OIS、多帧融合紧密耦合的模块",
      schem: "deblur",
      models: [
        {
          name: "MIMO-UNet", year: "ICCV 2021", tag: "多输入多输出 U-Net",
          arch: null,
          explain: [
            "核心思想：模糊是高度非线性的病态问题，单一编码器特征不够。MIMO-UNet 在编码器注入多尺度输入（下采样不同倍数的模糊图），解码器多尺度输出、每个输出都监督。",
            "不对称的编码-解码设计（编码器宽、解码器窄）+ 多输出损失，让网络在 GoPro 基准上以小参数量超过 MPRNet 等大模型。",
            "与 NAFNet / Restormer 一起构成去模糊三大常用基线。"
          ],
          specs: [
            { k: "输入/输出", v: "模糊 RGB / 清晰 RGB" },
            { k: "结构", v: "多尺度输入 + 多尺度输出 U-Net" },
            { k: "损失", v: "Charbonnier + 频域 (多尺度监督)" }
          ],
          metrics: [ { k: "GoPro", v: "≈32.4 dB" } ],
          repos: [ { name: "chojuihwan/MIMO-UNet", url: "https://github.com/chojuihwan/MIMO-UNet" } ],
          resume: "「多尺度输入为什么对模糊有效」是个好的面试讨论点（模糊核与尺度耦合）。"
        },
        {
          name: "NAFNet (去模糊配置)", year: "ECCV 2022", tag: "当前去模糊默认基线",
          arch: null,
          explain: [
            "与降噪共用同一 NAFBlock 结构，仅在数据集（GoPro/HIDE/RealBlur）与宽度上配置不同。",
            "在 GoPro 上 34.3+ dB 的成绩长期是公开榜单参照点；后续去模糊论文几乎都与其对比。",
            "配合其官方 TensorRT 部署脚本，是研究→部署全链路练习的绝佳对象。"
          ],
          specs: [
            { k: "输入/输出", v: "模糊 RGB / 清晰 RGB" },
            { k: "数据集", v: "GoPro / HIDE / RealBlur" }
          ],
          metrics: [ { k: "GoPro", v: "≈34.3 dB" } ],
          repos: [ { name: "megvii-research/NAFNet", url: "https://github.com/megvii-research/NAFNet" } ],
          resume: "与降噪条目共用一次复现，简历上可以合并写成「NAFNet 双任务复现 + 部署」。"
        }
      ]
    },

    /* ============================================================
       7. 端到端 / 可逆 ISP
    ============================================================ */
    {
      id: "e2eisp", name: "端到端 / 可逆 ISP", sub: "用网络替代或压缩整条传统流水线——与手机厂商最相关的方向",
      schem: "e2e",
      models: [
        {
          name: "Deep ISP", year: "SIGGRAPH Asia 2018 (Google)", tag: "首个端到端可微 ISP",
          arch: { mode: "v", blocks: [
            { label: "Bayer RAW + 元数据", sub: "ISO / 曝光 / 色温作为条件输入", tone: "data" },
            { label: "网络化传统模块", sub: "去马赛克 / 去噪 / AWB\n用可微实现嵌入网络", tone: "conv" },
            { label: "特征级 ISP 模块串联", sub: "HDR 色调映射 / 局部色调映射\n镜头阴影校正等可微化", tone: "stage" },
            { label: "输出最终渲染图像", tone: "io" }
          ] },
          explain: [
            "把传统 ISP 的每个模块「可微化」后串联，让整条流水线可以用反向传播一起调优，目标逼近 MIT-Adobe FiveK 的专家修图。",
            "证明了两件影响深远的事：① ISP 各模块间存在被流水线顺序忽略的耦合；② 专家修图风格可以被网络学习。",
            "是所有后续「learned ISP / 端侧 ISP 压缩」工作的共同起点。"
          ],
          specs: [
            { k: "输入", v: "Bayer RAW + 元数据" },
            { k: "输出", v: "渲染 sRGB" },
            { k: "数据集", v: "MIT-Adobe FiveK (5000 RAW + 专家修图)" }
          ],
          metrics: [ { k: "用户研究", v: "与专家修图难以区分（原文报告）" } ],
          repos: [],
          resume: "与 FiveK 数据集绑定：拿到数据即可做「Deep-ISP 复现 / 简化版」，含金量高。"
        },
        {
          name: "Invertible-ISP", year: "CVPR 2021", tag: "可逆 RAW↔sRGB",
          arch: { mode: "v", blocks: [
            { label: "输入 sRGB 图像", tone: "io" },
            { label: "可逆元块 ×N", sub: "Half-Split → 1×1 可逆卷积\n+ 仿射耦合 (Affine Coupling)", tone: "stage" },
            { label: "隐式学习逆 ISP 操作", sub: "去 Gamma / 逆 CCM / 逆白平衡\n逆色调映射（无需显式建模）", tone: "stage" },
            { label: "输出 RAW (Bayer)", tone: "io" },
            { label: "反向传播同一路径 → RAW→sRGB", sub: "同一参数两用", tone: "io", dim: true }
          ] },
          explain: [
            "用可逆网络（normalizing-flow 式的仿射耦合块）同时建模 sRGB→RAW 与 RAW→sRGB，两个方向共用同一组参数。",
            "价值场景：数据增广（把大量 sRGB 图「逆」成 RAW 来训练 RAW 域模型）、RAW 压缩传输、ISP 复原取证。",
            "参数量比逐模块建模 ISP 小一个量级，且天然保证两方向的一致性。"
          ],
          specs: [
            { k: "输入/输出", v: "sRGB ↔ RAW 双向" },
            { k: "结构", v: "Half-Split 仿射耦合链" },
            { k: "数据集", v: "MIT-Adobe FiveK" }
          ],
          metrics: [ { k: "双向转换", v: "与专用 learned ISP 相当，参数更少（自报）" } ],
          repos: [ { name: "yzxing87/Invertible-ISP", url: "https://github.com/yzxing87/Invertible-ISP" } ],
          resume: "特色选题：可逆性 + ISP 的交叉，配合本系统的传统流水线页做「逆 ISP」演示非常出彩。"
        },
        {
          name: "Learned Smartphone ISP (MAI 挑战赛)", year: "CVPR 2021 / 2025", tag: "端侧轻量化",
          arch: { mode: "v", blocks: [
            { label: "手机 RAW（10bit Bayer）", sub: "Sony/华为设备采集", tone: "data" },
            { label: "目标：厂商 ISP 渲染图", sub: "作为 Ground Truth", tone: "data" },
            { label: "端到端网络", sub: "参数量 / 端侧延迟受严格限制", tone: "stage" },
            { label: "输出：逼近手机 ISP 成像", tone: "io" }
          ] },
          explain: [
            "任务定义本身就是工业命题：给定手机 RAW 与厂商 ISP 的成图，用极小的网络在端侧复现厂商成像风格。",
            "考察点集中在：轻量结构设计（深度可分、重参数化）、蒸馏、量化感知训练。",
            "历年冠军方案（MAI/AIM 系列）是学习「模型压缩如何在成像任务上落地」的最佳教材。"
          ],
          specs: [
            { k: "输入", v: "手机 RAW" },
            { k: "约束", v: "模型 <2M 参数级 / 端侧实时" },
            { k: "数据集", v: "MAI Learned Smartphone ISP 官方数据" }
          ],
          metrics: [ { k: "评价", v: "PSNR + 端侧运行时双重排名" } ],
          repos: [
            { name: "MediaTek-NeuroPilot/mai21-learned-smartphone-isp", url: "https://github.com/MediaTek-NeuroPilot/mai21-learned-smartphone-isp" },
            { name: "mv-lab/AISP (系列挑战官方库)", url: "https://github.com/mv-lab/AISP" }
          ],
          resume: "如果目标是手机厂 ISP 岗，这是对囗度最高的项目：轻量化 + 蒸馏 + 量化全都能讲。"
        }
      ]
    },

    /* ============================================================
       8. 低照度 sRGB 增强
    ============================================================ */
    {
      id: "enhance", name: "低照度 sRGB 增强", sub: "不走 RAW 的轻量路线——端侧落地最便宜的低光方案",
      schem: "lowlight-srgb",
      models: [
        {
          name: "Zero-DCE", year: "CVPR 2020", tag: "零参考曲线增强",
          arch: { mode: "v", blocks: [
            { label: "低照度 sRGB 输入", tone: "data" },
            { label: "DCE-Net", sub: "7 层全卷积，约 79K 参数", tone: "conv" },
            { label: "逐像素曲线参数图 A", sub: "迭代增强曲线\nLe(x;A) = x + A·x·(1−x)\n（单调、可微、保序）", tone: "stage" },
            { label: "增强输出", sub: "曲线迭代 8 次", tone: "io" },
            { label: "零参考损失", sub: "空间一致 + 曝光控制\n色彩恒常 + 光照平滑", tone: "loss" }
          ] },
          explain: [
            "不学「增强后的图像」，而是学一条逐像素的参数化增强曲线——模型极小、推理极快。",
            "完全不需要成对/非成对参考数据：用空间一致性、曝光先验、色彩恒常、光照平滑四个无参考损失自监督。",
            "缺点是只做亮度/色调映射，不解决噪声与伪影，常与去噪网络级联。"
          ],
          specs: [
            { k: "输入/输出", v: "暗光 sRGB / 正常光 sRGB" },
            { k: "参数量", v: "≈79K（手机端友好）" }
          ],
          metrics: [ { k: "评价", v: "SICE/MSEC 上视觉效果与专用方法相当，速度极快" } ],
          repos: [ { name: "Li-Chongyi/Zero-DCE", url: "https://github.com/Li-Chongyi/Zero-DCE" } ],
          resume: "最小成本的「第一个深度学习成像模型」：训练一晚，参数量小到可以在笔记本 CPU 实时跑。"
        },
        {
          name: "SCI (Self-Calibrated Illumination)", year: "CVPR 2022", tag: "自校准光照学习",
          arch: null,
          explain: [
            "把低照度增强建模为「光照估计」问题，提出级联的自校准模块：每级用轻量网络估计光照图，误差逐级收敛。",
            "训练时级联、推理时只取第一级，实现「训练重、推理轻」的巧妙权衡。",
            "免成对数据，性能与稳定性在同量级方法中长期领先，被广泛用作级联系统的增强前端。"
          ],
          specs: [
            { k: "输入/输出", v: "暗光 sRGB / 增强 sRGB" },
            { k: "关键", v: "级联训练 / 单级推理" }
          ],
          metrics: [ { k: "评价", v: "在多个无参考/全参考指标上领先同量级方法" } ],
          repos: [ { name: "Vis-AI/SCI", url: "https://github.com/Vis-AI/SCI" } ],
          resume: "「训练-推理不对称设计」是个高级概念，讲清楚它等于证明你读过源码。"
        },
        {
          name: "Retinexformer", year: "ICCV 2023", tag: "Retinex + Transformer",
          arch: null,
          explain: [
            "把经典 Retinex 理论（图像 = 反射率 × 光照）改写成「单阶段」可学习框架：先估计光照先验引导的illumination图，再用 Transformer 联合恢复反射率与光照。",
            "用 1D White-Box Transformer（逐通道线性注意力思路）保持轻量。",
            "在 LOL 等低光基准与五类一阶段方法对比中全面领先，是「经典物理模型 + 新骨干」融合的范例。"
          ],
          specs: [
            { k: "输入/输出", v: "暗光 sRGB / 增强 sRGB" },
            { k: "理论", v: "Retinex 分解的单阶段可学习化" }
          ],
          metrics: [ { k: "LOL", v: "PSNR 领先同期一阶段方法（自报）" } ],
          repos: [ { name: "caiyuanhao1998/Retinexformer", url: "https://github.com/caiyuanhao1998/Retinexformer" } ],
          resume: "「用 2003 年的 Retinex 理论给 2023 年的 Transformer 当先验」——跨时代结合的故事非常适合面试开场。"
        }
      ]
    }
  ]
};
