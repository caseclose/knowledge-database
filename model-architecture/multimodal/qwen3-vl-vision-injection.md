# Qwen3-VL 是怎么把图片信息放进 LLM 的？

面试常问「VLM 里图像特征到底怎么喂给语言模型」。Qwen3-VL 的答案不是「简单拼到开头」，而是 **ViT → MLP merger → 按层注入（DeepStack）**，并配 interleaved-MRoPE 处理位置。

## 整体管线

```
图像/视频 ──► Vision Encoder (ViT, 原生分辨率) ──► 多层特征
                                                     │
                                       MLP Merger（2×2 patch 合并压缩）
                                                     │
                                       ┌─────────────┴──────────────┐
                                 (常规) 视觉 token 拼进输入序列   (DeepStack) 残差注入 LLM 前几层
                                                     │
                                              LLM Decoder（Qwen3 backbone）
```

Qwen3-VL 有 dense（2B/4B/8B/32B）与 MoE（30B-A3B / 235B-A22B）多个规格，均建立在 Qwen3 语言骨干上。

## 三个关键设计

### 1. Vision-Language Merger：压缩 token 数

沿用 Qwen2.5-VL 的做法，用**两层 MLP** 把相邻 **2×2 的视觉 patch 合并成 1 个 token**，在把视觉 token 送进 LLM 前先降低数量，控制序列长度。视觉 token 长度随原生分辨率可变，文本 token 定长。

### 2. DeepStack：多层视觉特征按层残差注入

传统 VLM 把**所有**视觉 token 一次性塞进 LLM 的**第 0 层**。Qwen3-VL 借鉴 DeepStack：

- 从 ViT 的**三个不同中间层**分别取视觉特征（涵盖低层纹理到高层语义）；
- 每一层特征过**各自专用的 merger**；
- 以**残差相加**的方式，注入 LLM 的**前 3 层**对应 hidden states。

好处：多层次视觉信息融合更充分，且**不增加上下文长度**（是残差加法而非拼接更多 token）。

### 3. Interleaved-MRoPE：更均衡的位置频谱

Qwen2.5-VL 的 MRoPE 把维度按 **t / h / w**（时间/高/宽）分块，导致某一轴（如时间）落在高频区、频谱不均衡，损害长视频理解。Qwen3-VL 改为 **interleaved-MRoPE**：把 t、h、w 均匀交错分布到低频与高频各段，位置表示更忠实，长视频更强。

> 另外 Qwen3-VL 用**显式时间戳 token** 标记视频帧组（取代 Qwen2.5-VL 靠位置编码对齐绝对时间），并把训练损失从 per-sample 改为按 token 数开方归一化，更好平衡文本与多模态数据。

## 总结

| 组件 | 作用 |
|------|------|
| Vision Encoder (ViT) | 原生分辨率提特征，输出可变长视觉 token |
| MLP Merger | 2×2 patch 合 1 token，压缩序列 |
| DeepStack | ViT 三个中间层 → 残差注入 LLM 前 3 层，多层融合、不增长上下文 |
| Interleaved-MRoPE | t/h/w 均匀交错，频谱均衡，利于长视频 |

> **一句话：** Qwen3-VL 用 merger 压缩视觉 token，再借 DeepStack 把 ViT 多层特征以残差方式注入 LLM 前几层（而非只塞第 0 层），配合 interleaved-MRoPE 编码空间/时间位置，实现高效且多层次的图文融合。
