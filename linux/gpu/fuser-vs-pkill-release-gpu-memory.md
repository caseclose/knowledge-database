# 为什么 `pkill -f` 不如 `fuser -k /dev/nvidia*` 好用？

> 创建时间：2026-07-13 ｜ 最新更新：2026-07-13

## 现象

执行：

```bash
pkill -f python
```

Python 进程已经退出，但 `nvidia-smi` 仍显示 GPU 显存未释放。

而执行：

```bash
fuser -k -9 /dev/nvidia*
```

显存立即恢复。

## 原因

`pkill -f` 是**按进程名**杀进程：

```
python -> kill(pid)
```

如果还有子进程、CUDA Context 或其他进程仍持有 GPU 设备，显存不会立即释放。

而 `fuser` 是**按设备文件**查找进程：

```bash
fuser -v /dev/nvidia*
```

它会找出所有仍打开 `/dev/nvidia*` 的进程，并统一杀掉：

```
打开 /dev/nvidia* 的进程
        ↓
kill -9
        ↓
CUDA Context 被回收
        ↓
GPU 显存释放
```

## 什么时候用？

正常结束程序：

```bash
pkill -9 -f python
```

如果显存仍未释放：

```bash
fuser -v /dev/nvidia*
```

查看是谁还占着 GPU。

最后强制清理：

```bash
fuser -k -9 /dev/nvidia*
```

## 总结

| 命令 | 原理 | 是否一定释放 GPU |
|------|------|-----------------|
| `pkill -f` | 按进程名杀进程 | ❌ 不一定 |
| `kill PID` | 杀指定 PID | ❌ 不一定 |
| `fuser -k /dev/nvidia*` | 杀所有占用 GPU 设备的进程 | ✅ 基本可以 |

> **一句话：** `pkill` 杀的是进程，`fuser` 杀的是**仍然占用 GPU 设备文件的进程**，因此在 GPU 显存无法释放时，`fuser` 更可靠。
