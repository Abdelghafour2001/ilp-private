"""Replace a caller's claimed `learner_id` with the one their token proves."""

from __future__ import annotations

import logging

from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth.azure import optional_user
from app.core.config import settings
from app.core.identity import learner_id_for_session, learner_id_for_token, rewrite_learner_id

log = logging.getLogger(__name__)

# Paths that must keep working without a learner identity at all.
_EXEMPT_PREFIXES = ("/api/auth/", "/health", "/docs", "/openapi.json", "/redoc")


class IdentityMiddleware:
    """Query-string `learner_id` becomes whatever the bearer token says.

    Three cases:

    * a valid token -> `learner_id` is overwritten with that learner's id, so a
      forged one is simply discarded;
    * SSO configured but no valid token -> `learner_id` is stripped, and routes
      see the same thing they'd see for an anonymous caller (which they already
      handle: most answer 403);
    * SSO not configured -> the value is left alone, because there is nothing to
      prove identity with and this is a local demo. `settings.auth_enabled` is
      false only when AZURE_TENANT_ID / AZURE_CLIENT_ID are unset, so a deployed
      instance cannot land here by accident.

    An `X-Admin-Token` request is left alone as well: it is a server-to-server
    credential that carries no learner, and the routes gate it separately.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Either way in makes the claimed identity untrustworthy and therefore
        # worth replacing. With neither configured this is a local demo and the
        # caller's word is all there is.
        guarded = settings.auth_enabled or settings.password_login_enabled
        if scope["type"] != "http" or not guarded:
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path.startswith(_EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}

        if headers.get("x-admin-token"):
            await self.app(scope, receive, send)
            return

        authorization = headers.get("authorization")
        token = authorization.split(" ", 1)[1] if authorization and " " in authorization else ""
        proven: int | None = None

        user = optional_user(authorization)
        if user:
            try:
                proven = learner_id_for_token(token, user)
            except Exception:  # noqa: BLE001
                # A database hiccup must not turn into "you are someone else".
                log.exception("could not resolve learner for a valid token")
                proven = None
        elif token and settings.password_login_enabled:
            # Not an Entra token, or no SSO here: it may be a session this
            # server signed. Anything else reads as nobody.
            try:
                proven = learner_id_for_session(token)
            except Exception:  # noqa: BLE001
                log.exception("could not resolve learner for a session token")
                proven = None

        query_string = scope.get("query_string", b"")
        if proven is None and b"learner_id=" in query_string:
            # They asked to act as somebody and could not prove it. Stripping the
            # value would work, but the route would then answer "field required"
            # (422) or "only HR may do this" (403) — both misleading. The real
            # problem is that nobody is signed in, so say that.
            await self._unauthorized(send)
            return

        scope = dict(scope)
        scope["query_string"] = rewrite_learner_id(query_string, proven)
        await self.app(scope, receive, send)

    @staticmethod
    async def _unauthorized(send: Send) -> None:
        body = b'{"detail":"Sign in to continue."}'
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
