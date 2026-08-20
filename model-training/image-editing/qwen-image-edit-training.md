# Qwen-Image-Edit 是怎么训练出编辑能力的？

Qwen-Image-Edit 是在 20B 的 Qwen-Image（MMDiT 文生图模型）之上扩展出的图像编辑模型。它的编辑能力不是靠额外的 ControlNet，而是靠**双编码输入 + 多任务训练对齐潜空间**。

## 骨干：复用 Qwen-Image 的 MMDiT

Qwen-Image 由三部分组成：**Qwen2.5-VL**（文本/多模态条件）+ **VAE**（图像 token 化）+ **MMDiT** 骨干做联合建模。Qwen-Image-Edit 直接继承这套骨干，并把 Qwen-Image 强大的**文字渲染**能力延伸到编辑（可精准改图中文字、保留字体字号）。

## 核心设计一：双编码（dual encoding）

编辑的难点是「既要按指令改，又要不该动的地方别动」。Qwen-Image-Edit 把输入图**同时**送进两条编码路径：

| 编码路径 | 提取什么 | 控制什么 |
|---------|---------|---------|
| **Qwen2.5-VL** | 高层**语义**特征（物体身份、关系、场景） | 语义一致性（如换姿势仍是同一个物体/IP） |
| **VAE Encoder** | 低层**重建/外观**特征（颜色、纹理、光照） | 视觉保真（未修改区域像素级保持） |

两路 latent 在 MMDiT 的 **image 流里拼接**，让模型在「语义可控」和「外观保真」之间取得平衡。这就是它既能做**外观编辑**（增删改元素、其余不变）又能做**语义编辑**（IP 创作、物体旋转、风格迁移、novel view synthesis）的原因。

## 核心设计二：多任务训练对齐潜空间

只喂编辑数据不够，关键是让 Qwen2.5-VL 的语义潜空间和 VAE 的重建潜空间**对齐**。Qwen-Image 采用改进的多任务范式：

- **T2I**（text-to-image）：保住基础生成与文字渲染；
- **TI2I**（text-image-to-image）：文本 + 图像 → 图像，正是编辑任务形态；
- **I2I**（image-to-image 重建）：显式对齐 Qwen2.5-VL 与 VAE/MMDiT 的表示。

三类任务共同训练，把两个编码器的潜空间拉到同一坐标系，编辑一致性显著提升。

## 其他要点

- **MSRoPE 加 frame 维**：多模态可扩展 RoPE 增加一个 frame 维度区分「编辑前 / 编辑后」两张图，支撑 TI2I。
- **VAE 在富文本数据上微调**：重建 PSNR 在文本密集图上达 36.63，优于 FLUX-VAE / SD3.5-VAE，是文字编辑清晰的基础。
- **训练流程**：flow matching 预训练（Producer-Consumer 框架扩展）→ SFT →**偏好对齐（DPO / GRPO）**；编辑专项还引入 novel view synthesis、深度估计（DepthPro 作 teacher）等任务。

## 总结

| 环节 | 做法 |
|------|------|
| 骨干 | 复用 20B Qwen-Image（Qwen2.5-VL + VAE + MMDiT） |
| 输入 | 双编码：VL 出语义 + VAE 出外观，image 流拼接 |
| 训练 | T2I + TI2I + I2I 多任务对齐潜空间 |
| 位置编码 | MSRoPE 加 frame 维区分编辑前后 |
| 后训练 | flow matching → SFT → DPO/GRPO 偏好对齐 |

> **一句话：** Qwen-Image-Edit 让输入图同时过 Qwen2.5-VL（语义）和 VAE（外观）双编码并在 MMDiT 里拼接，再用 T2I/TI2I/I2I 多任务把两个潜空间对齐，从而兼顾「按指令改」与「不该动的别动」。
