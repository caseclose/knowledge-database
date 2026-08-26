# CFG（Classifier-Free Guidance）是什么？

> 创建时间：2026-08-26 ｜ 最新更新：2026-08-26 ｜ 标签：面试

CFG 是 **Classifier-Free Guidance**（Ho & Salimans, 2022），文生图 / 视频扩散模型推理时几乎必开的「把提示词拧紧」的手法。名字里的 classifier-free：不再另训一个噪声图分类器，**同一套去噪网络**既做有条件预测、也做无条件预测，采样时把两者的差放大。

它管的是**采样**，不是换骨干。U-Net 时代的 SD1.5 / SDXL 和 Transformer 时代的 [MMDiT](/model-architecture/diffusion-transformer/mmdit-structure.md) / FLUX 用的是同一套线性外推。

## 先有分类器引导，才有「无分类器」

条件生成想采的是 $p(x\mid c)$。扩散模型学的是噪声（或速度）预测 $\varepsilon_\theta(x_t,t,c)$，对应分数 $\nabla_{x_t}\log p(x_t\mid c)$。

更早的 **classifier guidance** 另训一个在噪声图 $x_t$ 上工作的分类器 $p_\phi(c\mid x_t)$，把

$$
\nabla_{x_t}\log p(x_t\mid c)
=\nabla_{x_t}\log p(x_t)+\nabla_{x_t}\log p(c\mid x_t)
$$

里的第二项用分类器梯度补上。能加强条件，但要多一个模型、分类器还得适应各种噪声水平，工程重，还容易被梯度钻空子。

CFG 的观察：Bayes 下 $\nabla\log p(c\mid x_t)=\nabla\log p(x_t\mid c)-\nabla\log p(x_t)$。只要同一个网络既能算有 $c$ 的分数、也能算无条件分数，**差向量就是隐含分类器**，不必真去训 $p(c\mid x)$。

## 训练：随机丢掉条件

训练时以概率 $p_{\mathrm{uncond}}$（常见 10%）把文本 / 类别换成空条件 $\varnothing$（空串、零 embedding、学出来的 null token）：

$$
c'=\begin{cases}
\varnothing & \text{以 }p_{\mathrm{uncond}}\\
c & \text{否则}
\end{cases}
$$

网络照常对 $(x_t,t,c')$ 做去噪 loss。于是一个 $\varepsilon_\theta$ 同时逼近 $\varepsilon(x_t,c)$ 和 $\varepsilon(x_t,\varnothing)$。这是预训练配方里的标准开关，不是后训练才加的模块。

## 推理：把「有条件 − 无条件」放大

每一步对**同一份** $x_t$ 跑两次前向：

$$
\tilde{\varepsilon}
=\varepsilon_\theta(x_t,\varnothing)
+s\bigl(\varepsilon_\theta(x_t,c)-\varepsilon_\theta(x_t,\varnothing)\bigr)
$$

也常写成 $\tilde{\varepsilon}=(1-s)\,\varepsilon_{\mathrm{uncond}}+s\,\varepsilon_{\mathrm{cond}}$。$s$ 就是 guidance scale（界面上的 CFG scale）。

| $s$ | 行为 |
|-----|------|
| $0$ | 纯无条件，无视提示词 |
| $1$ | 普通条件预测，不外推 |
| $>1$ | 沿 $(\varepsilon_{\mathrm{cond}}-\varepsilon_{\mathrm{uncond}})$ 再走一段，**更听 prompt、多样性下降** |

$s>1$ 是在数据分布外做线性外推：图更「像那句话」，饱和度、对比度往往被抬高；太大就过饱和、肢体崩、多样性塌。

Flow matching / rectified flow（SD3、FLUX）对速度 $v$ 做同样的组合：

$$
\tilde{v}=v_\varnothing+s(v_c-v_\varnothing)
$$

负向提示（negative prompt）是把 $\varnothing$ 换成 $c_{\mathrm{neg}}$：从「不要什么」指向「要什么」再乘 $s$。

## 代价和常用坑

- **算力 ×2**：每步 cond + uncond 各一次。蒸馏（guidance distillation）、少步采样、只在中间噪声段开 CFG，都是为了砍这倍。
- **尺度因模型而异**：SD1.5 常 7–12；SDXL 偏低（大约 4–7）；FLUX 一类 flow 模型更低，有的蒸馏权重把 CFG 烤进网络，推理 $s$ 接近 1。
- **不是 loss 项**：训练只是随机 drop 条件；$s$ 只出现在采样。面试里不要说「CFG loss」。

## 总结

| | Classifier guidance | CFG |
|--|---------------------|-----|
| 额外分类器 | 要，还得吃噪声图 | 不要 |
| 训练 | 去噪模型 + 分类器 | 去噪模型，条件以小概率变成 $\varnothing$ |
| 推理 | 去噪方向 + $\nabla\log p(c\mid x_t)$ | $\varepsilon_\varnothing+s(\varepsilon_c-\varepsilon_\varnothing)$ |
| 作用 | 加强 $p(x\mid c)$ | 同目标，隐含分类器由两次前向给出 |

> **一句话：** CFG 让扩散模型训练时偶尔丢掉条件，推理时用 $\varepsilon_{\mathrm{uncond}}+s(\varepsilon_{\mathrm{cond}}-\varepsilon_{\mathrm{uncond}})$ 把「听提示词」的方向放大；$s=1$ 是普通条件生成，$s>1$ 更跟 prompt、图更冲、多样性更少。
