# 文生图「渲染文字」评测怎么做：双 OCR 管线 + 指标体系

## 背景

文生图模型（DALL-E、Qwen-Image 等）生成的图片中常包含文字。如何量化评估这些文字的准确率？

核心思路：用 OCR 从生成图中提取文字，与真值文本对比，计算匹配指标。但单一 OCR 有盲区，因此采用**双管线交叉验证**。

## 方案：双 OCR 管线

| 维度 | 内部 OCR 服务 (Astra) | TextPecker (vLLM) |
|------|----------------|-------------------|
| 引擎 | 内部 OCR 服务（protobuf） | VLM 推理（InternVL3-8B / Qwen3VL-8B） |
| 部署 | 远程服务，无需本地 GPU | 本地 vLLM，需 GPU |
| 并发 | `asyncio.Semaphore` + 异步锁 | `ThreadPoolExecutor` + `AsyncOpenAI` |
| 识别失败处理 | 无（纯 OCR） | 用 `<#>` 标记无法识别的字符 |
| 断点续传 | 按 JSONL 已有 id 跳过 | 同上 |
| 重试 | 无 | 3 次指数退避（5s/10s/20s） |

两条管线独立运行，各自产出指标 JSON，最终在看板上并排对比。

## 指标体系

所有指标在 `metrics/recalc_metrics.py` 中实现，NED = 归一化编辑距离。

### 内部 OCR 指标（5 个）

| 指标 | 含义 | 计算 |
|------|------|------|
| `edit_sim` | 文本相似度 | 全排列找最优段序，取 `1 - min(NED)` |
| `sen_acc` | 句级精确匹配率 | Hungarian 匹配后，完全相等的比例 |
| `char_F1` | 字符 F1 | multiset 交集（**无序**） |
| `char_P` | 字符精确率 | TP / (TP + FP) |
| `char_R` | 字符召回率 | TP / (TP + FN) |

### TextPecker 指标（5 个）

| 指标 | 含义 | 计算 |
|------|------|------|
| `pecker_qua` | 质量分 | `1 - count('#') / total_chars` |
| `pecker_gned` | 分组归一化编辑距离 | Hungarian 匹配 token 后 `1 - 总NED / max(n_pred, n_gt)` |
| `char_F1` | 字符 F1 | Levenshtein 回溯对齐（**有序**） |
| `char_P` | 字符精确率 | TP / (TP + FP) |
| `char_R` | 字符召回率 | TP / (TP + FN) |

### 关键区别

两条管线的 `char_F1` 实现完全不同：
- **内部 OCR**：multiset Counter 交集，完全忽略字符顺序
- **TextPecker**：Levenshtein 编辑对齐，区分替换/插入/删除，且枚举所有分段组合方式取最优

## 评测流程

```bash
# 1. 内部 OCR 评测（无需 GPU）
bash run_eval_with_wxgocr.sh --image_dir /path/to/images --model_version Qwen-Image

# 2. TextPecker 评测（需 GPU）
# Terminal 1: 先起 vLLM
bash deploy_textpecker_server.sh internvl
# Terminal 2: 跑评测
bash run_eval_with_textpecker.sh --image_dir /path/to/images --model_version Qwen-Image --gpus 0,1,2,3

# 3. 启动看板对比
bash run_dashboard.sh
# 浏览器打开 http://localhost:8080/dashboard.html
```

看板自动扫描 `dashboard/` 下的指标 JSON，支持按 `type`（文字类型）、`char_count`（长度）、`difficulty_level`（难度）三个维度分组对比。

## 工程细节

| 问题 | 解法 |
|------|------|
| protobuf ≥4 与旧 protoc 不兼容 | `PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python` |
| conda 迁移后 shebang 失效 | 直接 PATH 注入，不用 `conda activate` |
| ms-swift editable install 指向已删目录 | PYTHONPATH 注入新源码目录 |
| 分段组合爆炸 | `C(n,k) > 5000` 时回退为简单拼接 |
| vLLM tensor parallelism | 必须整除 28（注意力头数）：{1,2,4,7,14} |

## 总结

| 要点 | 说明 |
|------|------|
| 双管线交叉验证 | 传统 OCR + VLM 推理，互补盲区 |
| 指标分两套 | 内部 OCR 无序匹配，TextPecker 有序对齐 |
| 断点续传 | 流式写入 JSONL，崩溃只丢当前批次 |
| 看板自动发现 | 扫盘 `wegen_text_{OCR}_{model}.json`，无需手动注册 |

> **一句话：** 用 内部 OCR 和 TextPecker 两条 OCR 管线分别从文生图结果中提取文字，与真值对比计算 edit_sim / char_F1 等指标，看板并排对比多模型渲染文字能力。
