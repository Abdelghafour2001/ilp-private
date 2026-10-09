"""Achievement catalog + the rules that award them.

Badges are evaluated server-side whenever a learner passes a step. Each rule is
a pure function of the learner's aggregate stats, so awarding is idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass
class Badge:
    id: str
    name: str
    description: str
    emoji: str
    rule: Callable[[dict], bool]


# `stats` shape: {xp, steps_passed, challenges_passed, sql_passed, code_passed,
#                 labs_touched, tracks_completed: set, current_streak,
#                 longest_streak, level, external_linked, external_completed,
#                 external_certificates, external_hours, external_partners}
def _g(stats: dict, key: str, default: float = 0):
    return stats.get(key, default) or default


BADGES: list[Badge] = [
    Badge("first_steps", "First Steps", "Pass your first lab step.", "🌱",
          lambda s: s["steps_passed"] >= 1),
    Badge("bug_hunter", "Bug Hunter", "Beat your first challenge.", "🐛",
          lambda s: s["challenges_passed"] >= 1),
    Badge("sql_slinger", "SQL Slinger", "Pass an exercise with SQL.", "🗡️",
          lambda s: s["sql_passed"] >= 1),
    Badge("code_runner", "Code Runner", "Pass an in-browser code exercise.", "💻",
          lambda s: _g(s, "code_passed") >= 1),
    Badge("centurion", "Centurion", "Earn 100 XP.", "💯",
          lambda s: s["xp"] >= 100),
    Badge("high_roller", "High Roller", "Earn 500 XP.", "🎰",
          lambda s: s["xp"] >= 500),
    Badge("on_a_roll", "On a Roll", "Pass 10 steps.", "🔥",
          lambda s: s["steps_passed"] >= 10),
    Badge("explorer", "Explorer", "Make progress in 5 different labs.", "🧭",
          lambda s: _g(s, "labs_touched") >= 5),
    Badge("week_warrior", "Week Warrior", "Reach a 7-day streak.", "📅",
          lambda s: _g(s, "longest_streak") >= 7),
    Badge("unstoppable", "Unstoppable", "Reach a 30-day streak.", "⚡",
          lambda s: _g(s, "longest_streak") >= 30),
    Badge("rising_star", "Rising Star", "Reach level 5.", "⭐",
          lambda s: _g(s, "level") >= 5),
    Badge("veteran", "Veteran", "Reach level 10.", "🏆",
          lambda s: _g(s, "level") >= 10),
    Badge("graduate", "Track Graduate", "Complete a full track.", "🎓",
          lambda s: len(s["tracks_completed"]) >= 1),
    Badge("polymath", "Polymath", "Complete three full tracks.", "🧠",
          lambda s: len(s["tracks_completed"]) >= 3),

    # --- learning done on a provider (Coursera & co.) -----------------------
    # Learning is learning wherever it happened. Without these, somebody who
    # finished 38 Coursera courses had nothing to show for it here, which is
    # exactly the gap the provider link was built to close.
    Badge("connected", "Connected", "Link your Coursera account to UpSkill.", "🔗",
          lambda s: bool(_g(s, "external_linked"))),
    Badge("outside_in", "Outside In", "Finish your first course on a provider.", "🌐",
          lambda s: _g(s, "external_completed") >= 1),
    Badge("certified", "Certified", "Earn your first provider certificate.", "🏅",
          lambda s: _g(s, "external_certificates") >= 1),
    Badge("serial_certifier", "Serial Certifier", "Earn five provider certificates.", "🎖️",
          lambda s: _g(s, "external_certificates") >= 5),
    Badge("ten_up", "Ten Up", "Finish ten courses on a provider.", "🔟",
          lambda s: _g(s, "external_completed") >= 10),
    Badge("marathon", "Marathon", "Spend 25 hours learning on a provider.", "⏳",
          lambda s: _g(s, "external_hours") >= 25),
    Badge("well_rounded", "Well Rounded", "Finish courses from three different partners.", "🧩",
          lambda s: _g(s, "external_partners") >= 3),
    # A specialization is several courses and a few months of somebody's
    # evenings. It is the one external achievement worth its own mark.
    Badge("specialist", "Specialist", "Complete a full specialization on a provider.", "🎖",
          lambda s: _g(s, "external_specializations") >= 1),
    # The one that says the whole point: both platforms, one learner.
    Badge("both_worlds", "Both Worlds", "Learn on UpSkill and on a provider.", "🌉",
          lambda s: s["steps_passed"] >= 1 and _g(s, "external_completed") >= 1),
]

BADGES_BY_ID = {b.id: b for b in BADGES}


def evaluate(stats: dict) -> list[str]:
    """Return the ids of all badges the learner currently qualifies for."""
    return [b.id for b in BADGES if b.rule(stats)]


def catalog() -> list[dict]:
    return [
        {"id": b.id, "name": b.name, "description": b.description, "emoji": b.emoji}
        for b in BADGES
    ]
