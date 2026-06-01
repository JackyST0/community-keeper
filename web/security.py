import base64
import hashlib
import hmac
import os
import secrets
import sys
from typing import Any, Optional



PBKDF2_ITERATIONS = 260_000
HASH_PREFIX = "pbkdf2_sha256"


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    if not password:
        raise ValueError("password cannot be empty")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return "$".join(
        [
            HASH_PREFIX,
            str(PBKDF2_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        prefix, iterations, salt_b64, digest_b64 = password_hash.split("$", 3)
        if prefix != HASH_PREFIX:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def configured_username() -> str:
    return os.environ.get("ADMIN_USERNAME", "admin").strip() or "admin"


def configured_password_hash() -> str:
    return os.environ.get("ADMIN_PASSWORD_HASH", "").strip()


def configured_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "").strip()


def require_auth_config() -> None:
    if not configured_password_hash() and not configured_password():
        raise RuntimeError(
            "ADMIN_PASSWORD_HASH or ADMIN_PASSWORD is not configured. Generate a hash with: "
            "python -m web.security 'your-password', or set ADMIN_PASSWORD for simple deployments."
        )


def verify_configured_password(password: str) -> bool:
    password_hash = configured_password_hash()
    if password_hash:
        return verify_password(password, password_hash)
    plain_password = configured_password()
    return bool(plain_password) and hmac.compare_digest(password, plain_password)


def is_authenticated(request: Any) -> bool:
    return request.session.get("authenticated") is True


def login_session(request: Any, username: str) -> None:
    request.session.clear()
    request.session["authenticated"] = True
    request.session["username"] = username


def logout_session(request: Any) -> None:
    request.session.clear()


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m web.security 'your-password'", file=sys.stderr)
        raise SystemExit(2)
    print(hash_password(sys.argv[1]))


if __name__ == "__main__":
    main()
