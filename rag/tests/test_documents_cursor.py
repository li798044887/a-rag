from datetime import datetime

from app.documents_service import decode_cursor, encode_cursor


def test_cursor_roundtrip():
    ts = datetime(2026, 5, 31, 12, 34, 56)
    token = encode_cursor(ts, "doc-123")
    got_ts, got_id = decode_cursor(token)
    assert got_ts == ts
    assert got_id == "doc-123"


def test_cursor_is_opaque_urlsafe():
    token = encode_cursor(datetime(2026, 1, 1), "id|with|pipes")
    assert "|" not in token  # base64url 化されており生の区切りが露出しない
    _, got_id = decode_cursor(token)
    assert got_id == "id|with|pipes"
