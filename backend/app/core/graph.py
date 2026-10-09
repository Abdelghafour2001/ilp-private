"""Microsoft Graph client — app-only, for sending mail as a shared mailbox.

Why this exists next to the SMTP mailer: a deployment inside the tenant often
has no SMTP relay it is allowed to use. Exchange Online stopped accepting basic
authentication, and getting a service account onto a relay is a ticket nobody
wants to raise. An app registration with `Mail.Send` and one shared mailbox is
the path that is actually available, and it is the same path the ATS already
takes — same client-credentials grant, same retry rules.

What the tenant has to provide, once:

* an app registration with the **application** permission `Mail.Send`
  (not delegated), granted admin consent;
* a client secret;
* a mailbox to send as, e.g. `upskill@teal.ma`.

Worth knowing: `Mail.Send` as an application permission is tenant-wide — it can
send as *anybody* until an administrator scopes it with an application access
policy (`New-ApplicationAccessPolicy`) to the one mailbox. Ask for that policy
when you ask for the consent; `GRAPH_MAILBOX` here is our own restraint, not
the tenant's.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

from app.core.config import settings

log = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TIMEOUT = 30
# Throttling and transient server faults are worth another go; a 4xx is the
# request's own fault and is raised at once.
RETRY_CODES = frozenset({429, 500, 502, 503, 504})
RETRIES = 3
BACKOFF_SECONDS = 2.0


class GraphUnavailable(RuntimeError):
    """Graph was asked for and is not configured."""


class Graph:
    """One token, reused until it expires. Cheap to construct, so callers do."""

    def __init__(self) -> None:
        self._token = ""
        self._expires_at = 0.0

    def token(self) -> str:
        if self._token and time.time() < self._expires_at:
            return self._token
        tenant = settings.graph_tenant_id
        if not (tenant and settings.graph_client_id and settings.graph_client_secret):
            raise GraphUnavailable(
                "GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are not all set."
            )
        body = urllib.parse.urlencode({
            "client_id": settings.graph_client_id,
            "client_secret": settings.graph_client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }).encode()
        request = urllib.request.Request(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.load(response)
        self._token = payload["access_token"]
        # A minute early, so a call never starts with a token that expires
        # while it is in flight.
        self._expires_at = time.time() + int(payload["expires_in"]) - 60
        return self._token

    def post(self, path: str, body: dict) -> None:
        """A call whose answer is "accepted" and nothing else, such as sendMail."""
        self._request("POST", path, json.dumps(body).encode())

    def get(self, path: str) -> dict:
        return json.loads(self._request("GET", path) or b"{}")

    def _request(self, method: str, path: str, data: bytes | None = None) -> bytes:
        url = path if path.startswith("https://") else f"{GRAPH_BASE}{path}"
        for attempt in range(RETRIES):
            headers = {"Authorization": f"Bearer {self.token()}"}
            if data is not None:
                headers["Content-Type"] = "application/json"
            try:
                with urllib.request.urlopen(
                    urllib.request.Request(url, data=data, headers=headers, method=method),
                    timeout=TIMEOUT,
                ) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                if exc.code not in RETRY_CODES or attempt == RETRIES - 1:
                    # Graph explains refusals in the body, and the explanation is
                    # the difference between "consent missing" and "wrong
                    # mailbox" — both of which arrive as a bare 403 otherwise.
                    detail = exc.read()[:400].decode(errors="replace")
                    raise RuntimeError(f"Graph {method} {path} -> {exc.code}: {detail}") from exc
                # Graph says when it will serve us again; respect it.
                wait = float(exc.headers.get("Retry-After") or BACKOFF_SECONDS * (attempt + 1))
            except (urllib.error.URLError, OSError) as exc:
                if attempt == RETRIES - 1:
                    raise
                log.warning("graph call failed (%s), retrying: %s", type(exc).__name__, exc)
                wait = BACKOFF_SECONDS * (attempt + 1)
            time.sleep(wait)
        raise AssertionError("unreachable")
