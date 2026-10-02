"""Sign in with GitHub for the Sednar public demo, and the signed-in user's repositories.

Needs a GitHub OAuth app (github.com > Settings > Developer settings > OAuth Apps) whose callback URL is
<site>/auth/github/callback, given as SEDNAR_GITHUB_CLIENT_ID and SEDNAR_GITHUB_CLIENT_SECRET. Without
them the GitHub button is not shown. Public repositories need no extra permission; set
SEDNAR_GITHUB_PRIVATE_REPOS=1 to also ask for private ones (GitHub's `repo` scope).
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

import requests

CLIENT_ID = os.environ.get("SEDNAR_GITHUB_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("SEDNAR_GITHUB_CLIENT_SECRET", "").strip()
PRIVATE_REPOS = os.environ.get("SEDNAR_GITHUB_PRIVATE_REPOS", "").strip().lower() in ("1", "true", "yes")
AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API = "https://api.github.com"
TIMEOUT = (5, 20)


class GitHubError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET)


def scope() -> str:
    return "read:user repo" if PRIVATE_REPOS else "read:user"


def authorize_url(redirect_uri: str, state: str) -> str:
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": CLIENT_ID, "redirect_uri": redirect_uri, "scope": scope(), "state": state, "allow_signup": "true",
    })


def exchange_code(code: str, redirect_uri: str) -> str:
    """The access token for an authorization code."""
    resp = requests.post(TOKEN_URL, headers={"Accept": "application/json"}, timeout=TIMEOUT, data={
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code, "redirect_uri": redirect_uri,
    })
    token = (resp.json() if resp.ok else {}).get("access_token")
    if not token:
        raise GitHubError("GitHub did not sign you in. Try again.")
    return str(token)


def _get(token: str, path: str, **params: Any) -> Any:
    resp = requests.get(API + path, params=params or None, timeout=TIMEOUT, headers={
        "Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28",
    })
    if resp.status_code == 401:
        raise GitHubError("GitHub signed you out. Log in with GitHub again.")
    if not resp.ok:
        raise GitHubError(f"GitHub answered {resp.status_code}.")
    return resp.json()


def user(token: str) -> dict[str, Any]:
    data = _get(token, "/user")
    if not isinstance(data, dict) or not data.get("id") or not data.get("login"):
        raise GitHubError("GitHub did not say who you are.")
    return {"id": int(data["id"]), "login": str(data["login"]), "name": str(data.get("name") or "")}


def repos(token: str, limit: int = 100) -> list[dict[str, Any]]:
    """The user's repositories, most recently pushed first."""
    data = _get(token, "/user/repos", per_page=min(max(limit, 1), 100), sort="pushed",
                affiliation="owner,collaborator,organization_member")
    out = []
    for repo in data if isinstance(data, list) else []:
        if not isinstance(repo, dict) or not repo.get("clone_url"):
            continue
        out.append({
            "full_name": str(repo.get("full_name") or ""), "name": str(repo.get("name") or ""),
            "description": str(repo.get("description") or "")[:200], "private": bool(repo.get("private")),
            "clone_url": str(repo["clone_url"]), "pushed_at": str(repo.get("pushed_at") or ""),
            "language": str(repo.get("language") or ""), "html_url": str(repo.get("html_url") or ""),
        })
    return out
