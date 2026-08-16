"""
app/schemas/auth.py の単体テスト（Token モデル）。
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.auth import Token


def test_token_constructs_with_access_token_and_type() -> None:
    t = Token(access_token="jwt.abc.def", token_type="bearer")
    assert t.access_token == "jwt.abc.def"
    assert t.token_type == "bearer"


def test_token_serializes_round_trip() -> None:
    t = Token(access_token="x", token_type="bearer")
    d = t.model_dump()
    assert d == {"access_token": "x", "token_type": "bearer"}

    parsed = Token.model_validate(d)
    assert parsed == t


def test_token_rejects_missing_required_fields() -> None:
    with pytest.raises(ValidationError):
        Token()  # type: ignore[call-arg]
