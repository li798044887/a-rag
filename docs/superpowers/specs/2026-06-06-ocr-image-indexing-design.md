# OCR 图片索引 — 设计文档

**日期**: 2026-06-06
**状态**: 已确认

## 问题

MinerU 解析 PDF/Office 文档时，嵌入的图片被归类为 `type="image"`。当前 `worker.py:87` 将 `block_type="image"` 的 chunk 全部排除在向量索引之外，导致图片中的文字信息（截图、扫描件中的文字）无法被检索命中。

## 目标

对 MinerU 提取出的图片执行 OCR，将识别文字作为独立 chunk 参与 Embedding 和 Qdrant 索引，使图片中的文字可被检索。

## 设计

### 整体流程

```
上传文档 (PDF/Word/PPT/Excel/Image)
  → MinerU 解析 (content_list.json + images/)
  → Copy Assets (images/ → _assets/images/)
  → OCR (PaddleOCR 识别每张图片中的文字) [新增]
  → Chunk (image → image chunk + image_ocr chunk)
  → Embed → Qdrant (image_ocr 参与索引，image 保留在 PG 不参与)
```

### OCR 引擎

- **引擎**: PaddleOCR
- **语言**: `ocr_lang: str = "ch"`（默认中文，可配置）
- **调用时机**: `copy_assets` 之后、`chunk_blocks` 之前
- **失败策略**: 单张图片 OCR 失败不影响整体，记录 warning 并跳过

### ParsedBlock 新增字段

```python
@dataclass
class ParsedBlock:
    # ... 已有字段 ...
    ocr_text: str | None = None  # 新增：OCR 识别结果
```

### 新增文件: `rag/app/parsing/ocr.py`

```python
def ocr_images(blocks: list[ParsedBlock], images_dir: str) -> list[ParsedBlock]:
    """image 型 block に対し PaddleOCR を実行し ocr_text に書き込む"""
```

### Chunker 改动

image block 的处理逻辑：

```
image block (ocr_text 有值)
  → Chunk(block_type="image", text="![](images/x.jpg)")     # 原有，展示用
  → Chunk(block_type="image_ocr", text=ocr_text)             # 新增，参与索引

image block (ocr_text 为空)
  → Chunk(block_type="image", text="![](images/x.jpg)")     # 原有行为不变
```

### Worker 改动

`worker.py` 的过滤逻辑无需改动。`block_type != "image"` 自动允许 `"image_ocr"` 参与索引。

在 `copy_assets` 之后、`chunk_blocks` 之前插入：

```python
blocks = ocr_images(blocks, images_dir=assets_dir)
```

### 配置

```python
# config.py
ocr_lang: str = "ch"
```

OCR 默认启用，不作为可选功能。不需要 `ocr_enabled` 开关。

### 依赖

- `paddlepaddle` (CPU 版)
- `paddleocr`

### 适用文件类型

所有经过 MinerU 的文件类型均生效：`.pdf`、`.docx`、`.pptx`、`.xlsx`、`.png`、`.jpg`、`.jpeg`。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `rag/app/config.py` | 新增 `ocr_lang` |
| `rag/app/parsing/types.py` | `ParsedBlock` 新增 `ocr_text` 字段 |
| `rag/app/parsing/ocr.py` | **新文件** — PaddleOCR 封装 |
| `rag/app/chunking/chunker.py` | image block → image_ocr chunk |
| `rag/app/worker.py` | 编排：copy_assets 后调用 OCR |
| `rag/pyproject.toml` | 新增依赖 |
| `rag/Dockerfile` | PaddleOCR 系统依赖 |
| `rag/tests/` | 单元测试 + 集成测试 |

## 错误处理

| 场景 | 处理 |
|------|------|
| 单张图片 OCR 失败 | warning 日志，跳过该图片 |
| PaddleOCR 模型未缓存 | 首次运行时自动下载，worker 启动时预热 |
| 图片文件损坏/格式异常 | 捕获异常，跳过 |
| OCR 结果为空 | 不生成 image_ocr chunk |

## 不做的事情

- 不引入 VLM 对图片内容做语义描述
- 不引入多模态 Embedding
- 不对 caption 做独立索引（caption 已在 image chunk 的 text 中，用户后续可叠加）
- 不并行 OCR（CPU 资源有限）
