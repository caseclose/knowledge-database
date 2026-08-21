# MMDiT 结构：为什么用 joint attention 取代 cross-attention？

> 创建时间：2026-08-20 ｜ 最新更新：2026-08-20

MMDiT（MultiModal Diffusion Transformer）是 Stable Diffusion 3 提出、FLUX / CogVideoX / HunyuanVideo 等广泛沿用的文生图/视频骨干。它把「文本引导图像生成」从 U-Net + cross-attention 的老范式，换成了纯 Transformer + **联合自注意力（joint attention）**。

## 背景：从 U-Net 到 MMDiT

| 阶段 | 代表 | 文本注入方式 |
|------|------|-------------|
| U-Net 时代 | SD1 / SDXL | 卷积 U-Net，文本经 **cross-attention** 单向注入图像 |
| DiT | Peebles & Xie 2023 | Transformer 骨干，条件仍靠 cross-attention / adaLN |
| MMDiT | SD3 / FLUX | 双流 Transformer，文本与图像做 **joint self-attention**，双向交互 |

cross-attention 的信息流是单向的（text → image），文本只能「被查询」，无法反过来根据图像调整表示。MMDiT 让两种模态在同一个注意力里互相看见。

## 结构原理

### 1. 双流（dual-stream）、各自独立权重

文本 token 和图像 patch token 在概念上差异很大，所以 MMDiT 为两种模态**各用一套权重**（QKV 投影、MLP、LayerNorm/adaLN 都分开）。等价于「两个独立 Transformer」，但在注意力那一步把两条序列拼起来。

```
text tokens ──►[text 权重: proj/MLP]──┐
                                      ├──► 拼接 ──► joint self-attention ──► 拆分回各自流
image tokens ─►[image 权重: proj/MLP]─┘
```

### 2. Joint self-attention：一次自注意力，四块交互

把长度可变的图像 token（随分辨率变化）与定长的文本 token 拼成一条序列做**自注意力**，注意力矩阵天然分成 4 块：

```
              key: image        key: text
query: image [ image→image ] [ image→text ]
query: text  [ text→image  ] [ text→text  ]
```

- 对角两块是各模态内部自注意力；
- 非对角两块实现**双向跨模态**交互（既有 text→image，也有 image→text）。

这带来了 SD3 强调的更好的**文字拼写 / 排版 / 图文语义绑定**能力。

### 3. AdaLN 调制注入时间步

扩散的 timestep（及池化后的全局文本/类别向量）通过 **adaLN-Zero** 生成每层的 scale/shift/gate，对两条流的 LayerNorm 做调制，控制去噪强度。它承担「条件」中的全局部分，细粒度语义则交给 joint attention。

### 4. 编码器与训练目标

- 文本：SD3 用 **CLIP×2 + T5-XXL** 三个编码器拼接；
- 图像：改进的 **VAE** 编码到 latent，patch 化成 token；
- 目标：在 latent 上做 **rectified flow / flow matching**（不是传统 DDPM 的 ε 预测）。

## 总结

| 要点 | 说明 |
|------|------|
| 核心改动 | cross-attention → joint self-attention |
| 双流 | 图像/文本各自独立权重，仅在注意力处拼接 |
| 交互 | 注意力矩阵 4 块，跨模态**双向** |
| 条件 | 全局条件走 adaLN-Zero，语义走 joint attention |
| 落地 | SD3、FLUX、CogVideoX、HunyuanVideo |

> **一句话：** MMDiT 用「双流独立权重 + 拼接后联合自注意力」替代单向 cross-attention，让文本和图像在同一注意力里双向对齐，从而显著提升图文一致性与文字渲染。
