import errno
import socket

from app.core import diagnostics
from app.core.config import Settings
from app.core.diagnostics import FAIL, OK, SKIP, WARN, explain_socket_error, redact_url


# Explicit values win over the environment, so the tests do not depend on the machine they run on.
NEUTRAL = dict(
    admin_token="", require_admin_auth=False, azure_tenant_id="", azure_client_id="", admin_emails="",
    coursera_mode="off", coursera_client_id="", coursera_client_secret="", coursera_org_id="",
    credentials_encryption_key="", llm_provider="", anthropic_api_key="",
)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**NEUTRAL, **overrides})


def test_redact_url_hides_passwords_only():
    assert redact_url("postgresql+psycopg2://dqai:secret@app-db:5432/dqai") == "postgresql+psycopg2://dqai:***@app-db:5432/dqai"
    assert redact_url("redis://redis:6379/0") == "redis://redis:6379/0"


def test_socket_errors_are_explained_in_plain_words():
    assert "no route to host" in explain_socket_error(OSError(errno.EHOSTUNREACH, "No route to host"))
    assert "connection refused" in explain_socket_error(OSError(errno.ECONNREFUSED, "refused"))
    assert "DNS name not found" in explain_socket_error(socket.gaierror(-2, "Name or service not known"))


def test_half_configured_sso_is_flagged():
    result = diagnostics.check_sso(_settings(azure_tenant_id="tenant", azure_client_id=""))
    assert result.status == FAIL and "AZURE_CLIENT_ID" in result.detail
    assert diagnostics.check_sso(_settings(azure_tenant_id="", azure_client_id="")).status == SKIP


def test_open_admin_api_and_bad_encryption_key_are_reported():
    results = {r.name: r for r in diagnostics.check_security(_settings(credentials_encryption_key="not-a-key"))}
    assert results["admin access"].status == WARN and "OPEN" in results["admin access"].detail
    assert results["encryption key"].status == FAIL


def test_live_coursera_without_credentials_fails():
    result = diagnostics.check_coursera(_settings(coursera_mode="live"))
    assert result.status == FAIL and "COURSERA_CLIENT_ID" in result.detail


def test_anthropic_without_key_fails_without_network():
    results = diagnostics.check_ai(_settings(llm_provider="anthropic", anthropic_api_key=""), real_call=True)
    assert [r.status for r in results] == [FAIL]


def test_report_never_raises(monkeypatch, caplog):
    monkeypatch.setattr(diagnostics, "check_database", lambda s: diagnostics._timed("database", "x", lambda: 1 / 0))
    monkeypatch.setattr(diagnostics, "check_redis", lambda s: diagnostics.CheckResult("redis", OK, "x", "PING answered"))
    results = diagnostics.log_report("beat")
    assert results[0].status == FAIL and "1 failing: database" in caplog.text
