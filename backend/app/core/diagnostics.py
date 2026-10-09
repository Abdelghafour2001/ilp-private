"""Connection and configuration report for the backend, the Celery worker and beat.

Without shell access to the pods, logs are the only way to see why a dependency is
unreachable. On start-up every process logs one line per dependency: what it tried,
how long it took, and in plain words why it failed ("no route to host: network or
firewall", "DNS name not found", "key rejected"...). The same report is available to
admins at ``GET /api/health/diagnostics`` and from a shell or Job with
``python -m app.core.diagnostics``.

Checks never raise and never block for long. They are read-only, except for one tiny
AI request on backend start (a few tokens, DIAGNOSTICS_LLM_CALLS=false to skip it).
"""

from __future__ import annotations

import errno
import logging
import os
import socket
import sys
import urllib.parse
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from app.core.config import Settings, get_settings

logger = logging.getLogger("app.diagnostics")

TIMEOUT_SECONDS = 3.0
ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"

OK = "ok"
WARN = "warn"
FAIL = "fail"
SKIP = "skip"


@dataclass
class CheckResult:
    name: str
    status: str
    target: str
    detail: str
    duration_ms: int = 0


def redact_url(url: str | None) -> str:
    """URL with any password replaced, safe to log."""
    if not url:
        return "(not set)"
    try:
        parts = urlsplit(url)
    except ValueError:
        return "(unparseable)"
    if parts.password is None:
        return url
    netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def explain_socket_error(exc: BaseException) -> str:
    """Turn a low-level connection error into a sentence an operator can act on."""
    if isinstance(exc, socket.gaierror):
        return f"DNS name not found ({exc.strerror or exc}): check the host name / service name and namespace"
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timed out: host unreachable, port filtered by a firewall, or service not listening"
    code = getattr(exc, "errno", None)
    reasons = {
        errno.EHOSTUNREACH: "no route to host: wrong IP, host down, or network/firewall/NetworkPolicy blocks it",
        errno.ECONNREFUSED: "connection refused: host reachable but nothing listens on that port (wrong port or service down)",
        errno.ENETUNREACH: "network unreachable: the pod has no route to that network",
        errno.ECONNRESET: "connection reset by the server: wrong protocol (e.g. TLS vs plain) or a proxy closed it",
    }
    if code in reasons:
        return f"{reasons[code]} (errno {code})"
    return f"{exc.__class__.__name__}: {exc}"


def _tcp(host: str, port: int) -> str | None:
    """None when a TCP connection opens, otherwise the reason it did not."""
    try:
        with socket.create_connection((host, port), timeout=TIMEOUT_SECONDS):
            return None
    except OSError as exc:
        return explain_socket_error(exc)


def _host_port(url: str, default_port: int) -> tuple[str | None, int]:
    parts = urlsplit(url if "://" in url else f"//{url}")
    return parts.hostname, parts.port or default_port


def _timed(name: str, target: str, check) -> CheckResult:
    started = time.monotonic()
    try:
        status, detail = check()
    except Exception as exc:  # noqa: BLE001 - a diagnostic must report, never crash
        status, detail = FAIL, explain_socket_error(exc) if isinstance(exc, OSError) else f"{exc.__class__.__name__}: {exc}"
    return CheckResult(name, status, target, detail, int((time.monotonic() - started) * 1000))


# --------------------------------------------------------------------------- databases

DATABASE_ERRORS = (
    ("password authentication failed", "reachable but the user or password is wrong"),
    ("does not exist", "reachable but the database or user does not exist"),
    ("could not translate host name", "DNS name not found: check the host / service name"),
    ("timeout expired", "timed out: host unreachable or port filtered by a firewall"),
    ("no pg_hba.conf entry", "the server refuses this client address (pg_hba.conf)"),
    ("ssl", "SSL negotiation failed: the server may require sslmode=require"),
)


def _database_reason(exc: BaseException) -> str:
    message = str(getattr(exc, "orig", None) or exc)
    for needle, reason in DATABASE_ERRORS:
        if needle in message.lower():
            return reason
    return message.strip().splitlines()[0] if message.strip() else exc.__class__.__name__


def _connect(url: str):
    """(error, connection-context) for a short-lived engine with a connect timeout."""
    from sqlalchemy import create_engine

    if not url.startswith("sqlite"):
        host, port = _host_port(url.split("://", 1)[-1].rsplit("@", 1)[-1].split("/", 1)[0], 5432)
        reason = _tcp(host or "", port)
        if reason:
            return reason, None
    connect_args = {} if url.startswith("sqlite") else {"connect_timeout": int(TIMEOUT_SECONDS)}
    return None, create_engine(url, connect_args=connect_args)


def expected_revision() -> str | None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    return ScriptDirectory.from_config(config).get_current_head()


def check_database(settings: Settings) -> CheckResult:
    def run():
        from alembic.runtime.migration import MigrationContext
        from sqlalchemy import text

        reason, engine = _connect(settings.database_url)
        if reason:
            return FAIL, reason
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
                current = MigrationContext.configure(connection).get_current_revision()
        except Exception as exc:  # noqa: BLE001
            return FAIL, _database_reason(exc)
        finally:
            engine.dispose()
        head = expected_revision()
        if current == head:
            return OK, f"connected; schema at {current} (up to date)"
        return FAIL, f"connected, but schema is {current or 'empty'} and this release needs {head}: run `alembic upgrade head`"

    return _timed("database", redact_url(settings.database_url), run)


def check_redis(settings: Settings) -> CheckResult:
    url = settings.redis_url

    def run():
        host, port = _host_port(url, 6379)
        reason = _tcp(host or "", port)
        if reason:
            return FAIL, f"{reason} (scheduled jobs will not run)"
        import redis

        client = redis.Redis.from_url(url, socket_timeout=TIMEOUT_SECONDS, socket_connect_timeout=TIMEOUT_SECONDS)
        try:
            client.ping()
        except redis.exceptions.AuthenticationError:
            return FAIL, "port open but authentication failed: check the password in REDIS_URL"
        except redis.exceptions.ConnectionError as exc:
            return FAIL, f"port open but not answering as Redis ({exc}): TLS required (rediss://) or wrong service"
        return OK, "PING answered"

    return _timed("redis", redact_url(url), run)


# --------------------------------------------------------------------------- files, mail

def check_folders(settings: Settings) -> list[CheckResult]:
    def uploads():
        path = Path(settings.uploads_dir)
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".diagnostics-write-test"
        probe.write_bytes(b"ok")
        probe.unlink()
        return OK, "writable (mount a persistent volume here, or uploads are lost on restart)"

    def labs():
        path = Path(settings.labs_dir)
        if not path.is_dir():
            return FAIL, "folder missing: no labs will load"
        count = len(list(path.rglob("*.yaml")))
        return (OK, f"{count} lab definitions") if count else (WARN, "folder is empty: no labs will load")

    return [_timed("uploads folder", settings.uploads_dir, uploads), _timed("labs folder", settings.labs_dir, labs)]


def check_mail(settings: Settings) -> CheckResult:
    """Whichever transport is configured — never the one that is not.

    Checking SMTP on a deployment that sends through Graph reports a problem
    that does not exist, and says nothing about the path mail actually takes.
    """
    if settings.mail_transport == "graph":
        return _with_allowlist(settings, check_graph_mail(settings))

    target = f"{settings.smtp_host or '(not set)'}:{settings.smtp_port}"
    if not settings.mail_enabled:
        return CheckResult("smtp", WARN, target, "SMTP_HOST empty and no GRAPH_* set: invitations and digests are not emailed")

    def run():
        reason = _tcp(settings.smtp_host, int(settings.smtp_port))
        return (FAIL, reason) if reason else (OK, f"port open; sender {settings.mail_from_address}")

    return _with_allowlist(settings, _timed("smtp", target, run))


def _with_allowlist(settings: Settings, result: CheckResult) -> CheckResult:
    """Say it out loud when this environment may only mail a few people.

    A capped environment that does not announce the cap costs somebody an hour
    wondering why a reminder never arrived.
    """
    entries = settings.mail_allowlist_entries
    if not entries:
        return result
    return CheckResult(
        result.name,
        WARN if result.status == OK else result.status,
        result.target,
        f"{result.detail} | RESTRICTED: only {', '.join(entries)} can be mailed from here",
        result.duration_ms,
    )


def check_graph_mail(settings: Settings) -> CheckResult:
    """Can we get a token, and does the mailbox exist and answer?

    Both halves matter and fail differently: a token proves the secret, reading
    the mailbox proves the consent and the mailbox name. Mail.Send grants no
    read, so a mailbox read that is refused for *permission* is not a problem —
    only a 404 is, and that one means the address is wrong.
    """
    target = f"graph {settings.graph_mailbox}"

    def run():
        from app.core.graph import Graph

        client = Graph()
        client.token()
        try:
            box = client.get(f"/users/{urllib.parse.quote(settings.graph_mailbox.strip())}")
        except RuntimeError as exc:
            if "-> 404" in str(exc):
                return FAIL, f"no mailbox {settings.graph_mailbox} in this tenant: check GRAPH_MAILBOX"
            # 403 here is expected with Mail.Send alone.
            return OK, "token granted; mailbox not readable (Mail.Send does not include read) — sending should work"
        return OK, f"token granted; sends as {box.get('mail') or box.get('userPrincipalName')}"

    return _timed("graph mail", target, run)


# --------------------------------------------------------------------------- AI

HTTP_REASONS = {
    400: "request rejected (400): check the model name and request format",
    401: "key rejected (401): check the API key",
    403: "access denied (403): the key has no access to this model or organisation",
    404: "not found (404): wrong model name or endpoint URL",
    429: "rate limited or out of credit (429)",
}


def _ai_error(exc: BaseException) -> str:
    code = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if code in HTTP_REASONS:
        return HTTP_REASONS[code]
    if isinstance(code, int) and code >= 500:
        return f"provider error ({code}): the service is failing, retry later"
    message = str(exc).strip().splitlines()[0] if str(exc).strip() else exc.__class__.__name__
    return f"{exc.__class__.__name__}: {message[:300]}"


def check_ai(settings: Settings, *, real_call: bool) -> list[CheckResult]:
    provider = settings.resolved_provider
    model = settings.ai_model_name
    if provider == "anthropic":
        if not settings.anthropic_api_key:
            return [CheckResult("ai model", FAIL, f"anthropic model={model}", "ANTHROPIC_API_KEY not set: AI features are off")]
        reach = _timed("ai model", f"anthropic model={model}",
                       lambda: (FAIL, r) if (r := _tcp("api.anthropic.com", 443)) else (OK, "api.anthropic.com reachable"))
        results = [reach]
        if real_call and reach.status == OK:
            def call():
                import anthropic

                client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=20.0, max_retries=0)
                try:
                    reply = client.messages.create(
                        model=settings.ai_model, max_tokens=8,
                        messages=[{"role": "user", "content": "Reply with the single word OK."}],
                    )
                except Exception as exc:  # noqa: BLE001
                    return FAIL, _ai_error(exc)
                text = "".join(getattr(block, "text", "") for block in reply.content).strip()
                return OK, f"model answered {text[:20]!r}"

            results.append(_timed("ai chat call", f"anthropic model={model}", call))
        return results

    # Ollama: the daemon must run and the model must be pulled.
    base = settings.ollama_base_url.rstrip("/")

    def tags():
        import httpx

        host, port = _host_port(base, 11434)
        reason = _tcp(host or "", port)
        if reason:
            return FAIL, f"{reason}: is `ollama serve` running and OLLAMA_BASE_URL right?"
        names = [m.get("name", "") for m in httpx.get(f"{base}/api/tags", timeout=TIMEOUT_SECONDS).json().get("models", [])]
        wanted = settings.ollama_model
        if not any(name == wanted or name.split(":")[0] == wanted.split(":")[0] for name in names):
            return FAIL, f"model '{wanted}' not pulled (have: {', '.join(names) or 'none'}): run `ollama pull {wanted}`"
        return OK, f"daemon up, model '{wanted}' available"

    reach = _timed("ai model", f"ollama {base} model={model}", tags)
    results = [reach]
    if real_call and reach.status == OK:
        def call():
            import httpx

            try:
                response = httpx.post(f"{base}/api/chat", timeout=60, json={
                    "model": settings.ollama_model, "stream": False, "options": {"num_predict": 5},
                    "messages": [{"role": "user", "content": "Reply with the single word OK."}],
                })
                response.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                return FAIL, _ai_error(exc)
            return OK, f"model answered {response.json().get('message', {}).get('content', '').strip()[:20]!r}"

        results.append(_timed("ai chat call", f"ollama model={model}", call))
    return results


# --------------------------------------------------------------------------- identity, integrations, security

def check_sso(settings: Settings) -> CheckResult:
    tenant, client = settings.azure_tenant_id, settings.azure_client_id
    if not tenant and not client:
        # Which way in is left depends on PASSWORD_LOGIN, and saying the wrong
        # one is worse than saying nothing: a deployment reading "handle login"
        # while the box is closed sends whoever is debugging to the wrong half.
        way_in = (
            "email + password (PASSWORD_LOGIN=1)"
            if settings.password_login_enabled
            else "the demo handle box — close it with PASSWORD_LOGIN=1 before anyone real uses this"
        )
        return CheckResult("azure sso", SKIP, "-", f"AZURE_TENANT_ID / AZURE_CLIENT_ID empty: sign-in is {way_in}")
    if not (tenant and client):
        missing = "AZURE_TENANT_ID" if not tenant else "AZURE_CLIENT_ID"
        return CheckResult("azure sso", FAIL, "-", f"half configured: {missing} is empty, so SSO stays off")

    def run():
        import httpx

        reason = _tcp("login.microsoftonline.com", 443)
        if reason:
            return FAIL, f"{reason}: sign-in tokens cannot be verified"
        response = httpx.get(f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys", timeout=TIMEOUT_SECONDS)
        if response.status_code == 400:
            return FAIL, "Microsoft does not know this AZURE_TENANT_ID: check the tenant id"
        response.raise_for_status()
        admins = "set" if settings.admin_emails_list else "empty (only users with the Azure 'admin' app role are admins)"
        return OK, f"tenant signing keys reachable; redirect URI (SPA) = {settings.frontend_origin}; ADMIN_EMAILS {admins}"

    return _timed("azure sso", f"tenant={tenant} client={client}", run)


def check_coursera(settings: Settings) -> CheckResult:
    mode = (settings.coursera_mode or "off").lower()
    if mode in {"off", "mock"}:
        return CheckResult("coursera", SKIP, f"mode={mode}", "reporting off" if mode == "off" else "fixtures (demo mode)")
    missing = [name for name, value in (
        ("COURSERA_CLIENT_ID", settings.coursera_client_id),
        ("COURSERA_CLIENT_SECRET", settings.coursera_client_secret),
        ("COURSERA_ORG_ID", settings.coursera_org_id),
    ) if not value]
    if missing:
        return CheckResult("coursera", FAIL, f"mode={mode}", "live mode needs " + ", ".join(missing))
    return _timed("coursera", "mode=live api.coursera.com",
                  lambda: (FAIL, r) if (r := _tcp("api.coursera.com", 443)) else (OK, "credentials set, API reachable"))


def check_sign_in(settings: Settings) -> CheckResult:
    """Which doors are actually open, and any that were asked for and are not.

    The one line that answers "why can nobody log in": AUTH_METHODS, what it
    resolved to, and what is missing. A deployment that offers a method it
    cannot serve shows a button that refuses the person who presses it.
    """
    doors = []
    if settings.auth_enabled:
        doors.append("Entra SSO (server flow)" if settings.sso_redirect_enabled else "Entra SSO (MSAL in the browser)")
    if settings.password_login_enabled:
        doors.append("email + password")
    if not doors:
        doors.append("demo handle box — nothing is authenticated")
    asked = settings.auth_methods or "(empty: whichever is configured)"
    problems = settings.auth_method_problems
    status = FAIL if (problems and settings.auth_methods) else (WARN if problems else OK)
    detail = "open: " + ", ".join(doors)
    if problems:
        detail += " | " + "; ".join(problems)
    return CheckResult("sign-in", status, f"AUTH_METHODS={asked}", detail)


def check_security(settings: Settings) -> list[CheckResult]:
    results = []
    open_admin = not settings.require_admin_auth and not settings.auth_enabled and not settings.admin_token
    if open_admin:
        results.append(CheckResult("admin access", WARN, "-", "admin API and HR analytics are OPEN (no SSO, no ADMIN_TOKEN, "
                                   "REQUIRE_ADMIN_AUTH off): fine locally, never in a shared environment"))
    else:
        guards = [name for name, on in (("SSO", settings.auth_enabled), ("ADMIN_TOKEN", bool(settings.admin_token)),
                                        ("REQUIRE_ADMIN_AUTH", settings.require_admin_auth)) if on]
        short = settings.admin_token and len(settings.admin_token) < 24
        results.append(CheckResult("admin access", WARN if short else OK, "-",
                                   f"protected by {', '.join(guards)}" + ("; ADMIN_TOKEN is short, use 24+ random characters" if short else "")))

    key = settings.credentials_encryption_key
    if not key:
        results.append(CheckResult("encryption key", WARN, "-", "CREDENTIALS_ENCRYPTION_KEY empty: saving connection credentials will fail"))
    else:
        try:
            from cryptography.fernet import Fernet

            Fernet(key.encode())
            results.append(CheckResult("encryption key", OK, "-", "CREDENTIALS_ENCRYPTION_KEY is a valid key"))
        except Exception:  # noqa: BLE001
            results.append(CheckResult("encryption key", FAIL, "-", "CREDENTIALS_ENCRYPTION_KEY is not a valid 32-byte url-safe base64 key"))
    return results


# --------------------------------------------------------------------------- report

NOISY_LOGGERS = ("alembic.runtime.migration", "httpx", "httpcore", "anthropic", "urllib3")


def run_checks(role: str = "api", settings: Settings | None = None) -> list[CheckResult]:
    """Every check for this process, with library request logging muted so the report stays readable."""
    settings = settings or get_settings()
    previous = {name: logging.getLogger(name).level for name in NOISY_LOGGERS}
    for name in NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        results = [check_database(settings), check_redis(settings)]
        if role == "beat":
            return results
        results += [check_mail(settings), check_coursera(settings)]
        if role == "api":
            real_call = os.environ.get("DIAGNOSTICS_LLM_CALLS", "true").lower() != "false"
            results += [*check_folders(settings), *check_ai(settings, real_call=real_call),
                        check_sso(settings), check_sign_in(settings), *check_security(settings)]
        return results
    finally:
        for name, level in previous.items():
            logging.getLogger(name).setLevel(level)


def config_summary(settings: Settings) -> list[str]:
    return [
        f"FRONTEND_ORIGIN={settings.frontend_origin}  AI={settings.resolved_provider} ({settings.ai_model_name})  "
        f"COURSERA_MODE={settings.coursera_mode}  SSO={'on' if settings.auth_enabled else 'off'}",
    ]


MARKS = {OK: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]", SKIP: "[SKIP]"}


def log_report(role: str = "api") -> list[CheckResult]:
    """Run every check and log a readable report. Never raises."""
    if os.environ.get("STARTUP_DIAGNOSTICS_ENABLED", "true").lower() == "false":
        return []
    try:
        settings = get_settings()
        results = run_checks(role, settings)
    except Exception:  # noqa: BLE001
        logger.exception("Start-up diagnostics could not run")
        return []

    logger.info("===== Start-up diagnostics (%s) =====", role)
    for line in config_summary(settings):
        logger.info("  %s", line)
    width = max(len(result.name) for result in results)
    for result in results:
        level = logging.ERROR if result.status == FAIL else logging.WARNING if result.status == WARN else logging.INFO
        logger.log(level, "%s %-*s  %s  (%d ms)  %s", MARKS[result.status], width, result.name,
                   result.target, result.duration_ms, result.detail)
    failed = [result.name for result in results if result.status == FAIL]
    warned = [result.name for result in results if result.status == WARN]
    if failed:
        logger.error("===== %d failing: %s =====", len(failed), ", ".join(failed))
    else:
        logger.info("===== all dependencies reachable%s =====", f" ({len(warned)} warnings)" if warned else "")
    return results


def as_dicts(results: list[CheckResult]) -> list[dict]:
    return [asdict(result) for result in results]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    outcome = log_report(sys.argv[1] if len(sys.argv) > 1 else "api")
    sys.exit(1 if any(result.status == FAIL for result in outcome) else 0)
