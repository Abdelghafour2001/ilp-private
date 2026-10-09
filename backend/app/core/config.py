import re
from functools import lru_cache
from typing import Any

from pydantic import AliasChoices, Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# `podman-compose` (unlike `docker compose`) does not apply the default half of
# a `${VAR:-default}` reference when VAR is undefined — it forwards the literal
# string. A setting holding "${ADMIN_TOKEN:-}" silently behaves as a configured
# secret, which is worse than being unset. Treat any such leftover as empty.
_UNEXPANDED = re.compile(r"^\$\{[^}]*\}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("*", mode="before")
    @classmethod
    def _drop_unexpanded_refs(cls, value: Any, info: ValidationInfo) -> Any:
        """Blank out a leftover `${VAR:-default}` so the field falls back to
        its declared default instead of holding the literal reference."""
        if not isinstance(value, str) or not _UNEXPANDED.match(value.strip()):
            return value
        field = cls.model_fields.get(info.field_name or "")
        return field.default if field is not None else ""

    database_url: str = "postgresql+psycopg2://dqai:dqai@localhost:5433/dqai"
    redis_url: str = "redis://localhost:6379/0"

    # Directory holding contributor-authored lab definitions (*.yaml).
    labs_dir: str = "labs"

    # Where uploaded files (sharing-session decks) are stored.
    uploads_dir: str = "uploads"

    # Optional gate for the admin/management API. If empty, admin endpoints are
    # open (fine for local dev). Set it to require an X-Admin-Token header.
    admin_token: str = ""

    # Refuse the "no token configured = open API" fallback. Leave False for
    # local dev; set it in any shared/deployed environment so HR analytics and
    # the admin API can never answer an unauthenticated request.
    require_admin_auth: bool = False

    # What the product is called, in page titles, emails and reports. One
    # setting rather than a literal in ninety places, because the platform is
    # white-labelled: the next client renames it in their configmap, not in a
    # branch of the source.
    app_name: str = "UpSkill"

    # Hours in one man-day, used to report Jour-Homme from learning hours.
    hours_per_man_day: float = 8.0

    # --- Coursera ---------------------------------------------------------
    # The public catalog needs no credentials and is always available.
    # Enterprise *reporting* needs a Coursera for Business contract:
    #   off  = disabled (default)   mock = fixtures, for demos and tests
    #   live = real API (requires client id/secret + org id)
    coursera_mode: str = "off"
    coursera_client_id: str = ""
    coursera_client_secret: str = ""
    coursera_org_id: str = ""
    # How often the enrolment sync runs. 0 = once a night at 05:00 UTC, which
    # is right for reporting. Set it to 15 or 30 while a process is being
    # tested or demonstrated: a mandatory assignment then shows the learner's
    # first click within the quarter-hour instead of the next morning. The
    # provider's own feed has its own delay, so this is the floor, not a
    # guarantee.
    coursera_sync_minutes: int = 0

    # Days before a certificate expires when the renewal reminder goes out.
    cert_reminder_days: int = 60

    # --- Azure Entra ID (Azure AD) SSO ---
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    # Comma-separated emails that should be admins regardless of Azure App Roles.
    admin_emails: str = ""

    # --- which doors the login page offers --------------------------------
    # One switch rather than one per method: AUTH_METHODS is a comma-separated
    # list of `sso` and `password`, and both together is a normal answer —
    # employees arrive through Entra, externals and service accounts through a
    # password, on the same deployment.
    #
    #   AUTH_METHODS=sso,password   both doors
    #   AUTH_METHODS=sso            Entra only
    #   AUTH_METHODS=password       email + password only
    #   AUTH_METHODS=               (empty) whichever is configured — which is
    #                               how every deployment behaved before this
    #                               setting existed, so nothing had to change
    #                               when it arrived.
    #
    # A method listed here still has to be configured to open: asking for `sso`
    # with no tenant does not invent one. The start-up check says so by name
    # rather than leaving a button that cannot work.
    auth_methods: str = ""

    @property
    def sso_configured(self) -> bool:
        """The Entra credentials exist — whether or not SSO is switched on."""
        return bool(self.azure_tenant_id and self.azure_client_id)

    @property
    def auth_methods_wanted(self) -> set[str]:
        asked = {m.strip().lower() for m in self.auth_methods.split(",") if m.strip()}
        if asked:
            return asked
        # Nothing asked for: fall back to what the credentials imply. PASSWORD_LOGIN
        # is the older switch and keeps working, which is why it is read here and
        # not above — AUTH_METHODS, when set, is the whole answer.
        implied = set()
        if self.sso_configured:
            implied.add("sso")
        if self.password_login:
            implied.add("password")
        return implied

    @property
    def auth_enabled(self) -> bool:
        """SSO is on: offered *and* configured. The one definition of that."""
        return "sso" in self.auth_methods_wanted and self.sso_configured

    @property
    def auth_method_problems(self) -> list[str]:
        """Doors asked for that cannot open, and what is missing. For diagnostics.

        A deployment that asks for a method it cannot serve is a misconfiguration
        worth a line at boot: the alternative is a sign-in page that offers a way
        in and then refuses it.
        """
        problems = []
        wanted = self.auth_methods_wanted
        unknown = wanted - {"sso", "password"}
        if unknown:
            problems.append(f"AUTH_METHODS lists {', '.join(sorted(unknown))}: only sso and password exist")
        if "sso" in wanted and not self.sso_configured:
            problems.append("sso asked for but AZURE_TENANT_ID / AZURE_CLIENT_ID are empty")
        if "password" in wanted and not self.credentials_encryption_key:
            problems.append("password asked for but CREDENTIALS_ENCRYPTION_KEY is empty: sessions could not be signed")
        if not wanted:
            problems.append("no method configured: the demo handle box is the only way in")
        return problems

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    # A client secret turns SSO from the browser-side MSAL flow into the
    # server-side redirect flow (/auth/sso/azure): the app registration is then
    # a confidential client with a *Web* redirect URI instead of a
    # single-page-application one. Same tenant and client id either way.
    azure_client_secret: str = ""

    @property
    def sso_redirect_enabled(self) -> bool:
        """Entra sign-in handled by the server rather than by MSAL in the page.

        Needs the session-signing key as well: the flow ends by minting one of
        our own session tokens, and without a key there is nothing to sign it
        with.
        """
        return bool(
            self.auth_enabled and self.azure_client_secret and self.credentials_encryption_key
        )

    # --- Microsoft Graph (outgoing mail as a shared mailbox) --------------
    # An app registration with the *application* permission Mail.Send, and the
    # mailbox to send as. Set these and email leaves through Graph instead of
    # SMTP — which is what a deployment inside the tenant can usually get.
    # Both spellings are accepted. `GRAPH_*` is this platform's own; the
    # `MICROSOFT_GRAPH_*` names are what the ATS uses, and a tenant that has
    # already registered an app has them written down that way. Accepting both
    # costs four lines and saves the failure where a value is set, looks right
    # in the configmap, and is silently not read by anything.
    graph_tenant_id: str = Field(default="", validation_alias=AliasChoices("GRAPH_TENANT_ID", "MICROSOFT_GRAPH_TENANT_ID"))
    graph_client_id: str = Field(default="", validation_alias=AliasChoices("GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_ID"))
    graph_client_secret: str = Field(default="", validation_alias=AliasChoices("GRAPH_CLIENT_SECRET", "MICROSOFT_GRAPH_CLIENT_SECRET"))
    graph_mailbox: str = Field(default="", validation_alias=AliasChoices("GRAPH_MAILBOX", "MICROSOFT_GRAPH_MAILBOX"))

    @property
    def graph_mail_configured(self) -> bool:
        return bool(
            self.graph_tenant_id
            and self.graph_client_id
            and self.graph_client_secret
            and self.graph_mailbox
        )

    @property
    def mail_transport(self) -> str:
        """Graph wins when it is configured: a tenant that has both wants Graph."""
        return "graph" if self.graph_mail_configured else "smtp"

    credentials_encryption_key: str = ""

    # The older, single-purpose switch for the password door. Still read, and
    # still enough on its own — it is what `AUTH_METHODS` falls back to when
    # nothing is listed there. Setting AUTH_METHODS supersedes it.
    password_login: bool = False

    @property
    def password_login_enabled(self) -> bool:
        """Email + password is on: offered, and there is a key to sign with.

        The key is not optional. A deployment with no CREDENTIALS_ENCRYPTION_KEY
        has nothing to sign a session with, so the door would hand out tokens
        anybody could forge.
        """
        return "password" in self.auth_methods_wanted and bool(self.credentials_encryption_key)

    # LLM provider: "anthropic", "azure_openai" or "ollama" (local, free).
    # Leave blank to auto-pick whichever is configured, in that order.
    llm_provider: str = ""

    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-4-8"

    # Azure OpenAI: a deployment name rather than a model id, and the key
    # travels in an `api-key` header instead of a bearer token.
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""
    azure_openai_api_version: str = "2024-10-21"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    frontend_origin: str = "http://localhost:3000"

    # HR reporting: hours -> man-days. The working-day basis varies by
    # convention (7 h, 7.5 h, 8 h), so it is configurable rather than assumed.

    # --- Outgoing email (invites, digests). Empty host = email disabled.  ---
    # For local testing run MailHog and point smtp_host at it (UI on :8025).
    smtp_host: str = ""
    smtp_port: int = 1025
    mail_from: str = "UpSkill <upskill@localhost>"

    # Who this environment may actually email. Empty = everybody, which is
    # production. Set it in dev and UAT: those carry the real organisation —
    # real names, real addresses — and the nightly reminder sweep cannot tell
    # it is not production. Mailpit used to be the guard; the moment a real
    # transport is configured, that guard is gone.
    #
    # Entries are addresses, or a domain as `@example.com`. Comma-separated.
    # In-app notifications are never affected: only the outbound hop is capped,
    # so a flow stays testable end to end.
    mail_allowlist: str = ""

    @property
    def mail_allowlist_entries(self) -> list[str]:
        return [e.strip().lower() for e in self.mail_allowlist.split(",") if e.strip()]

    def may_email(self, address: str) -> bool:
        """Is this environment allowed to send to this address?"""
        entries = self.mail_allowlist_entries
        if not entries:
            return True
        target = (address or "").strip().lower()
        return any(
            target.endswith(entry) if entry.startswith("@") else target == entry
            for entry in entries
        )

    @property
    def mail_enabled(self) -> bool:
        return bool(self.smtp_host or self.graph_mail_configured)

    @property
    def mail_from_address(self) -> str:
        """Just the address out of `mail_from` ("AIDA <a@b>" -> "a@b").

        On the Graph transport the real sender is `graph_mailbox` — Graph sends
        as the mailbox the app was granted and ignores anything we ask for — so
        that one wins here, or a reply-to printed in a mail would name an
        address that never sent it.
        """
        if self.graph_mail_configured:
            return self.graph_mailbox.strip()
        value = self.mail_from
        if "<" in value and ">" in value:
            return value.split("<", 1)[1].split(">", 1)[0].strip()
        return value.strip()

    @property
    def azure_openai_configured(self) -> bool:
        return bool(self.azure_openai_api_key and self.azure_openai_endpoint)

    @property
    def resolved_provider(self) -> str:
        if self.llm_provider:
            return self.llm_provider
        if self.anthropic_api_key:
            return "anthropic"
        if self.azure_openai_configured:
            return "azure_openai"
        return "ollama"

    @property
    def ai_model_name(self) -> str:
        if self.resolved_provider == "anthropic":
            return self.ai_model
        if self.resolved_provider == "azure_openai":
            return self.azure_openai_deployment or self.ai_model
        return self.ollama_model

    @property
    def ai_enabled(self) -> bool:
        # The hosted providers need a key; Ollama is assumed available
        # locally (calls surface a clear error if the daemon isn't running).
        if self.resolved_provider == "anthropic":
            return bool(self.anthropic_api_key)
        if self.resolved_provider == "azure_openai":
            return self.azure_openai_configured
        return self.resolved_provider == "ollama"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
