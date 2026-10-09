"""Coursera connector.

Coursera exposes two very different surfaces, and only one of them is usable
without a commercial agreement:

* **Catalog** (`courses.v1`, `partners.v1`) — public, unauthenticated, ~24k
  courses with real cover art and a published workload string. This is what
  powers "add a Coursera course to our catalog", and it works today.

* **Enterprise reporting** (`businesses.v1/{orgId}/enrollmentReports`) — who
  enrolled, how far they got. Gated behind a Coursera for Business contract;
  without one it answers `403 Not Authorized`. This is the half HR needs.

The reporting client is therefore written against the documented response
shape but runs in one of three modes (`COURSERA_MODE`):

* `off`     — reporting disabled (default).
* `mock`    — serves fixtures, so the whole HR flow is demonstrable and
              testable before a contract exists.
* `live`    — real OAuth2 client-credentials calls.

Switching from a demo to production is then a config change, not a rewrite.
Field names below follow Coursera's published OpenAPI description of the
Coursera for Business API, so the mock and `live` agree; the fixtures are the
spec's own example values with our demo learners' addresses substituted in.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import time
from typing import Any, Iterator

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

CATALOG_BASE = "https://api.coursera.org/api"
TOKEN_URL = "https://api.coursera.com/oauth2/client_credentials/token"
# Enterprise endpoints live on a different host AND a different prefix from the
# public catalog — `api.coursera.com/ent/api`, not `api.coursera.org/api`.
# Getting this wrong produces a 403 that looks exactly like "no entitlement",
# which cost an afternoon of chasing the wrong problem.
ENTERPRISE_BASE = "https://api.coursera.com/ent/api"

# The catalog is beta and may change shape without notice, so ask for exactly
# the fields we use and tolerate any of them being absent.
COURSE_FIELDS = ",".join([
    # Coursera's own subject taxonomy, so categories are the provider's
    # rather than something we guessed from a title.
    "domainTypes",
    "name",
    "slug",
    "description",
    "photoUrl",
    "workload",
    "primaryLanguages",
    "partnerIds",
    "certificates",
])


# --------------------------------------------------------------------------- #
# workload → hours                                                            #
# --------------------------------------------------------------------------- #

# Coursera writes workload as free text, e.g.
#   "At the rate of 5 hours a week, it typically takes 3 weeks to complete"
#   "1 hour 30 minutes"
#   "Approx. 21 hours to complete"
_RATE = re.compile(r"(\d+(?:\.\d+)?)\s*hours?\s*a\s*week.*?(\d+(?:\.\d+)?)\s*weeks?", re.I | re.S)
_HOURS_MINUTES = re.compile(r"(\d+(?:\.\d+)?)\s*hours?(?:\s*(\d+)\s*minutes?)?", re.I)
_MINUTES_ONLY = re.compile(r"(\d+)\s*minutes?", re.I)


def parse_workload_hours(workload: str | None) -> float | None:
    """Best-effort hours from Coursera's free-text workload string.

    Returns None when nothing can be read, so the caller can distinguish
    "no estimate" from "zero hours" — the difference matters in an HR report.
    """
    if not workload:
        return None
    text = workload.strip()
    if not text:
        return None

    rate = _RATE.search(text)
    if rate:
        per_week, weeks = float(rate.group(1)), float(rate.group(2))
        return round(per_week * weeks, 1)

    hm = _HOURS_MINUTES.search(text)
    if hm:
        hours = float(hm.group(1)) + (int(hm.group(2)) / 60 if hm.group(2) else 0)
        return round(hours, 1)

    mo = _MINUTES_ONLY.search(text)
    if mo:
        return round(int(mo.group(1)) / 60, 1)
    return None


# --------------------------------------------------------------------------- #
# catalog (public, no credentials)                                            #
# --------------------------------------------------------------------------- #


class CourseraCatalog:
    """Read-only client for Coursera's public catalog."""

    def __init__(self, timeout: float = 20.0):
        self._client = httpx.Client(timeout=timeout, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "CourseraCatalog":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def by_slug(self, slug: str) -> dict[str, Any] | None:
        """One course by its URL slug (the tail of a coursera.org/learn/... link)."""
        r = self._client.get(
            f"{CATALOG_BASE}/courses.v1",
            params={"q": "slug", "slug": slug, "fields": COURSE_FIELDS},
        )
        if r.status_code != 200:
            log.warning("coursera catalog %s -> %s", slug, r.status_code)
            return None
        elements = r.json().get("elements") or []
        return self.normalize(elements[0]) if elements else None

    def browse(self, limit: int = 20, start: int = 0) -> list[dict[str, Any]]:
        """A page of the catalog. There is no server-side text search on this
        endpoint (`q=search` answers 405), so filtering happens client-side."""
        r = self._client.get(
            f"{CATALOG_BASE}/courses.v1",
            params={"start": start, "limit": max(1, min(limit, 100)), "fields": COURSE_FIELDS},
        )
        if r.status_code != 200:
            log.warning("coursera browse -> %s", r.status_code)
            return []
        return [self.normalize(e) for e in r.json().get("elements", [])]

    # --- multi-course programmes ------------------------------------------
    # Specializations and professional certificates are the same object here
    # (`onDemandSpecializations.v1`); only the URL path differs. Enterprise
    # reporting never mentions them, so these three calls are the only way to
    # know that ten completed courses add up to a certificate somebody earned.

    def specialization_ids(self, course_slug: str) -> list[str]:
        """The programmes that contain this course.

        This is what makes discovery possible without a search endpoint — which
        the catalogue does not offer (`q=search` answers 405). Ask about a
        course somebody finished and the catalogue names its parents, so the
        set of programmes worth knowing about builds itself out of the
        completions we already hold.
        """
        r = self._client.get(
            f"{CATALOG_BASE}/courses.v1",
            params={"q": "slug", "slug": course_slug, "fields": "s12nIds"},
        )
        if r.status_code == 404:
            # Private content: an organisation's own course, a Coursera
            # Instructor Network session, a verified-skill assessment. It is not
            # in the public catalogue and never will be, so it belongs in no
            # programme — expected, not a problem, and not worth a warning every
            # night for the rest of the deployment's life.
            log.info("coursera: %s is not in the public catalogue", course_slug)
            return []
        if r.status_code != 200:
            log.warning("coursera s12nIds %s -> %s", course_slug, r.status_code)
            return []
        elements = r.json().get("elements") or []
        # `child~<id>` ids are ordinary programmes, not a different kind of
        # thing — dropping them loses most professional certificates.
        return [str(i) for i in (elements[0].get("s12nIds") or [])] if elements else []

    def specializations(self, ids: list[str]) -> list[dict[str, Any]]:
        """Programmes by id, with their member course ids."""
        out: list[dict[str, Any]] = []
        for batch in _batched(ids, 20):
            r = self._client.get(
                f"{CATALOG_BASE}/onDemandSpecializations.v1",
                params={
                    "ids": ",".join(batch),
                    "fields": "name,slug,courseIds,partnerIds,logo,productVariant",
                },
            )
            if r.status_code != 200:
                log.warning("coursera specializations -> %s", r.status_code)
                continue
            out.extend(self.normalize_specialization(e) for e in r.json().get("elements", []))
        return out

    def course_slugs(self, ids: list[str]) -> dict[str, str]:
        """Course id -> slug, which is how enrolment rows name the same course."""
        out: dict[str, str] = {}
        for batch in _batched(ids, 20):
            r = self._client.get(
                f"{CATALOG_BASE}/courses.v1", params={"ids": ",".join(batch), "fields": "slug"}
            )
            if r.status_code != 200:
                log.warning("coursera course slugs -> %s", r.status_code)
                continue
            for element in r.json().get("elements", []):
                out[str(element["id"])] = element.get("slug") or ""
        return out

    @staticmethod
    def normalize_specialization(element: dict[str, Any]) -> dict[str, Any]:
        slug = element.get("slug", "")
        # The two product variants live on different paths, and a link to the
        # wrong one 404s.
        path = (
            "professional-certificates"
            if element.get("productVariant") == "ProfessionalCertificateS12n"
            else "specializations"
        )
        return {
            "external_id": str(element.get("id", "")),
            "slug": slug,
            "name": (element.get("name") or slug).strip(),
            "course_ids": [str(c) for c in (element.get("courseIds") or [])],
            "partner_ids": [str(p) for p in (element.get("partnerIds") or [])],
            "logo_url": element.get("logo") or "",
            "url": f"https://www.coursera.org/{path}/{slug}" if slug else "",
        }

    def partner_names(self, partner_ids: list[str]) -> dict[str, str]:
        """Map partner ids to university/company names, for attribution."""
        if not partner_ids:
            return {}
        r = self._client.get(
            f"{CATALOG_BASE}/partners.v1",
            params={"ids": ",".join(partner_ids), "fields": "name,shortName"},
        )
        if r.status_code != 200:
            return {}
        return {str(e["id"]): e.get("name", "") for e in r.json().get("elements", [])}

    @staticmethod
    def normalize(element: dict[str, Any]) -> dict[str, Any]:
        """Catalog element -> the shape our Course model expects."""
        slug = element.get("slug", "")
        workload = element.get("workload") or ""
        return {
            "external_id": element.get("id", ""),
            "slug": slug,
            "title": (element.get("name") or slug).strip(),
            "summary": _first_paragraph(element.get("description") or ""),
            "cover_url": element.get("photoUrl") or "",
            "external_url": f"https://www.coursera.org/learn/{slug}" if slug else "",
            "workload": workload,
            "estimated_hours": parse_workload_hours(workload),
            "languages": element.get("primaryLanguages") or [],
            "partner_ids": [str(p) for p in (element.get("partnerIds") or [])],
            # A course sits in one or more domains; the first is its home.
            "domain": (element.get("domainTypes") or [{}])[0].get("domainId", ""),
            "subdomain": (element.get("domainTypes") or [{}])[0].get("subdomainId", ""),
        }


def _batched(items: list[str], size: int) -> Iterator[list[str]]:
    """The catalogue takes ids in batches; asking for 400 at once gets a 414."""
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _first_paragraph(text: str, limit: int = 480) -> str:
    """Course descriptions are long multi-paragraph marketing copy; a card
    only needs the opening sentence or two."""
    para = next((p.strip() for p in text.split("\n") if p.strip()), "")
    if len(para) <= limit:
        return para
    return para[:limit].rsplit(" ", 1)[0] + "…"


# --------------------------------------------------------------------------- #
# enterprise reporting (contract-gated)                                       #
# --------------------------------------------------------------------------- #


def record_hours(record: dict[str, Any]) -> tuple[float, bool]:
    """Hours spent on one enrollment, and whether that number is measured.

    The spec splits time across two keys by content type: `approxTotalCourseHrs`
    for a Course or Specialization, `approxTotalLearningHours` for a Video. Both
    are described as hours the learner *has spent*, so either one is measured
    time. Returning the flag alongside the number keeps the caller from having
    to re-derive it, and keeps a missing value (0.0, False) distinguishable from
    a real zero that we measured.
    """
    for key in ("approxTotalCourseHrs", "approxTotalLearningHours"):
        value = record.get(key)
        if value is not None:
            try:
                return round(float(value), 2), True
            except (TypeError, ValueError):
                break
    return 0.0, False


class CourseraReportingUnavailable(RuntimeError):
    """Raised when reporting is asked for but not configured."""


class CourseraReporting:
    """Enrollment/progress reporting for a Coursera for Business org.

    In `mock` mode this returns fixtures with the documented shape so the HR
    pipeline can be built, seeded and demoed without a contract.
    """

    def __init__(self):
        self.mode = settings.coursera_mode
        self.org_id = settings.coursera_org_id
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._client = httpx.Client(timeout=30.0)

    # -- auth ---------------------------------------------------------------

    def _bearer(self) -> str:
        """Cached client-credentials token; refreshed a minute before expiry."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        if not (settings.coursera_client_id and settings.coursera_client_secret):
            raise CourseraReportingUnavailable("COURSERA_CLIENT_ID/SECRET are not set.")
        r = self._client.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=(settings.coursera_client_id, settings.coursera_client_secret),
        )
        r.raise_for_status()
        payload = r.json()
        self._token = payload["access_token"]
        self._token_expires_at = time.time() + int(payload.get("expires_in", 1800))
        return self._token

    # -- reporting ----------------------------------------------------------

    def programs(self) -> list[dict[str, Any]]:
        """The organisation's programs — the cheapest call to prove entitlement.

        Documented as `GET /ent/api/businesses.v1/{businessId}/programs`.
        """
        if not self.org_id:
            raise CourseraReportingUnavailable("COURSERA_ORG_ID is not set.")
        r = self._client.get(
            f"{ENTERPRISE_BASE}/businesses.v1/{self.org_id}/programs",
            headers={"Authorization": f"Bearer {self._bearer()}"},
        )
        r.raise_for_status()
        return r.json().get("elements", [])

    def enrollment_reports(self, since: "dt.datetime | None" = None) -> Iterator[dict[str, Any]]:
        """Yield one `EnrollmentReport` per (learner × content).

        `since` maps to the spec's `lastActivityAfter` filter, so a nightly job
        pulls only what moved instead of the whole org every time.
        """
        if self.mode == "off":
            raise CourseraReportingUnavailable(
                "Coursera reporting is off. Set COURSERA_MODE=mock for a demo, "
                "or =live with an enterprise contract and API credentials."
            )
        if self.mode == "mock":
            yield from _MOCK_ENROLLMENTS
            return

        if not self.org_id:
            raise CourseraReportingUnavailable("COURSERA_ORG_ID is not set.")

        start: str | int = 0
        while True:
            params: dict[str, Any] = {"start": start, "limit": 100}
            if since is not None:
                params["lastActivityAfter"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")
            r = self._client.get(
                f"{ENTERPRISE_BASE}/businesses.v1/{self.org_id}/enrollmentReports",
                headers={"Authorization": f"Bearer {self._bearer()}"},
                params=params,
            )
            # 401 and 403 mean different things here and the fix differs:
            # 401 = the token was rejected; 403 = the token is fine but this app
            # is not authorised for this business.
            if r.status_code == 401:
                raise CourseraReportingUnavailable(
                    "Coursera rejected the token (401). Check COURSERA_CLIENT_ID "
                    "and COURSERA_CLIENT_SECRET."
                )
            if r.status_code == 403:
                raise CourseraReportingUnavailable(
                    f"Coursera denied access to business '{self.org_id}' (403). The "
                    "token is valid, so this is entitlement, not credentials: check "
                    "that COURSERA_ORG_ID matches your admin settings page, and that "
                    "the dev-portal app was registered by an organisation ADMIN "
                    "account — apps made with a personal account cannot reach "
                    "enterprise data."
                )
            if r.status_code == 404:
                raise CourseraReportingUnavailable(
                    f"No business '{self.org_id}' (404). The id is on top of your "
                    "Coursera organisation admin settings page."
                )
            r.raise_for_status()
            body = r.json()
            yield from body.get("elements", [])
            nxt = (body.get("paging") or {}).get("next")
            if not nxt:
                return
            start = nxt


# Fixtures in the spec's own `EnrollmentReport` shape. Emails match the seeded
# demo learners so the join onto `learners.email` actually resolves — the part
# most likely to break against real data.
#
# `approxTotalCourseHrs` is the field that matters most: the spec defines it as
# hours the learner *has spent* in the course, so Coursera time lands in the
# measured bucket rather than the estimated one. `overallProgress` alone could
# never support a Jour-Homme figure.
_MOCK_ENROLLMENTS: list[dict[str, Any]] = [
    {
        "id": "mock~1",
        "externalId": "youssef.benali@aida.local",
        "email": "youssef.benali@aida.local",
        "fullName": "Youssef Benali",
        "contentId": "0HiU7Oe4EeWTAQ4yevf_oQ",
        "contentType": "Course",
        "contentSlug": "machine-learning",
        "contentName": "Supervised Machine Learning: Regression and Classification",
        "partnerNames": ["DeepLearning.AI", "Stanford University"],
        "programName": "UpSkill — Data & AI",
        "programSlug": "aida-data-ai",
        "membershipState": "ACTIVE",
        "overallProgress": 100,
        "isCompleted": True,
        "grade": 0.94,
        "enrolledAt": "2026-06-02T08:30:00Z",
        "lastActivityAt": "2026-08-14T09:41:00Z",
        "completedAt": "2026-08-14T10:00:00Z",
        "approxTotalCourseHrs": 28.75,
        "contentCertificateUrl": "https://www.coursera.org/account/accomplishments/records/MOCK1",
        "courseType": "STANDARD_COURSE",
    },
    {
        "id": "mock~2",
        "externalId": "imane.zahraoui@aida.local",
        "email": "imane.zahraoui@aida.local",
        "fullName": "Imane Zahraoui",
        "contentId": "0HiU7Oe4EeWTAQ4yevf_oQ",
        "contentType": "Course",
        "contentSlug": "machine-learning",
        "contentName": "Supervised Machine Learning: Regression and Classification",
        "partnerNames": ["DeepLearning.AI", "Stanford University"],
        "programName": "UpSkill — Data & AI",
        "programSlug": "aida-data-ai",
        "membershipState": "ACTIVE",
        "overallProgress": 45,
        "isCompleted": False,
        "grade": None,
        "enrolledAt": "2026-07-20T14:05:00Z",
        "lastActivityAt": "2026-09-01T18:22:00Z",
        "completedAt": None,
        "approxTotalCourseHrs": 11.4,
        "contentCertificateUrl": None,
        "courseType": "STANDARD_COURSE",
    },
    {
        "id": "mock~3",
        "externalId": "nadia.bouzid@aida.local",
        "email": "nadia.bouzid@aida.local",
        "fullName": "Nadia Bouzid",
        "contentId": "AbCdEf12EeWTAQ4yevf_oQ",
        "contentType": "Specialization",
        "contentSlug": "google-data-analytics",
        "contentName": "Google Data Analytics",
        "partnerNames": ["Google"],
        "programName": "UpSkill — Data & AI",
        "programSlug": "aida-data-ai",
        "membershipState": "ACTIVE",
        "overallProgress": 72,
        "isCompleted": False,
        "grade": 0.88,
        "enrolledAt": "2026-05-11T07:00:00Z",
        "lastActivityAt": "2026-09-04T12:10:00Z",
        "completedAt": None,
        "approxTotalCourseHrs": 96.5,
        "contentCertificateUrl": None,
        "courseType": "STANDARD_COURSE",
    },
    {
        # A Video, not a Course: the spec reports its time under a different key
        # (`approxTotalLearningHours`). Reading only `approxTotalCourseHrs` would
        # silently count these as zero hours, so the mapping is exercised here.
        "id": "mock~5",
        "externalId": "salma.elbarbori@aida.local",
        "email": "salma.elbarbori@aida.local",
        "fullName": "Salma El Barbori",
        "contentId": "VidX7Oe4EeWTAQ4yevf_oQ",
        "contentType": "Video",
        "contentSlug": "intro-to-genai",
        "contentName": "Introduction to Generative AI",
        "partnerNames": ["Google Cloud"],
        "programName": "UpSkill — Data & AI",
        "programSlug": "aida-data-ai",
        "membershipState": "ACTIVE",
        "overallProgress": 100,
        "isCompleted": True,
        "grade": None,
        "enrolledAt": "2026-08-28T09:00:00Z",
        "lastActivityAt": "2026-08-28T09:20:00Z",
        "completedAt": "2026-08-28T09:20:00Z",
        "approxTotalLearningHours": 0.35,
        "contentCertificateUrl": None,
        "courseType": "STANDARD_COURSE",
    },
    {
        # Deliberately unmatched: nobody in AIDA has this address. The sync must
        # report it rather than silently drop it — an invisible drop is exactly
        # how these integrations quietly under-report.
        "id": "mock~4",
        "externalId": "someone.personal@gmail.com",
        "email": "someone.personal@gmail.com",
        "fullName": "Unknown Person",
        "contentId": "0HiU7Oe4EeWTAQ4yevf_oQ",
        "contentType": "Course",
        "contentSlug": "machine-learning",
        "contentName": "Supervised Machine Learning: Regression and Classification",
        "partnerNames": ["DeepLearning.AI"],
        "programName": "UpSkill — Data & AI",
        "programSlug": "aida-data-ai",
        "membershipState": "ACTIVE",
        "overallProgress": 100,
        "isCompleted": True,
        "grade": 0.81,
        "enrolledAt": "2026-04-01T09:00:00Z",
        "lastActivityAt": "2026-07-02T08:55:00Z",
        "completedAt": "2026-07-02T09:00:00Z",
        "approxTotalCourseHrs": 30.2,
        "contentCertificateUrl": "https://www.coursera.org/account/accomplishments/records/MOCK4",
        "courseType": "STANDARD_COURSE",
    },
]
