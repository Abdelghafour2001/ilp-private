"""Fill the course catalogue from real providers.

Twenty-six courses is a demo, not a catalogue. This pulls the Coursera public
catalogue in bulk — which brings DeepLearning.AI, Google, IBM, Stanford and the
rest with it, since they publish there — and adds a short list of free YouTube
courses.

Nothing here is invented. Every Coursera row comes from the catalogue API with
its own title, description, cover art and workload. Every YouTube row is
confirmed through oEmbed first: a URL that does not resolve is dropped rather
than written from memory, so a dead link never becomes a catalogue entry.

    podman exec -i <backend> python - < app/ops_stock_catalogue.py
"""

from __future__ import annotations

import httpx

from app.connectors.coursera import CourseraCatalog
from app.db.session import SessionLocal
from app.models import Course, content_status

# How much of the catalogue to walk. 100 per request is the API's ceiling.
PAGES = 8
PER_PAGE = 100

OEMBED = "https://www.youtube.com/oembed"

# YouTube has no taxonomy to read, so these sit in the same vocabulary Coursera
# uses — otherwise the filter would list two spellings of one subject.
YOUTUBE_DOMAIN = {
    "AI": "data-science",
    "Data": "data-science",
    "Programming": "computer-science",
}

# Free courses that live on YouTube rather than a provider platform. These are
# candidates only: each is checked against oEmbed below and dropped if it does
# not resolve, so the list can be edited without fear of adding a broken entry.
YOUTUBE_CANDIDATES = [
    ("https://www.youtube.com/playlist?list=PLkDaE6sCZn6Ec-XTbcX1uRg2_u4xOEky0", "AI", 20.0),
    ("https://www.youtube.com/playlist?list=PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU", "AI", 20.0),
    ("https://www.youtube.com/playlist?list=PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi", "AI", 4.0),
    ("https://www.youtube.com/playlist?list=PLrS7FeaGSS4CkbWgFj5vdbrTaeq3ryhdV", "Data", 6.0),
    ("https://www.youtube.com/watch?v=rfscVS0vtbw", "Programming", 4.5),
    ("https://www.youtube.com/watch?v=HXV3zeQKqGY", "Data", 4.0),
    ("https://www.youtube.com/watch?v=_uQrJ0TkZlc", "Programming", 6.0),
    ("https://www.youtube.com/watch?v=aircAruvnKk", "AI", 1.0),
    ("https://www.youtube.com/watch?v=PkZNo7MFNFg", "Programming", 3.5),
    ("https://www.youtube.com/watch?v=SqcY0GlETPk", "Programming", 4.0),
    ("https://www.youtube.com/watch?v=Ke90Tje7VS0", "Programming", 5.0),
    ("https://www.youtube.com/watch?v=RBSGKlAvoiM", "Data", 4.0),
    ("https://www.youtube.com/watch?v=7eh4d6sabA0", "Programming", 4.0),
    ("https://www.youtube.com/watch?v=kqtD5dpn9C8", "Programming", 1.5),
    ("https://www.youtube.com/watch?v=VPvVD8t02U8", "Data", 3.0),
]


def upsert(db, *, title, summary, provider, url, cover, hours, author, tags, level="beginner", domain="", subdomain=""):
    """One catalogue entry, keyed on its URL so a re-run refreshes rather than duplicates."""
    course = db.query(Course).filter(Course.external_url == url).first()
    fresh = course is None
    if fresh:
        course = Course(title=title)
        db.add(course)
    course.title = title[:200]
    course.summary = (summary or "")[:2000]
    course.emoji = "🎓" if provider == "Coursera" else "▶️"
    course.provider = provider
    course.external_url = url
    course.cover_url = cover or ""
    course.external_hours = hours or 0
    course.author = author or provider
    course.tags = tags
    course.level = level
    course.domain = domain
    course.subdomain = subdomain
    # An admin ran this import, so these are catalogue entries, not submissions.
    course.status = content_status.PUBLISHED
    return fresh


def stock_coursera(db) -> tuple[int, int]:
    added = refreshed = 0
    with CourseraCatalog() as catalog:
        for page in range(PAGES):
            batch = catalog.browse(limit=PER_PAGE, start=page * PER_PAGE)
            if not batch:
                break

            # One partner lookup per page, not one per course.
            ids: list[str] = []
            for item in batch:
                ids.extend(item.get("partner_ids") or [])
            names = catalog.partner_names(sorted(set(ids))[:200]) if ids else {}

            for item in batch:
                if not item.get("external_url"):
                    continue
                partners = [names.get(str(i), "") for i in (item.get("partner_ids") or [])]
                partners = [p for p in partners if p]
                fresh = upsert(
                    db,
                    title=item["title"],
                    summary=item["summary"],
                    provider="Coursera",
                    url=item["external_url"],
                    cover=item["cover_url"],
                    hours=item.get("estimated_hours") or 0,
                    author=partners[0] if partners else "Coursera",
                    # Tags carry the subject, not the publisher: the publisher
                    # is already the author, and a tag reading "Packt" tells a
                    # learner nothing about what they would be learning.
                    tags=[x for x in (item.get("domain"), item.get("subdomain")) if x],
                    domain=item.get("domain") or "",
                    subdomain=item.get("subdomain") or "",
                )
                added, refreshed = (added + 1, refreshed) if fresh else (added, refreshed + 1)
            db.commit()
            print(f"  coursera page {page + 1}/{PAGES}: {added} new, {refreshed} refreshed")
    return added, refreshed


def stock_youtube(db) -> tuple[int, int]:
    """Only what oEmbed confirms. A candidate that does not resolve is skipped."""
    added = dropped = 0
    client = httpx.Client(timeout=15, follow_redirects=True)
    for url, topic, hours in YOUTUBE_CANDIDATES:
        try:
            r = client.get(OEMBED, params={"url": url, "format": "json"})
        except Exception:
            dropped += 1
            continue
        if r.status_code != 200:
            dropped += 1
            print(f"  dropped (unresolvable): {url}")
            continue
        meta = r.json()
        upsert(
            db,
            title=meta.get("title") or url,
            summary=f"Free course on YouTube by {meta.get('author_name', 'unknown')}.",
            provider="YouTube",
            url=url,
            cover=meta.get("thumbnail_url") or "",
            hours=hours,
            author=meta.get("author_name") or "YouTube",
            tags=[topic, "free"],
            domain=YOUTUBE_DOMAIN.get(topic, ""),
            subdomain="",
        )
        added += 1
    db.commit()
    client.close()
    return added, dropped


def main() -> None:
    db = SessionLocal()
    before = db.query(Course).count()

    new_c, refreshed = stock_coursera(db)
    new_y, dropped = stock_youtube(db)

    total = db.query(Course).count()
    print()
    print(f"coursera: {new_c} added, {refreshed} refreshed")
    print(f"youtube:  {new_y} added, {dropped} candidates dropped as unresolvable")
    print(f"catalogue: {before} -> {total} courses")

    by_provider = {}
    for (provider,) in db.query(Course.provider).all():
        by_provider[provider or "UpSkill"] = by_provider.get(provider or "UpSkill", 0) + 1
    for provider, n in sorted(by_provider.items(), key=lambda kv: -kv[1]):
        print(f"  {provider or 'UpSkill'}: {n}")
    db.close()


if __name__ == "__main__":
    main()
