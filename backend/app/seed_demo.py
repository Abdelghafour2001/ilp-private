"""Populate the app with realistic demo content so the platform looks alive in a
demo: learners (with XP + badges), courses, challenges (with submissions/votes),
assets, and sharing sessions (with a real, downloadable deck file).

Run it once after migrations:

    python -m app.seed_demo          # skips if courses already exist
    python -m app.seed_demo --force  # add the demo content anyway

In Docker:  docker compose exec backend python -m app.seed_demo
"""

from __future__ import annotations

import sys
import uuid
from datetime import date, timedelta
# comment section testing merge
from app.api.routes.sharing import _uploads_dir
from app.db.session import SessionLocal
from app.models import (
    Achievement,
    Asset,
    Challenge,
    ChallengeSubmission,
    ChallengeVote,
    Course,
    Learner,
    SharingSession,
    StepCompletion,
)


def _minimal_pdf(title: str) -> bytes:
    """A tiny but valid one-page PDF used as a placeholder slide deck."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 240] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ]
    stream = f"BT /F1 22 Tf 40 140 Td ({title}) Tj ET".encode()
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objs) + 1
    out += b"xref\n0 " + str(n).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size " + str(n).encode() + b" /Root 1 0 R >>\nstartxref\n"
        + str(xref_pos).encode()
        + b"\n%%EOF"
    )
    return out


def _write_deck(title: str) -> tuple[str, str]:
    stored = f"{uuid.uuid4().hex}.pdf"
    (_uploads_dir() / stored).write_bytes(_minimal_pdf(title))
    return stored, f"{title}.pdf"


def seed(db) -> None:
    today = date.today()

    # --- learners (handle -> xp) ---
    people = {"ava": 320, "liam": 210, "maya": 140, "noah": 90}
    learners: dict[str, Learner] = {}
    for handle, xp in people.items():
        learner = Learner(handle=handle, xp=xp)
        db.add(learner)
        learners[handle] = learner
    db.flush()

    # badges + a few completed steps for realism
    for handle, badges in {
        "ava": ["first_steps", "bug_hunter", "sql_slinger", "centurion", "graduate"],
        "liam": ["first_steps", "bug_hunter", "centurion"],
        "maya": ["first_steps", "sql_slinger"],
        "noah": ["first_steps"],
    }.items():
        for b in badges:
            db.add(Achievement(learner_id=learners[handle].id, badge_id=b))
    for lab_id, step_id in [("python-basics", "add"), ("python-basics", "evens"),
                            ("ai-foundations", "ground-llm"), ("ai-foundations", "what-embedding")]:
        db.add(StepCompletion(learner_id=learners["ava"].id, lab_id=lab_id, step_id=step_id, xp_awarded=20))

    # --- courses ---
    db.add(Course(
        title="Data Quality Crash Course",
        summary="Go from zero to catching real bugs in real data — checks, validity, and anomalies.",
        level="beginner", emoji="🧪", tags=["data-quality", "sql"],
        author="ava", learner_id=learners["ava"].id, status="published",
        curriculum={"sections": [
            {"title": "Foundations", "lessons": [
                {"id": "a1", "title": "Why data quality matters", "type": "article",
                 "body_md": "Bad data breaks dashboards and erodes trust. In this course you'll **catch** it.\n\n- Completeness\n- Validity\n- Uniqueness", "options": []},
                {"id": "a2", "title": "Catching missing values", "type": "article", "body_md": "A **not-null** check counts the rows where a required column is empty. Start there: missing values are the most common defect and the cheapest to catch.", "options": []},
                {"id": "a3", "title": "Quick check", "type": "quiz",
                 "question": "Which check ensures a column has no NULLs?", "options": ["not_null", "range", "regex"], "answer": "not_null", "body_md": ""},
            ]},
            {"title": "Going further", "lessons": [
                {"id": "b1", "title": "Validity & allowed values", "type": "article", "body_md": "An **accepted-values** check constrains a column to a known set — a status that can only be `active`, `paused` or `closed`, say. Anything else is a defect worth surfacing.", "options": []},
                {"id": "b2", "title": "Wrap-up", "type": "article", "body_md": "You can now profile a table and write meaningful checks. 🎉", "options": []},
            ]},
        ]},
    ))
    db.add(Course(
        title="AI Engineering 101",
        summary="The concepts behind shipping LLM features — embeddings, RAG, and evaluation.",
        level="beginner", emoji="🤖", tags=["ai", "llm", "rag"],
        author="liam", learner_id=learners["liam"].id, status="published",
        curriculum={"sections": [
            {"title": "Concepts", "lessons": [
                {"id": "c1", "title": "What is RAG?", "type": "article", "body_md": "Retrieval-augmented generation grounds an LLM in **your** data.", "options": []},
                {"id": "c2", "title": "Neural networks, visually", "type": "video", "video_url": "https://www.youtube.com/watch?v=aircAruvnKk", "body_md": "A gentle visual intro.", "options": []},
                {"id": "c3", "title": "Check your understanding", "type": "quiz",
                 "question": "What does a vector database optimize for?", "options": ["nearest-neighbor search", "ACID transactions", "message queues"], "answer": "nearest-neighbor search", "body_md": ""},
            ]},
            {"title": "Practice", "lessons": [
                {"id": "d1", "title": "Hands-on: AI foundations", "type": "lab", "lab_id": "ai-foundations", "body_md": "Test the core concepts.", "options": []},
            ]},
        ]},
    ))

    # --- challenges + submissions + votes ---
    ch1 = Challenge(
        title="Cut our data pipeline costs by 30%",
        summary="Our nightly ELT bill is climbing. Pitch a concrete way to cut it.",
        brief_md="## The problem\nWarehouse + orchestration costs are up 40% YoY.\n\n## What we want\nA concrete, testable idea — query tuning, incremental models, scheduling, storage tiering, anything.\n\n## Judging\nImpact, feasibility, effort.",
        theme="Efficiency", prize="Lunch on the BU + eternal glory", deadline=today + timedelta(days=21),
        status="open", tags=["cost", "elt"], author="maya", learner_id=learners["maya"].id,
    )
    ch2 = Challenge(
        title="Best internal GenAI use case",
        summary="Where would an LLM save the team the most time?",
        brief_md="Pitch an internal GenAI use case we could prototype in a week.",
        theme="GenAI", prize="Featured at the next all-hands", deadline=today + timedelta(days=14),
        status="open", tags=["genai", "productivity"], author="ava", learner_id=learners["ava"].id,
    )
    db.add_all([ch1, ch2])
    db.flush()

    subs = [
        ChallengeSubmission(challenge_id=ch1.id, title="Switch fact models to incremental",
            summary="Stop full-refreshing the 2 biggest tables.", body_md="Most rows never change. Incremental dbt models would cut nightly compute ~50% on those two alone.",
            author="liam", learner_id=learners["liam"].id),
        ChallengeSubmission(challenge_id=ch1.id, title="Tier cold data to object storage",
            summary="Move >1y-old partitions to S3/MinIO, query via Trino.", body_md="Keep hot data in the warehouse; everything older queried in-place from the lake.",
            author="noah", learner_id=learners["noah"].id),
        ChallengeSubmission(challenge_id=ch1.id, title="Right-size the warehouse",
            summary="Auto-suspend + smaller default size.", body_md="We run XL all day; most queries fit in M.",
            author="ava", learner_id=learners["ava"].id),
        ChallengeSubmission(challenge_id=ch2.id, title="Auto-draft sharing-session summaries",
            summary="LLM turns a deck into a write-up for the archive.", body_md="Upload slides, get a first-draft summary + tags automatically.",
            author="maya", learner_id=learners["maya"].id),
        ChallengeSubmission(challenge_id=ch2.id, title="RAG over our runbooks",
            summary="Ask questions, get sourced answers.", body_md="Index Confluence + repos; on-call asks in plain English.",
            author="ava", learner_id=learners["ava"].id),
    ]
    db.add_all(subs)
    db.flush()

    # votes (idempotent per learner+submission)
    votes = [(subs[0], ["ava", "maya", "noah"]), (subs[1], ["liam"]),
             (subs[3], ["ava", "liam", "noah"]), (subs[4], ["maya"])]
    for sub, voters in votes:
        for v in voters:
            db.add(ChallengeVote(submission_id=sub.id, learner_id=learners[v].id))

    # --- assets ---
    # `status` is set explicitly: the model defaults new assets to "pending"
    # (F-06 approval workflow), and pending assets are hidden from everyone but
    # their author and HR — so seeding without it leaves the Assets page empty.
    # Most are approved for the public wall; two are left pending/rejected so
    # the manager review queue is demoable too.
    db.add_all([
        Asset(title="Churn EDA notebook", kind="notebook", summary="Exploratory analysis of last quarter's churn.",
              body_md="Covers cohort retention curves and the top 5 churn predictors.", link="https://example.com/notebooks/churn-eda",
              tags=["churn", "eda"], author="ava", learner_id=learners["ava"].id,
              status="approved", reviewed_by="maya"),
        Asset(title="Reusable DQ check decorator", kind="code", summary="A Python decorator that asserts a DataFrame check and logs failures.",
              body_md="Drop-in for pandas pipelines.", code="def expect(check):\n    def deco(fn):\n        ...\n    return deco",
              tags=["python", "data-quality"], author="liam", learner_id=learners["liam"].id,
              status="approved", reviewed_by="maya"),
        Asset(title="Lead-scoring baseline", kind="model", summary="Logistic-regression baseline + MLflow run.",
              body_md="0.81 AUC, fully reproducible.", link="https://example.com/mlflow/lead-scoring",
              tags=["ml", "mlflow"], author="maya", learner_id=learners["maya"].id,
              status="approved", reviewed_by="ava"),
        # awaiting review — shows up in the manager's queue
        Asset(title="Auto-document our dbt models", kind="idea", summary="Generate model docs from SQL + column lineage.",
              body_md="Half our models lack descriptions. An LLM pass could draft them from the SQL.", tags=["dbt", "genai"],
              author="noah", learner_id=learners["noah"].id,
              status="pending"),
        # rejected with a reason — shows the author-side feedback path
        Asset(title="Cleaned customer sample", kind="dataset", summary="A 10k-row anonymized sample for prototyping.",
              body_md="PII-stripped, ready for notebooks.", link="https://example.com/data/customers-sample.parquet",
              tags=["dataset", "sample"], author="ava", learner_id=learners["ava"].id,
              status="rejected", reviewed_by="maya",
              review_note="Merci — repasse la colonne email au hachage avant publication."),
    ])

    # --- sharing sessions (two with real downloadable decks) ---
    f1, n1 = _write_deck("Intro to our Lakehouse")
    f3, n3 = _write_deck("dbt best practices")
    db.add_all([
        SharingSession(title="Intro to our Lakehouse", abstract="How we query Parquet on object storage with Trino.",
            body_md="We walked through the MinIO + Hive Metastore + Trino setup and a few federation queries.",
            presenter="maya", session_date=today - timedelta(days=10), tags=["lakehouse", "trino"],
            file_name=f1, file_original_name=n1, recording_url="https://example.com/rec/lakehouse",
            author="maya", learner_id=learners["maya"].id),
        SharingSession(title="RAG in production: lessons learned", abstract="What broke when we shipped our first RAG feature.",
            body_md="Chunking, eval, and why retrieval quality matters more than the model.",
            presenter="liam", session_date=today - timedelta(days=4), tags=["rag", "llm"],
            recording_url="https://example.com/rec/rag", author="liam", learner_id=learners["liam"].id),
        SharingSession(title="dbt best practices", abstract="Conventions that kept our project sane.",
            body_md="Layering, testing, and naming standards.", presenter="ava", session_date=today - timedelta(days=1),
            tags=["dbt"], file_name=f3, file_original_name=n3, author="ava", learner_id=learners["ava"].id),
    ])

    db.commit()


def main() -> None:
    force = "--force" in sys.argv
    db = SessionLocal()
    try:
        if db.query(Course).count() > 0 and not force:
            print("Demo content already present (courses exist). Use --force to add anyway.")
            return
        seed(db)
        print("✓ Seeded demo learners, courses, challenges, assets, and sharing sessions.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
