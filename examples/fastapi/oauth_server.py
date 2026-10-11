"""
A tiny in-memory OAuth 2.0 server so the playground's sign-in can be tried
end to end: authorization code with PKCE (consent page), password, client
credentials and refresh tokens. For the example only: no persistence, no
real users, tokens live in a dict.

    client id      orbit-docs              (public client, PKCE)
    client id      orbit-cli / orbit-secret (client credentials)
    user           demo / orbit-demo-password
"""

import base64
import hashlib
import secrets
import time
from html import escape
from typing import Annotated
from urllib.parse import unquote_plus, urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Security, status
from fastapi.openapi.models import OAuthFlowAuthorizationCode, OAuthFlowClientCredentials, OAuthFlowPassword, OAuthFlows
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import OAuth2, SecurityScopes

SCOPES = {"profile": "Read your profile", "customers:read": "Read customers", "customers:write": "Create and change customers"}
PUBLIC_CLIENT = "orbit-docs"
CONFIDENTIAL_CLIENTS = {"orbit-cli": "orbit-secret"}
USERS = {"demo": "orbit-demo-password"}
TOKEN_LIFETIME = 120  # seconds: short, so expiry and refresh are easy to see

codes: dict[str, dict] = {}
tokens: dict[str, dict] = {}
refresh_tokens: dict[str, dict] = {}

router = APIRouter(prefix="/oauth", include_in_schema=False)

oauth2 = OAuth2(
    flows=OAuthFlows(
        authorizationCode=OAuthFlowAuthorizationCode(authorizationUrl="/oauth/authorize", tokenUrl="/oauth/token", refreshUrl="/oauth/token", scopes=SCOPES),
        password=OAuthFlowPassword(tokenUrl="/oauth/token", scopes=SCOPES),
        clientCredentials=OAuthFlowClientCredentials(tokenUrl="/oauth/token", scopes=SCOPES),
    ),
    scheme_name="OrbitOAuth",
    description="Sign in with `demo` / `orbit-demo-password`, client id `orbit-docs` (or `orbit-cli` / `orbit-secret` for client credentials).",
)


class OAuthProblem(Exception):
    """An RFC 6749 §5.2 error: answered as {"error", "error_description"} at the top level."""

    def __init__(self, error: str, description: str, status_code: int = 400):
        self.error, self.description, self.status_code = error, description, status_code


def oauth_error(error: str, description: str, status_code: int = 400) -> OAuthProblem:
    return OAuthProblem(error, description, status_code)


def issue(subject: str, scopes: list[str], flow: str, refresh: bool = True) -> dict:
    access = secrets.token_urlsafe(24)
    tokens[access] = {"sub": subject, "scopes": scopes, "flow": flow, "exp": time.time() + TOKEN_LIFETIME}
    body = {"access_token": access, "token_type": "Bearer", "expires_in": TOKEN_LIFETIME, "scope": " ".join(scopes)}
    if refresh:
        refresh_token = secrets.token_urlsafe(24)
        refresh_tokens[refresh_token] = {"sub": subject, "scopes": scopes, "flow": flow}
        body["refresh_token"] = refresh_token
    return body


def requested_scopes(scope: str | None) -> list[str]:
    asked = (scope or "").split()
    unknown = [s for s in asked if s not in SCOPES]
    if unknown:
        raise oauth_error("invalid_scope", f"Unknown scope: {' '.join(unknown)}")
    return asked


@router.get("/authorize", response_class=HTMLResponse)
def authorize_page(client_id: str, redirect_uri: str, response_type: str = "code", state: str = "", scope: str = "", code_challenge: str = "", code_challenge_method: str = ""):
    if client_id != PUBLIC_CLIENT:
        return HTMLResponse(f"<p>Unknown client <code>{escape(client_id)}</code>.</p>", status_code=400)
    if response_type != "code" or code_challenge_method != "S256" or not code_challenge:
        return HTMLResponse("<p>This server only supports the authorization code flow with PKCE (S256).</p>", status_code=400)
    hidden = "".join(f'<input type="hidden" name="{name}" value="{escape(value)}">' for name, value in
                     {"client_id": client_id, "redirect_uri": redirect_uri, "state": state, "scope": scope, "code_challenge": code_challenge}.items())
    items = "".join(f"<li><code>{escape(s)}</code> {escape(SCOPES.get(s, ''))}</li>" for s in scope.split()) or "<li>No scopes</li>"
    return f"""<!doctype html><meta name="viewport" content="width=device-width">
<title>Sign in to Orbit</title>
<style>body{{font:15px system-ui;max-width:360px;margin:48px auto;padding:0 16px;color:#17171f}}button{{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #ccc;cursor:pointer}}.go{{background:#14b8a6;color:#fff;border-color:#14b8a6}}input[type=text],input[type=password]{{font:inherit;width:100%;box-sizing:border-box;padding:7px;margin:4px 0 10px}}</style>
<h2>Sign in to Orbit</h2>
<p><b>{escape(client_id)}</b> wants to:</p><ul>{items}</ul>
<form method="post">{hidden}
<label>Username <input type="text" name="username" value="demo"></label>
<label>Password <input type="password" name="password" value="orbit-demo-password"></label>
<button class="go" name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button>
</form>"""


@router.post("/authorize")
def authorize_decision(client_id: Annotated[str, Form()], redirect_uri: Annotated[str, Form()], code_challenge: Annotated[str, Form()],
                       decision: Annotated[str, Form()], state: Annotated[str, Form()] = "", scope: Annotated[str, Form()] = "",
                       username: Annotated[str, Form()] = "", password: Annotated[str, Form()] = ""):
    if decision != "allow":
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': 'access_denied', 'error_description': 'The user denied access.', 'state': state})}", status.HTTP_303_SEE_OTHER)
    if USERS.get(username) != password:
        return HTMLResponse("<p>Wrong username or password. Go back and try again.</p>", status_code=401)
    code = secrets.token_urlsafe(16)
    try:
        scopes = requested_scopes(scope)
    except OAuthProblem as problem:
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': problem.error, 'error_description': problem.description, 'state': state})}", status.HTTP_303_SEE_OTHER)
    codes[code] = {"client_id": client_id, "redirect_uri": redirect_uri, "challenge": code_challenge, "scopes": scopes, "sub": username, "exp": time.time() + 60}
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}", status.HTTP_303_SEE_OTHER)


def client_from(request: Request, client_id: str | None, client_secret: str | None) -> tuple[str | None, str | None]:
    """RFC 6749 §2.3.1: HTTP Basic, or the request body."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("basic "):
        decoded = base64.b64decode(header[6:]).decode()
        user, _, secret = decoded.partition(":")
        return unquote_plus(user), unquote_plus(secret)
    return client_id, client_secret


@router.post("/token")
def token(request: Request, grant_type: Annotated[str, Form()], code: Annotated[str | None, Form()] = None,
          redirect_uri: Annotated[str | None, Form()] = None, code_verifier: Annotated[str | None, Form()] = None,
          username: Annotated[str | None, Form()] = None, password: Annotated[str | None, Form()] = None,
          refresh_token: Annotated[str | None, Form()] = None, scope: Annotated[str | None, Form()] = None,
          client_id: Annotated[str | None, Form()] = None, client_secret: Annotated[str | None, Form()] = None):
    try:
        return grant_token(request, grant_type, code, redirect_uri, code_verifier, username, password, refresh_token, scope, client_id, client_secret)
    except OAuthProblem as problem:
        return JSONResponse({"error": problem.error, "error_description": problem.description}, problem.status_code, headers={"Cache-Control": "no-store"})


def grant_token(request, grant_type, code, redirect_uri, code_verifier, username, password, refresh_token, scope, client_id, client_secret) -> dict:
    client_id, client_secret = client_from(request, client_id, client_secret)
    if grant_type == "authorization_code":
        grant = codes.pop(code or "", None)
        if not grant or grant["exp"] < time.time():
            raise oauth_error("invalid_grant", "The code is invalid or expired.")
        if grant["client_id"] != client_id or grant["redirect_uri"] != redirect_uri:
            raise oauth_error("invalid_grant", "client_id or redirect_uri does not match the authorization request.")
        challenge = base64.urlsafe_b64encode(hashlib.sha256((code_verifier or "").encode()).digest()).rstrip(b"=").decode()
        if challenge != grant["challenge"]:
            raise oauth_error("invalid_grant", "PKCE verification failed.")
        return issue(grant["sub"], grant["scopes"], "authorization_code")
    if grant_type == "password":
        if USERS.get(username or "") != password:
            raise oauth_error("invalid_grant", "Incorrect username or password.")
        return issue(username, requested_scopes(scope), "password")
    if grant_type == "client_credentials":
        if CONFIDENTIAL_CLIENTS.get(client_id or "") != client_secret:
            raise oauth_error("invalid_client", "Unknown client or wrong secret.", 401)
        return issue(client_id, requested_scopes(scope), "client_credentials", refresh=False)
    if grant_type == "refresh_token":
        grant = refresh_tokens.pop(refresh_token or "", None)  # rotated on every use
        if not grant:
            raise oauth_error("invalid_grant", "Unknown refresh token.")
        return issue(grant["sub"], grant["scopes"], grant["flow"])
    raise oauth_error("unsupported_grant_type", f"Unsupported grant_type {grant_type!r}.")


def current_token(security_scopes: SecurityScopes, authorization: Annotated[str | None, Depends(oauth2)]) -> dict:
    token_value = (authorization or "").removeprefix("Bearer ").strip()
    found = tokens.get(token_value)
    challenge = {"WWW-Authenticate": f'Bearer scope="{security_scopes.scope_str}"'}
    if not found or found["exp"] < time.time():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing, unknown or expired access token.", headers=challenge)
    missing = [s for s in security_scopes.scopes if s not in found["scopes"]]
    if missing:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Token lacks scope: {' '.join(missing)}", headers=challenge)
    return found


def require(*scopes: str):
    return Security(current_token, scopes=list(scopes))
