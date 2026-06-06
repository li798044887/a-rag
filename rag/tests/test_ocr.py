from unittest.mock import MagicMock

from app.parsing.types import ParsedBlock
from app.parsing.ocr import ocr_images


def test_ocr_images_skips_non_image_blocks():
    blocks = [
        ParsedBlock(type="title", text="章", level=1, page=0),
        ParsedBlock(type="text", text="本文です。", page=0),
    ]
    result = ocr_images(blocks, images_dir="/fake/images")
    assert result == blocks


def test_ocr_images_writes_ocr_text_on_image_blocks(tmp_path):
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    img_path = img_dir / "a.png"
    img_path.write_bytes(b"\x89PNG\r\n")

    blocks = [
        ParsedBlock(type="image", image_path="images/a.png", caption="図1", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.readtext.return_value = [
        ([[0, 0], [100, 0], [100, 50], [0, 50]], "認識結果", 0.95),
    ]

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text == "認識結果"
    mock_ocr.readtext.assert_called_once_with(str(img_path))


def test_ocr_images_handles_missing_image_file(tmp_path):
    blocks = [
        ParsedBlock(type="image", image_path="images/nonexistent.png", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.readtext.side_effect = FileNotFoundError("no such file")

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text is None


def test_ocr_images_handles_empty_ocr_result(tmp_path):
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    (img_dir / "blank.png").write_bytes(b"\x89PNG\r\n")

    blocks = [
        ParsedBlock(type="image", image_path="images/blank.png", page=0),
    ]

    mock_ocr = MagicMock()
    mock_ocr.readtext.return_value = []

    result = ocr_images(blocks, images_dir=str(tmp_path), ocr=mock_ocr)

    assert result[0].ocr_text is None


def test_ocr_images_no_image_blocks_does_nothing(tmp_path):
    blocks = [ParsedBlock(type="text", text="hello", page=0)]
    result = ocr_images(blocks, images_dir=str(tmp_path))
    assert result == blocks
