"""
Covers app/core/security.py after the python-jose -> PyJWT migration
(python-jose pulled in ecdsa, which carries an unfixed CVE — see
SECURITY_AUDIT.md). These checks confirm token issuance/verification and
password hashing still round-trip correctly under PyJWT.
"""

from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_access_token,
    verify_password,
    verify_refresh_token,
)


def test_access_token_round_trip():
    token = create_access_token(subject="user-1", role="student", college_id=42)
    payload = verify_access_token(token)

    assert payload is not None
    assert payload["sub"] == "user-1"
    assert payload["role"] == "student"
    assert payload["type"] == "access"
    assert payload["college_id"] == 42


def test_refresh_token_round_trip():
    token, jti, expiry = create_refresh_token(subject="user-1")
    payload = verify_refresh_token(token)

    assert payload is not None
    assert payload["type"] == "refresh"
    assert payload["jti"] == jti
    assert expiry is not None


def test_access_token_rejected_as_refresh_token():
    token = create_access_token(subject="user-1", role="student")
    assert verify_refresh_token(token) is None


def test_invalid_token_returns_none():
    assert verify_access_token("not-a-valid-jwt") is None


def test_password_hash_round_trip():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong password", hashed) is False
