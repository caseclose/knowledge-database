# 代码渲染造图数据的相关工作调研：从扩散文字渲染到「代码即数据引擎」

> 本文梳理「用代码/标记语言作中间表示、渲染成图」这条造数路线的相关工作全景（截至 2026-07），
> 用来论证：为文生图（T2I）与图像编辑造**结构化设计图/文档**数据时，代码渲染比扩散生成 +
> OCR 回标在**标签精度、编辑一致性、成本**上更优。本文是[代码渲染信息图数据工厂](code-render-infographic-data-factory.md)
> 与[v2 实现](code-render-diversity-and-editing-implementation.md)两篇的文献底座。

## 背景：为什么要调研这条线

图像里的文字是造数的第一难点：既要**拼写/字形正确**，又要**版式合理、风格多样、信息量可控**，
还要拿到**像素级 bbox** 做可控训练与评测。扩散路线在这几点上很难同时满足；而代码渲染
（LLM 写 HTML/SVG/LaTeX → 确定性渲染器出图 → 从 DOM/源码取标注）能直接绕开拼写与标注问题。
相关工作可分六条线索：前五条是**对照**，第六条是**核心论据**。

## 线索一：视觉文字生成（扩散路线，对照组）

直接在像素空间生成带文字的图，是「不走代码渲染」的另一条路，也暴露了扩散路线的痛点。

| 工作 | 做法与局限 |
|------|-----------|
| [GlyphControl](https://proceedings.neurips.cc/paper_files/paper/2023/file/8951bbdcf234132bcce680825e7cb354-Paper-Conference.pdf) (NeurIPS 2023) | ControlNet 注入「字形图」控内容/位置/字号，建 LAION-Glyph；主要面向单词/短文本 |
| [TextDiffuser-2](https://arxiv.org/html/2311.16465v1) | 用语言模型预测版式再绘制；自陈前作在**版式灵活性/字体多样性**上受限 |
| [AnyText](https://arxiv.org/html/2311.03054v4) | 辅助隐变量 + OCR 笔画编码，可在曲线/不规则区写字，中文显著优于纯 Latin |
| [Glyph-ByT5](https://arxiv.org/html/2403.09622) (ECCV 2024, [代码](https://github.com/AIGText/Glyph-ByT5)) | 训练字符感知文本编码器（微调 ByT5）+ SDXL，设计图文字准确率 <20%→~90%，首次支持段落级多行排版、约 10 语言 |

**结论**：长文本拼写、复杂版式、字体多样性难同时满足，且**监督信号（字形/位置）本身难获取**。
代码渲染可作为它们的高质量训练/评测数据来源。

## 线索二：网页截图 → 代码（数据形态相同，方向相反）

- **pix2code**：早期「截图 → DSL」小规模合成探索。
- **Pix2Struct**：遮挡网页截图做视觉语言预训练。
- [WebSight](https://arxiv.org/html/2403.09029v1)（[数据卡](https://huggingface.co/datasets/HuggingFaceM4/WebSight)）：
  大规模**合成** HTML↔截图配对，v0.1 约 82.3 万、v0.2 约 192 万（Tailwind、真实图片、更多表格），
  截图用 **Playwright** 采集。

**结论**：WebSight 证明「LLM 造 HTML + 浏览器渲染」的合成管线**百万级可行**，Playwright 是社区默认
渲染器。差异在于它做 screenshot→code（生成代码），我们做 prompt→image（造 T2I 图），因此更强调
画面多样性、信息量分层、像素级文字标注。

## 线索三：信息图 / 图表（内容形态最接近）

- [ChartGalaxy](https://arxiv.org/abs/2505.18668)（[代码](https://github.com/ChartGalaxy/ChartGalaxy)）：
  百万级信息图（6.18 万真实 + 170 万合成），归纳 75 图表类型 / 440 变体 / 68 版式模板，**程序化合成**，
  给「数据表↔图↔代码」三元组，并提出 D3 代码生成基准（按高/低层 SVG 相似度评测）。
- [Chart2Code-160k / ChartCoder](https://huggingface.co/datasets/xxxllz/Chart2Code-160k)：
  首个专注 chart-to-code 的 MLLM + 16 万 `<chart, code>`，用 Code LLM 提可执行性，Snippet-of-Thought 分步生成。

**结论**：ChartGalaxy 的「模板 + 变体 + 版式」程序化合成，与我们的**分层 style spec 采样**同源；
其高/低层 SVG 相似度评测启发**结构级 QC**。

## 线索四：版式生成（构图多样性的学术基础）

| 工作 | 要点 |
|------|------|
| [LayoutTransformer](https://ar5iv.labs.arxiv.org/html/2006.14615) | 自回归生成版式基元（bbox），跨自然图/文档/App/3D |
| [LayoutDM](https://openaccess.thecvf.com/content/CVPR2023/papers/Chai_LayoutDM_Transformer-Based_Diffusion_Model_for_Layout_Generation_CVPR_2023_paper.pdf) (CVPR 2023) | 离散扩散版式，质量/多样性/分布覆盖优于 GAN/VAE |
| [DLT](https://openaccess.thecvf.com/content/ICCV2023/papers/Levi_DLT_Conditioned_layout_generation_with_Joint_Discrete-Continuous_Diffusion_Layout_Transformer_ICCV_2023_paper.pdf) (ICCV 2023) | 离散-连续联合扩散，nucleus sampling (p=0.9) 提多样性 |
| [RALF](https://openaccess.thecvf.com/content/CVPR2024/papers/Horita_Retrieval-Augmented_Layout_Transformer_for_Content-Aware_Layout_Generation_CVPR_2024_paper.pdf) (CVPR 2024) | 高维版式数据稀缺，**检索最近邻真实版式**喂生成器提质 |

**结论**：(1) 采样多样性关键（对应加权采样 + dropout）；(2) 未来可用**检索增强**（RALF 思路）引入
真实信息图版式做参考。

## 线索五：程序化文档合成与多样性/质量控制

- [DocLayout-YOLO / DocSynth-300K](https://arxiv.org/html/2410.12628v1)：网格 BestFit 装箱程序化拼 30 万页多样版式。
- [LaTeX2Layout](https://ojs.aaai.org/index.php/AAAI/article/view/40349)：从 **LaTeX 编译过程**直接抽像素级 bbox 与阅读顺序。
- [DocLayNet](https://github.com/ds4sd/doclaynet)：8 万余页人工标注版式基准，COCO bbox。
- 多样性/质量方法论：[CodecLM](https://aclanthology.org/2024.findings-naacl.235.pdf)（metadata 编码目标分布 + 过滤）、
  [AgentInstruct](https://arxiv.org/pdf/2407.03502)（taxonomy 系统性引入多样性）、
  [CoT-Self-Instruct](https://arxiv.org/html/2507.23751v2) / [SynPO](https://doi.org/10.48550/arxiv.2410.06961)（CoT 规划 + 拒绝采样过滤 / 关键词组合采样）。

**结论**：支撑「**显式控制面 + 加权采样 + dropout** 造受控多样性，再用**自动 QC 拒绝采样式过滤**」的
方法论。LaTeX2Layout「从渲染过程取 bbox」正是「从 DOM 取 bbox」的 Web 版对应。

## 线索六：代码作为数据引擎（核心论据）

把某种代码/标记语言当**中间表示（IR）**，用确定性编译器/渲染器变成图像，即可批量、廉价、可控地
造 T2I 与编辑数据。按「用什么 IR / 造什么品类 / 怎么造编辑对 / 为什么可信」四点展开。

### (A) 矢量图：TikZ 作 IR 的 text→graphic

- [AutomaTikZ](https://proceedings.iclr.cc/paper_files/paper/2024/file/f7641940c7dd9e5de58c20e39586eb64-Paper-Conference.pdf) (ICLR 2024) +
  [DaTikZ](https://github.com/potamides/DaTikZ)：指出「直接生成 SVG 低层图元难，但 TikZ 这种**高层图形语言**
  适合 LLM 条件生成」，建约 12 万条 TikZ↔caption，微调模型在相似度/对齐上超 GPT-4/Claude 2。
- [DeTikZify](https://arxiv.org/pdf/2405.15306) (NeurIPS 2024)：扩到 36 万+ TikZ，新增 sketch/figure→TikZ，
  提出 **MCTS 推理时自我精修**。

**启示**：高层图形语言（TikZ/SVG/HTML）比像素/低层图元更利于 LLM 生成与后期编辑——这正是选 HTML/SVG 作 IR 的原因。

### (B) markup2image：公式/乐谱/分子等领域数据

- 公式：[im2latex-100k](https://zenodo.org/records/56198)（~10 万公式图↔LaTeX，MER 标准基准）、
  [im2latexv2/MathNet](https://zenodo.org/records/11230382)（归一化 + **61 种渲染环境/多字体**）、
  [PH_FORMULA_CORPUS_V1](https://huggingface.co/datasets/puhuilab/ph_formula_corpus_v1)（1.6 亿归一化公式）。
- 乐谱/分子：`markup2im` 用 LilyPond 编译乐谱、SMILES + RDKit 渲染分子结构。

**启示**：(1) **同一源码用多种环境/字体/主题渲染，零成本放大多样性**；(2) 标签直接来自源码，**免 OCR 回标**。

### (C) 用代码 diff 造 image-editing 三元组

编辑训练最缺「除目标外像素严格不变」的高一致性配对——这是扩散重绘的软肋、代码渲染的强项。

- [UniREditBench / UniREdit-Data-100K](https://arxiv.org/html/2511.01295v2)：game-world 分支**用 Python 程序**
  按规则定义并求解谜题，程序化生成「原图/编辑图 + 指令 + 参考效果 + 程序化 CoT」，VLM 转自然语言 CoT，
  质量过滤，得到 10 万级、带推理链、**可程序化验证**的编辑数据。
- [AnyEdit](https://dcd-anyedit.github.io/)：250 万条、20+ 编辑类型，显式引入**合成/反事实场景**平衡分布。

**启示**：「组件契约 + 白名单算子 + 源码 diff + 非编辑区像素一致性」本质上是 UniREditBench「程序化定义 +
可验证」思想在「HTML 排版编辑」上的落地，且一致性强于扩散重绘。

### (D) 可验证性：代码是「自带 ground-truth 的数据源」

图像由代码确定性生成，**源码即标签、编译器即验证器**：im2latex 标签是 LaTeX 串本身；UniREditBench
编辑正确性可用生成它的 Python 程序反查；本项目用「源码↔DOM↔OCR↔像素」四方交叉验证。代价是画面分布
受限于所选 IR 的表达力。

## 小结对比

| 维度 | 扩散文字渲染 | Screenshot→Code | 信息图/图表 | 版式生成 | 代码即数据引擎 |
|------|------|------|------|------|------|
| 产物 | 像素图 | 代码 | 图+代码 | bbox 版式 | 编译图 + 源码标签 |
| 文字正确性 | 难（模型学） | 天然（渲染） | 天然（渲染） | 无文字 | 天然（编译） |
| bbox 标注 | 需构造 | 有结构 | 有结构 | 是目标 | 源码即标签/免 OCR |
| 多样性来源 | 数据分布 | 模板/LLM | 模板+变体 | 采样/扩散 | 同源码多渲染+程序化 |
| 编辑一致性 | 弱（重绘漂移） | — | — | — | 强（改源码 diff/可验证） |

> **一句话：** 六条线索共同论证——只要内容存在确定性的「源码→图像」编译器，就能用「LLM 生成/编辑源码 →
> 渲染 → 交叉验证」的管线，比扩散 + OCR 回标更廉价、标签更精、编辑一致性更强地造 T2I 与编辑数据。
