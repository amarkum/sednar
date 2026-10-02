"""Accounts for the Sednar public demo: sign up with an email and password, or with GitHub; log in; delete.

Users live in SQLite (SEDNAR_PUBLIC_DB, by default accounts.sqlite3 in SEDNAR_PUBLIC_ROOT) with scrypt
password hashes. What a user saves that is secret, their API keys, is encrypted with AES-GCM. For a password
account the key comes from the password, so the server can read it only while that user is logged in. A
GitHub account has no password, so its key comes from the server's secret and the user's salt: a copy of
the database alone still does not reveal it.

A GitHub account is found by its GitHub user id and is never joined to a password account with the same
email, because anyone can sign up with an email they do not own.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from typing import Any

from werkzeug.security import check_password_hash, generate_password_hash

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,63}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 200

_lock = threading.Lock()
_path = ""
# Checked against when an email is unknown, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = generate_password_hash("sednar-public-demo")


class AccountError(ValueError):
    pass


def configure(path: str) -> None:
    global _path
    _path = path
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with _connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            " id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,"
            " key_salt BLOB NOT NULL, secrets BLOB, created_at REAL NOT NULL, last_login REAL,"
            " github_id INTEGER, github_login TEXT)"
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        for column, kind in (("github_id", "INTEGER"), ("github_login", "TEXT")):
            if column not in columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {column} {kind}")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_github_id ON users (github_id) WHERE github_id IS NOT NULL")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _connect() -> sqlite3.Connection:
    if not _path:
        raise RuntimeError("public_accounts.configure() was not called")
    return sqlite3.connect(_path, timeout=10)


def new_user_id(name: str) -> str:
    """A readable, unique id for a user's folder: their name as a slug and a random suffix, e.g. amar-3f9c1a2b."""
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")[:30].strip("-") or "user"
    return f"{slug}-{secrets.token_hex(4)}"


def normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def validate(email: str, password: str) -> None:
    if not EMAIL_RE.match(email):
        raise AccountError("Enter a valid email address.")
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"Use a password of at least {MIN_PASSWORD} characters.")
    if len(password) > MAX_PASSWORD:
        raise AccountError(f"Use a password of at most {MAX_PASSWORD} characters.")


def count() -> int:
    with _lock, _connect() as db:
        return int(db.execute("SELECT COUNT(*) FROM users").fetchone()[0])


def create(email: str, password: str) -> str:
    """The new user's id. AccountError when the email is taken or the details are not valid."""
    email = normalize_email(email)
    validate(email, password)
    user_id = new_user_id(email.split("@", 1)[0])
    try:
        with _lock, _connect() as db:
            db.execute(
                "INSERT INTO users (id, email, password_hash, key_salt, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, generate_password_hash(password), secrets.token_bytes(16), time.time()),
            )
    except sqlite3.IntegrityError:
        raise AccountError("An account with that email already exists. Log in instead.") from None
    return user_id


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    """The user's id, email and key salt when the password is right; None otherwise."""
    email = normalize_email(email)
    with _lock, _connect() as db:
        row = db.execute("SELECT id, email, password_hash, key_salt FROM users WHERE email = ?", (email,)).fetchone()
    if row is None or not row[2]:  # no such email, or a GitHub account (no password)
        check_password_hash(_DUMMY_HASH, password or "")
        return None
    if not check_password_hash(row[2], password or ""):
        return None
    with _lock, _connect() as db:
        db.execute("UPDATE users SET last_login = ? WHERE id = ?", (time.time(), row[0]))
    return {"id": row[0], "email": row[1], "key_salt": row[3]}


def github_account(github_id: int, login: str) -> dict[str, Any]:
    """The account for a GitHub user, created the first time they sign in."""
    with _lock, _connect() as db:
        row = db.execute("SELECT id, key_salt FROM users WHERE github_id = ?", (int(github_id),)).fetchone()
        if row is None:
            user_id = new_user_id(login)
            # Not an email address, so no email sign-up can take this account's place.
            db.execute(
                "INSERT INTO users (id, email, password_hash, key_salt, created_at, github_id, github_login)"
                " VALUES (?, ?, '', ?, ?, ?, ?)",
                (user_id, f"github:{int(github_id)}", secrets.token_bytes(16), time.time(), int(github_id), login),
            )
            row = db.execute("SELECT id, key_salt FROM users WHERE id = ?", (user_id,)).fetchone()
        db.execute("UPDATE users SET github_login = ?, last_login = ? WHERE id = ?", (login, time.time(), row[0]))
    return {"id": row[0], "key_salt": row[1], "github": login}


def account(user_id: str) -> dict[str, str]:
    """What the page shows for a user: their name, and whether they signed in with GitHub."""
    with _lock, _connect() as db:
        row = db.execute("SELECT email, github_login FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return {}
    if row[1]:
        return {"name": row[1], "github": row[1]}
    return {"name": row[0], "email": row[0]}


def email_of(user_id: str) -> str:
    return account(user_id).get("email", "")


def set_password(user_id: str, password: str) -> None:
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise AccountError(f"Use a password of {MIN_PASSWORD} to {MAX_PASSWORD} characters.")
    with _lock, _connect() as db:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash != ''",
                   (generate_password_hash(password), user_id))


def delete(user_id: str) -> None:
    with _lock, _connect() as db:
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))


def unlock_key(password: str, salt: bytes) -> bytes:
    """The key a user's secrets are encrypted with. Only their password gives it."""
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def server_key(secret: str, salt: bytes) -> bytes:
    """The key for a GitHub account's secrets: the server's secret, kept apart per user by their salt."""
    return hmac.new(secret.encode("utf-8"), b"sednar-public-secrets\0" + salt, hashlib.sha256).digest()


def load_secrets(user_id: str, key: bytes) -> dict[str, Any]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    with _lock, _connect() as db:
        row = db.execute("SELECT secrets FROM users WHERE id = ?", (user_id,)).fetchone()
    blob = row[0] if row else None
    if not blob:
        return {}
    try:
        data = json.loads(AESGCM(key).decrypt(blob[:12], blob[12:], user_id.encode("ascii")))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save_secrets(user_id: str, key: bytes, data: dict[str, Any]) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    blob = nonce + AESGCM(key).encrypt(nonce, json.dumps(data).encode("utf-8"), user_id.encode("ascii"))
    with _lock, _connect() as db:
        db.execute("UPDATE users SET secrets = ? WHERE id = ?", (blob, user_id))
