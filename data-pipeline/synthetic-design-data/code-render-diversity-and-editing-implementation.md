# 代码渲染数据工厂 v2 实现：多画布 / 信息量分层 / 风格采样 / 组件契约 / 多 code mode / 交叉验证

> 创建时间：2026-07-28 ｜ 最新更新：2026-07-28

> 本文记录 info-code-gen 项目 v2 已落地的具体机制，是[代码渲染信息图数据工厂](code-render-infographic-data-factory.md)
> （方法论/愿景）与[相关工作调研](code-render-related-work-survey.md)（文献底座）的**工程实现篇**。
> 重点解决两件事：**画面多样性**（避免全蓝、构图单一、截断）与**可控编辑一致性**（编辑三元组）。

## 解决的两个真问题

- **截断**：早期固定 1024×576 + `body{overflow:hidden}` 截图，信息量一大就被裁掉。
- **多样性坍缩**：模型倾向输出相似配色/构图、图标稀少、信息量偏小。

对策是给生成侧加一层**显式控制面（分层 style 采样）**，给渲染侧加**多画布 + 多 code mode**，
给编辑侧加**组件契约 + 白名单算子 + 双重一致性校验**。

## 生成侧控制面：分层 style 采样

对每条主题独立采样一层 `StyleSpec`，再拼成可验收的 user prompt。采样轴：

| 轴 | 取值 | 说明 |
|----|------|------|
| `canvas` | 5 种标准画布 | 与信息量耦合 |
| `info_density` | sparse / moderate / high / dense | **主轴，必采样、不 dropout** |
| `code_mode` | html / svg / latex | 权重 0.80 / 0.15 / 0.05 |
| `fonts` | 无衬线 / 宋体 / 手写 / 标题宋体+正文无衬线 | 映射到注入的字体变量 |
| `type_scale` | 大 / 中 / 紧凑标题 | dense 允许更紧字阶但 ≥12px |
| `palette` | 冷 / 暖 / 高对比 / 低饱和 / 深底 | 避免全蓝塌缩 |
| `layout` | 左文右图/网格/时间轴/环形KPI/卡片墙/双栏/英雄区/仪表盘多区 | 按密度偏置 |
| `visual_density` | 极简 / 中等 / 华丽 | 装饰多少，与信息量正交 |
| `iconography` | icon_heavy / medium / light | 鼓励语义 inline SVG |

**受控多样性三机制**：

1. **加权采样**：`info_density` 权重 `sparse 0.15 / moderate 0.30 / high 0.35 / dense 0.20`，
   使中高信息量占多数；icon 权重偏向 heavy/medium。
2. **条件耦合**：`high/dense` 时把大画布权重放大 2.5×、小画布压到 0.4×，减少「信息塞小画布被 overflow 打掉」；
   同时按密度切换构图池与 icon 权重。
3. **Dropout**：非主轴以 ~30% 概率省略，避免所有样本被同一套硬约束绑死；`canvas` 与 `info_density` **永不 dropout**。

> 批量生成用 `stratified_values` 对 `info_density` / `code_mode` 做**分层配额**，保证一小批内分布贴合权重，
> 而非纯随机抖动（对应 CodecLM 的分布对齐思想）。

## 五种标准画布（解决截断）

改为从 5 种标准画布采样，渲染支持 per-sample viewport（`RenderConfig.with_viewport`，DPR=2）：

| id | CSS viewport | 比例 | 权重 |
|----|--------------|------|------|
| landscape_hd | 1280×720 | 16:9 | 0.35 |
| landscape_wide | 1024×576 | 16:9 | 0.20 |
| square | 1024×1024 | 1:1 | 0.20 |
| portrait_story | 720×1280 | 9:16 | 0.15 |
| slides_43 | 1024×768 | 4:3 | 0.10 |

策略是「**多画布 + 构图消化信息量**」而非无限增高：内容仍须适配所选画布，超框由 QC 判失败，
可重试换更大画布或降密度。

## 信息量四级（可验收硬指标）

为每档写入**可数**约束（而非「请丰富一点」的软话），使 QC 能判定：

- `sparse`：1 标题 + 1 主 KPI + ≤3 短文案，大量留白。
- `moderate`：3–5 模块，每块 1 标题 + 1–2 句。
- `high`：6–10 模块 + 数字表/对比条。
- `dense`：≥10 信息单元，多 KPI + 小表/图例/脚注，任何字号 ≥12px。

## Icon 鼓励

system prompt 与 builder 双重约束：优先**语义相关的 inline SVG path**，禁止 icon font / CDN / 外链图片；
按档位给下限（medium ≥3，heavy ≥6，且不得复用同一图标糊弄）。

## 多 Code Mode 与渲染边界

统一入口 `render_code` 按 `code_mode` 分发：

| mode | 权重 | 渲染方式 | 能力边界 |
|------|------|----------|----------|
| `html` | 0.80 | Playwright | 完整 DOM 契约、局部编辑、文字 bbox |
| `svg` | 0.15 | standalone SVG 包装成固定画布 HTML 后 Playwright 渲染 | 保留 DOM/QC 能力 |
| `latex` | 0.05 | 受限 XeLaTeX（`-no-shell-escape`）编译 → Ghostscript 栅格化 | 无浏览器 DOM，不做组件级 editing |

- LaTeX 显式禁止 `input/include/openin/openout/write18` 等文件/命令访问，只作为公式/学术文档样本的补充分布。
- 三模式共用 `extract_complete_code` 抽取完整源文档。
- 是否可运行 LaTeX 由 `available_code_modes()` 探测 `xelatex` 与 `gs`，**不做静默降级**（缺依赖直接报告，避免污染分布）。

## 组件契约：可控编辑的基石

模板只固定**结构语义与编辑边界**，CSS/配色/字体/内容仍可多样化。HTML/SVG 组件必须遵循：

```html
<main data-role="canvas" data-id="canvas" data-edit="locked">
  <h1 data-role="title" data-id="title"
      data-edit="replaceable" data-field="title">...</h1>
  <section data-role="content" data-id="content" data-edit="locked">...</section>
</main>
```

- `data-role` 表语义；`data-id` 全页唯一且**跨编辑稳定**；
- `data-edit=locked` 的布局容器不可被局部编辑；
- `data-edit=replaceable` 必须同时声明 `data-field`，只允许替换其内容；
- `validate_component_contract` 校验必需角色、唯一 ID、合法编辑模式，并按 `info_density` 校验信息单元数量；
- 渲染 metadata 保存每个组件的 CSS bbox / 输出像素 bbox，以及 **locked signature**（锁定结构指纹）。

## 局部编辑与 before/after 双重一致性

白名单算子：`replace_text`、`replace_kpi`、`swap_icon`、`recolor_token`。算子**拒绝修改 locked 组件**，
避免把「局部改文案」退化成整页重生成。triplet 生成 `before/after` 的 html/png/json，一致性做两次独立检查：

1. **DOM/源代码级**：除 allow-list 目标外其他组件不可变化；locked signature 必须一致。
2. **像素级**：差异像素只能落在目标组件前后 bbox 的并集内；布局漂移、字体变化、误改其他卡片都会失败。

> 这是「像素级完美对齐编辑三元组」的**可验证**实现：mask 来自 DOM bbox，一致性有客观判据。

## 自动交叉验证：源码 ↔ DOM ↔ OCR ↔ 像素

从多个独立视角核对，避免只信一个笼统的 `qc_pass`：

- prompt 的 `required_texts` 是否**同时**存在于源代码和浏览器 DOM 文本；
- 提供 OCR 输出时再校 OCR 文字（接口已留，引擎可后接）；
- 所有文字 bbox 是否落在 viewport 内；
- 模板样本组件契约是否通过；
- editing 样本非编辑区像素是否不变（`compare_rendered_images`）。

单样本 metadata 写 `cross_validation`；`summary.json` 汇总 `cross_validation` 与 `component_contract` 的
`coverage_rate / pass_rate`。

## DOM 级 QC 门禁

`qc_pass` = **所有规则同时通过**（拒绝采样式过滤）：

- **基础**：渲染成功、无 page/console error、无外网请求、非空白、无横纵 overflow、无越界元素、字号 ≥12px、
  只用注入字体、字体就绪。
- **v2 新增**（仅当样本带对应字段时触发，旧数据不受影响）：`icon_svg_count` 达档位下限；
  按 `info_density` 的文本节点数/可见字符数下限；模板样本的组件契约与交叉验证通过。

metadata 额外记录 `canvas_id`、`info_density`、`iconography`、`layout_signature`、`component_nodes`、`cross_validation` 等。

## 代码模块地图

| 模块 / 文件 | 职责 |
|-------------|------|
| `prompt/style_sampler.py` | 分层 style 采样、分层配额 |
| `prompt/builder.py` | 拼 user prompt、写 prompt row |
| `prompt/templates.py` | 规范化骨架模板库、按密度选模板 |
| `configs/pipeline.yaml` | 画布定义与渲染几何 |
| `render/code.py` | 多 code mode 分发、LaTeX 安全校验/编译 |
| `render/html.py` | HTML/SVG 渲染、DOM 级 QC、组件 bbox 采集 |
| `contracts/components.py` | 组件契约解析/校验、locked signature |
| `editing/operations.py` | 白名单编辑算子、一致性判定 |
| `editing/triplet.py` | before/after 三元组生成与像素校验 |
| `validation/cross.py` | 源码↔DOM↔OCR↔像素交叉验证 |
| `bakeoff/{client,runner}.py` | system prompt/源码抽取、生成→渲染→汇总 |
| `scripts/gen_style_prompts.py` | 批量生成 v2 prompts |

## 实测与验收

- v2 30 条小样：画布 hd 11 / square 10 / 43 4 / wide 3 / portrait 2；信息量 high 11 + dense 8 = **63%**（≥50% 达标）。
- 多样性指标：画布/信息量直方图贴合权重、`layout_signature` 去重率、`icon_svg_count` 中位数显著高于旧版。

## 后续品类扩展（同一内核）

只要存在确定性「源码→图像」编译器，就能复用「契约 + 算子 + 交叉验证」内核，只换渲染后端与结构解析器：

| 能力 | HTML/SVG（已有） | LaTeX 文档/表格 | 真实静态网站 |
|------|-----------------|----------------|-------------|
| 渲染后端 | Playwright | XeLaTeX/Typst + GS | Playwright（净化后） |
| 结构契约 | `data-role/id/edit` | 环境/单元格 id 映射 | 从真实 DOM 反标注 id |
| 编辑算子 | text/kpi/icon/color | +replace_cell/insert_row | 同 HTML + 资源替换 |
| 一致性校验 | DOM diff + 像素 | PDF 文本层 + 像素 | DOM diff + 像素 |
| 标签来源 | DOM bbox | PDF 文本层 bbox | DOM bbox |

- **文档/表格**：改单元格/增删行/换表头/换主题色，重编译即得 before/after；标签来自源码 + PDF 文本层。
- **真实网站**：抓静态页 → 本地化净化（内联 CSS、下线外链、去脚本、快照资源）→ 渲染 before → 受控编辑得 after，
  引入真实世界版式分布。

> **一句话：** v2 用「分层 style 采样 + 多画布 + 信息量四级」把多样性做成可采样、可验收的控制面，
> 用「组件契约 + 白名单算子 + DOM/像素双重校验 + 源码↔DOM↔OCR↔像素交叉验证」把编辑一致性做成有客观判据的流程，
> 同一内核可增量扩到 LaTeX 文档/表格与真实网站编辑。
