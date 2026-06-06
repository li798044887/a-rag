import logging
import os
from pathlib import Path

from app.parsing.types import ParsedBlock

logger = logging.getLogger(__name__)


# プロジェクトがサポートする全言語を OCR 対象にする。
# ユーザーの UI 言語に関わらず、文書内の全文字を認識する。
_OCR_LANGS = ["ch_sim", "en", "ja"]
_DEFAULT_MODEL_DIR = Path.home() / ".cache" / "easyocr" / "model"

_reader = None


def _build_ocr():
    """EasyOCR Reader インスタンスを取得（モジュールレベルでキャッシュ）。"""
    global _reader
    if _reader is None:
        import easyocr
        model_dir = Path(os.getenv("EASYOCR_MODEL_DIR", str(_DEFAULT_MODEL_DIR))).expanduser()
        model_dir.mkdir(parents=True, exist_ok=True)
        _reader = easyocr.Reader(_OCR_LANGS, model_storage_directory=str(model_dir))
    return _reader


def ocr_images(
    blocks: list[ParsedBlock],
    images_dir: str,
    ocr=None,
) -> list[ParsedBlock]:
    """image 型ブロックの画像に対し OCR を実行し ocr_text に書き込む。

    ocr が未指定の場合は EasyOCR Reader を生成する（中日英 3 言語）。
    単一画像の OCR 失敗はログに残してスキップし、後続は続行する。
    """
    image_blocks = [b for b in blocks if b.type == "image" and b.image_path]
    if not image_blocks:
        return blocks

    if ocr is None:
        try:
            ocr = _build_ocr()
        except Exception:
            logger.warning("OCR initialization failed; skipping image OCR", exc_info=True)
            return blocks

    base = Path(images_dir)

    for b in image_blocks:
        img_path = base / b.image_path
        if not img_path.is_file():
            logger.warning("OCR: image file not found: %s", img_path)
            continue
        try:
            result = ocr.readtext(str(img_path))
            lines: list[str] = []
            for (_bbox, text, _conf) in result:
                if text.strip():
                    lines.append(text.strip())
            if lines:
                b.ocr_text = "\n".join(lines)
        except Exception:
            logger.warning("OCR failed for %s", img_path, exc_info=True)

    return blocks
