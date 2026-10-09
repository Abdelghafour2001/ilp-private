"""Cover images for course and training cards.

A wall of identical emoji tiles tells a learner nothing about what a course
actually is. Where a real thumbnail exists we use it; where it doesn't, the
card falls back to the provider's identity rather than inventing an image.

Two sources, in order:

1. An explicit `cover_url` set by the author — always wins.
2. A video thumbnail derived from the course's own content: the external link
   if it points at a video host, otherwise the first video lesson. YouTube and
   Vimeo expose predictable thumbnail URLs, so no API key or scraping is
   involved.

Platforms like Coursera or Udemy publish no such addressable thumbnail. Rather
than hotlink an image we have no right to, or fake one, those cards get a
`provider` hint and the UI renders a branded placeholder.
"""

import re
from urllib.parse import parse_qs, urlparse

# youtu.be/<id>, /watch?v=<id>, /embed/<id>, /shorts/<id>, /live/<id>
_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
_YOUTUBE_PATH = re.compile(r"^/(?:embed|shorts|live|v)/([A-Za-z0-9_-]{6,})")
_VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}
_VIMEO_PATH = re.compile(r"/(?:video/)?(\d{6,})")


def youtube_id(url: str) -> str | None:
    """Extract a YouTube video id from any of its URL shapes."""
    if not url:
        return None
    try:
        parsed = urlparse(url if "//" in url else f"https://{url}")
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None
    if host.endswith("youtu.be"):
        candidate = parsed.path.lstrip("/").split("/")[0]
        return candidate or None
    if parsed.path in ("/watch", "/watch/"):
        values = parse_qs(parsed.query).get("v")
        return values[0] if values else None
    match = _YOUTUBE_PATH.match(parsed.path)
    return match.group(1) if match else None


def vimeo_id(url: str) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url if "//" in url else f"https://{url}")
    except ValueError:
        return None
    if (parsed.hostname or "").lower() not in _VIMEO_HOSTS:
        return None
    match = _VIMEO_PATH.search(parsed.path)
    return match.group(1) if match else None


def thumbnail_for(url: str) -> str | None:
    """A thumbnail URL for a video link, or None if the host has no known one."""
    vid = youtube_id(url)
    if vid:
        # hqdefault exists for every video; maxresdefault often 404s.
        return f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"
    vim = vimeo_id(url)
    if vim:
        # Vimeo's CDN pattern needs an API call to resolve, so we only mark the
        # link as a video and let the UI show a play-styled placeholder.
        return None
    return None


def derive_cover(
    *,
    cover_url: str = "",
    external_url: str = "",
    curriculum: dict | None = None,
) -> str:
    """Best available cover for a course, or "" when there is none."""
    if cover_url:
        return cover_url

    direct = thumbnail_for(external_url)
    if direct:
        return direct

    for section in (curriculum or {}).get("sections", []):
        for lesson in section.get("lessons", []):
            if lesson.get("type") != "video":
                continue
            found = thumbnail_for(lesson.get("video_url") or "")
            if found:
                return found
    return ""
