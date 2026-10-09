"""The report builder: datasets, ad-hoc queries, and saved views.

HR asked for something closer to a BI tool than a fixed dashboard — upload a
file, choose what to group by and what to measure, filter it, save the result
under a name and come back to it.

Two kinds of dataset sit side by side. **Builtin** ones are AIDA's own data
(collaborators, programmes) exposed through the same interface, so the builder
is useful before anyone has uploaded anything and so the uploaded numbers can be
read against the platform's own. **Uploads** are whatever HR brings — last
year's training log, a budget sheet, a headcount extract.

Access follows the reporting model already in `rbac`: a builder that ignored
perimeters would be the easiest way around them. A builtin dataset is generated
inside the caller's scope, so an HRBP grouping "hours by BU" sees their BUs and
no others — the same answer the fixed dashboard gives them.
"""

import datetime as dt
import logging

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.datasets import AGGREGATIONS, OPERATORS, aggregate, parse_upload
from app.core.exporters import Chart, build_pdf, build_xlsx
from app.core.rbac import is_admin_token, reporting_scope
from app.db.session import get_db
from app.models import Dataset, DatasetRow, Learner, SavedView

log = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


# --------------------------------------------------------------------------- #
# access                                                                      #
# --------------------------------------------------------------------------- #


def _viewer(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    if not (is_admin_token(token) or learner_id):
        raise HTTPException(status_code=403, detail="Only HR or admins can use reports.")
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not is_admin_token(token):
        if not viewer or viewer.role not in ("hr", "hr_lead", "admin"):
            raise HTTPException(
                status_code=403, detail="Only HR or admins can use reports."
            )
    return viewer


# --------------------------------------------------------------------------- #
# builtin datasets — AIDA's own data, through the same door                    #
# --------------------------------------------------------------------------- #

# How many grouped rows a query may return. The result table pages, so this is
# about protecting the payload, not the screen: one row per person across a
# 275-strong roster has to fit under it or a per-person report quietly drops
# people off the end.
ROW_CAP = 1000

BUILTINS = {
    "collaborators": "Collaborateurs — heures UpSkill et Coursera, Jour-Homme, présence",
    "programmes": "Programmes — inscrits, complétion, heures",
    "coursera": "Coursera — une ligne par inscription, toute la population du fournisseur",
}


def _builtin_rows(db: Session, key: str, viewer: Learner | None, token: str | None):
    """Generate a builtin dataset inside the caller's reporting perimeter."""
    # Imported here rather than at module load: analytics imports plenty, and a
    # cycle between the two reporting modules is easy to create and annoying to
    # unpick.
    from app.api.routes.analytics import hr_analytics

    report = hr_analytics(
        learner_id=viewer.id if viewer else None, x_admin_token=token, db=db
    )

    if key == "collaborators":
        columns = [
            {"name": "Collaborateur", "type": "text"},
            # The address their record is keyed by, so a per-person report can
            # open the person rather than just name them.
            {"name": "Email", "type": "text"},
            {"name": "Matricule", "type": "text"},
            {"name": "BU", "type": "text"},
            {"name": "Practice", "type": "text"},
            {"name": "Location", "type": "text"},
            {"name": "Job level", "type": "text"},
            # The learner's own level and XP: the platform's measure of them,
            # next to the HR grade, which is the company's.
            {"name": "Niveau", "type": "number"},
            {"name": "XP", "type": "number"},
            {"name": "Équipe", "type": "text"},
            {"name": "Heures totales", "type": "number"},
            {"name": "Heures UpSkill", "type": "number"},
            {"name": "Heures Coursera", "type": "number"},
            {"name": "Jour-Homme", "type": "number"},
            {"name": "Heures mesurées", "type": "number"},
            {"name": "Heures déclarées", "type": "number"},
            {"name": "Cours Coursera", "type": "number"},
            {"name": "Complétés Coursera", "type": "number"},
            {"name": "Complétion Coursera", "type": "number"},
            {"name": "Certificats Coursera", "type": "number"},
            {"name": "Formations", "type": "number"},
            {"name": "Cours", "type": "number"},
            {"name": "Taux de présence", "type": "number"},
        ]
        rows = [
            {
                "Collaborateur": r.get("name") or r.get("handle"),
                "Email": r.get("coursera_email") or r.get("email") or None,
                "Matricule": r.get("matricule") or None,
                "BU": r.get("bu") or None,
                "Practice": r.get("practice") or None,
                "Location": r.get("location") or None,
                "Job level": r.get("job_level") or None,
                "Niveau": r.get("level"),
                "XP": r.get("xp"),
                "Équipe": r.get("team") or None,
                "Heures totales": r.get("hours"),
                "Heures UpSkill": r.get("app_hours"),
                "Heures Coursera": r.get("external_hours"),
                "Jour-Homme": r.get("man_days"),
                "Heures mesurées": r.get("session_hours"),
                "Heures déclarées": r.get("declared_hours"),
                "Cours Coursera": r.get("external_courses"),
                "Complétés Coursera": r.get("external_completed"),
                "Complétion Coursera": r.get("external_completion_rate"),
                "Certificats Coursera": r.get("external_certificates"),
                "Formations": r.get("trainings_followed"),
                "Cours": r.get("courses_followed"),
                "Taux de présence": r.get("attendance_rate"),
            }
            for r in report.get("collaborators", [])
        ]

        # `hr_analytics` only returns people who did something, which is right
        # for an engagement KPI and wrong for a roster: "who has done nothing"
        # is exactly the question a report like this gets asked. Everyone else
        # in scope is appended with zeros rather than left out.
        from app.labs import gamification

        seen = {r.get("Email") for r in rows if r.get("Email")}
        seen_names = {r.get("Collaborateur") for r in rows}
        scope = reporting_scope(db, viewer, token)
        for learner in db.query(Learner).all():
            if not scope.allows(learner.id):
                continue
            name = learner.name or learner.handle
            if (learner.email and learner.email in seen) or name in seen_names:
                continue
            rows.append({
                "Collaborateur": name,
                "Email": learner.email or None,
                "Matricule": learner.matricule or None,
                "BU": learner.bu or None,
                "Practice": learner.practice or None,
                "Location": learner.location or None,
                "Job level": learner.job_level or None,
                "Niveau": gamification.level_info(learner.xp or 0)["level"],
                "XP": learner.xp or 0,
                "Équipe": None,
                "Heures totales": 0,
                "Heures UpSkill": 0,
                "Heures Coursera": 0,
                "Jour-Homme": 0,
                "Heures mesurées": 0,
                "Heures déclarées": 0,
                "Cours Coursera": 0,
                "Complétés Coursera": 0,
                "Complétion Coursera": None,
                "Certificats Coursera": 0,
                "Formations": 0,
                "Cours": 0,
                "Taux de présence": None,
            })
        return columns, rows

    if key == "coursera":
        # One row per enrolment, so the builder can group by person, unit,
        # programme or partner and measure hours the same way it measures
        # anything else. Deliberately the provider's whole population rather
        # than the perimeter: most of these people have no account here, and a
        # BU-scoped Coursera report would show a fraction of the truth while
        # looking complete.
        from app.models import ExternalEnrollment

        columns = [
            {"name": "Personne", "type": "text"},
            {"name": "Email", "type": "text"},
            {"name": "BU fournisseur", "type": "text"},
            {"name": "Poste", "type": "text"},
            {"name": "Manager", "type": "text"},
            {"name": "Site", "type": "text"},
            {"name": "Programme", "type": "text"},
            {"name": "Contenu", "type": "text"},
            {"name": "Partenaire", "type": "text"},
            {"name": "Type de contenu", "type": "text"},
            {"name": "Statut", "type": "text"},
            {"name": "Avancement", "type": "number"},
            {"name": "Note", "type": "number"},
            {"name": "Heures", "type": "number"},
            {"name": "Certificat", "type": "text"},
            {"name": "Compte UpSkill", "type": "text"},
            {"name": "Inscrit le", "type": "date"},
            {"name": "Terminé le", "type": "date"},
            {"name": "Dernière activité", "type": "date"},
        ]

        def _status(row) -> str:
            if row.completed:
                return "Terminé"
            return "Jamais ouvert" if (row.progress_pct or 0) < 1 else "En cours"

        rows = [
            {
                "Personne": row.full_name or row.matched_email,
                "Email": row.matched_email,
                "BU fournisseur": row.business_unit or None,
                "Poste": row.job_title or None,
                "Manager": row.manager_name or None,
                "Site": row.location_city or None,
                "Programme": row.program_name or None,
                "Contenu": row.course_title or row.course_slug,
                "Partenaire": row.partner_names or None,
                "Type de contenu": row.content_type or None,
                "Statut": _status(row),
                "Avancement": row.progress_pct or 0,
                "Note": round(100 * row.grade) if row.grade is not None else None,
                "Heures": round(row.hours or 0.0, 2),
                "Certificat": "oui" if row.certificate_url else "non",
                "Compte UpSkill": "oui" if row.learner_id else "non",
                "Inscrit le": row.enrolled_at.date().isoformat() if row.enrolled_at else None,
                "Terminé le": row.completed_at.date().isoformat() if row.completed_at else None,
                "Dernière activité": (
                    row.last_activity_at.date().isoformat() if row.last_activity_at else None
                ),
            }
            for row in db.query(ExternalEnrollment)
            .filter(ExternalEnrollment.provider == "coursera")
            .all()
        ]
        return columns, rows

    columns = [
        {"name": "Programme", "type": "text"},
        {"name": "Type", "type": "text"},
        {"name": "Niveau", "type": "text"},
        {"name": "Mode", "type": "text"},
        {"name": "Interne/Externe", "type": "text"},
        {"name": "Prestataire", "type": "text"},
        {"name": "Responsable", "type": "text"},
        {"name": "Inscrits", "type": "number"},
        {"name": "Leçons", "type": "number"},
        {"name": "Heures prévues", "type": "number"},
        {"name": "Heures réelles", "type": "number"},
        {"name": "Sessions tenues", "type": "number"},
        {"name": "Taux de complétion", "type": "number"},
        {"name": "Note moyenne", "type": "number"},
    ]

    rows = []
    for r in report.get("content", []):
        row = {
            "Programme": r.get("title"),
            "Type": "Formation" if r.get("type") == "formation" else "Cours",
            "Niveau": r.get("level") or None,
            "Mode": r.get("format") or None,
            "Interne/Externe": r.get("source"),
            "Prestataire": r.get("provider") or None,
            "Responsable": r.get("owner") or None,
            "Inscrits": r.get("subscribers"),
            "Leçons": r.get("lessons"),
            "Heures prévues": r.get("planned_hours"),
            "Heures réelles": r.get("hours"),
            "Sessions tenues": r.get("sessions_held"),
            "Taux de complétion": r.get("completion_rate"),
            "Note moyenne": r.get("avg_stars"),
        }
        rows.append(row)
    return columns, rows


def _load(db: Session, dataset_id: int, viewer: Learner | None, token: str | None):
    """(dataset, columns, rows) for either kind of dataset."""
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset introuvable.")
    if dataset.kind == "builtin":
        columns, rows = _builtin_rows(db, dataset.source_key, viewer, token)
        return dataset, columns, rows
    rows = [
        r.data
        for r in db.query(DatasetRow)
        .filter(DatasetRow.dataset_id == dataset.id)
        .order_by(DatasetRow.idx)
        .all()
    ]
    return dataset, list(dataset.columns or []), rows


# The questions L&D actually asks, answered before anybody builds anything.
# The builder is powerful and blank, and a blank canvas is the wrong thing to
# hand somebody who wants "the training hours by BU". Seeded as shared views so
# the whole team opens the same figure rather than six near-identical ones.
DEFAULT_VIEWS: list[dict] = [
    {
        "dataset": "collaborators",
        "name": "Heures de formation par BU",
        "description": "UpSkill et Coursera côte à côte, par business unit.",
        "config": {
            "dimensions": ["BU"],
            "measures": [
                {"column": "Heures UpSkill", "agg": "sum", "label": "sum(Heures UpSkill)"},
                {"column": "Heures Coursera", "agg": "sum", "label": "sum(Heures Coursera)"},
            ],
            "filters": [],
            "chart": "bar",
        },
    },
    {
        "dataset": "collaborators",
        "name": "Jour-Homme par practice",
        "description": "La conversion en jours-homme, par practice.",
        "config": {
            "dimensions": ["Practice"],
            "measures": [{"column": "Jour-Homme", "agg": "sum", "label": "sum(Jour-Homme)"}],
            "filters": [],
            "chart": "column",
        },
    },
    {
        "dataset": "collaborators",
        "name": "Certificats Coursera par BU",
        "description": "Où les certificats sont obtenus.",
        "config": {
            "dimensions": ["BU"],
            "measures": [
                {"column": "Certificats Coursera", "agg": "sum", "label": "sum(Certificats Coursera)"}
            ],
            "filters": [],
            "chart": "bar",
        },
    },
    {
        "dataset": "coursera",
        "name": "Avancement Coursera par statut",
        "description": "Terminé, en cours, jamais ouvert — la répartition des inscriptions.",
        "config": {
            "dimensions": ["Statut"],
            "measures": [{"column": "Personne", "agg": "count", "label": "count(Personne)"}],
            "filters": [],
            "chart": "donut",
        },
    },
    {
        "dataset": "coursera",
        "name": "Heures Coursera par programme",
        "description": "Où le temps part, programme par programme.",
        "config": {
            "dimensions": ["Programme"],
            "measures": [{"column": "Heures", "agg": "sum", "label": "sum(Heures)"}],
            "filters": [],
            "chart": "bar",
        },
    },
    {
        "dataset": "coursera",
        "name": "Licences jamais ouvertes",
        "description": "Les inscriptions payées et jamais commencées, par BU fournisseur.",
        "config": {
            "dimensions": ["BU fournisseur"],
            "measures": [{"column": "Personne", "agg": "count", "label": "count(Personne)"}],
            "filters": [{"column": "Statut", "op": "=", "value": "Jamais ouvert"}],
            "chart": "column",
        },
    },
    {
        "dataset": "programmes",
        "name": "Taux de complétion par programme",
        "description": "Ce que les gens finissent, et ce qu'ils abandonnent.",
        "config": {
            "dimensions": ["Programme"],
            "measures": [
                {"column": "Taux complétion %", "agg": "avg", "label": "avg(Taux complétion %)"}
            ],
            "filters": [],
            "chart": "bar",
        },
    },
]


def _ensure_builtins(db: Session) -> None:
    """Register the builtin datasets once, so they list alongside uploads."""
    for key, description in BUILTINS.items():
        exists = db.query(Dataset).filter_by(kind="builtin", source_key=key).first()
        if exists and exists.description != description:
            # The blurb is part of the code, not of the row: a dataset that
            # gained columns should say so without needing a hand-written
            # UPDATE against the database.
            exists.description = description
            db.commit()
        if not exists:
            db.add(
                Dataset(
                    name=key.capitalize(),
                    description=description,
                    kind="builtin",
                    source_key=key,
                    owner_name="UpSkill",
                )
            )
    db.commit()
    _ensure_default_views(db)


def _ensure_default_views(db: Session) -> None:
    """Seed the standard questions, once.

    Created but never re-written: these are starting points, and an L&D lead
    who tunes one should not find it reset on the next deploy.
    """
    for seed in DEFAULT_VIEWS:
        dataset = db.query(Dataset).filter_by(kind="builtin", source_key=seed["dataset"]).first()
        if not dataset:
            continue
        if db.query(SavedView).filter_by(dataset_id=dataset.id, name=seed["name"]).first():
            continue
        db.add(
            SavedView(
                dataset_id=dataset.id,
                name=seed["name"],
                description=seed["description"],
                owner_name="UpSkill",
                shared=True,
                config=seed["config"],
            )
        )
    db.commit()


# --------------------------------------------------------------------------- #
# datasets                                                                    #
# --------------------------------------------------------------------------- #


@router.get("/datasets")
def list_datasets(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = _viewer(db, learner_id, x_admin_token)
    _ensure_builtins(db)
    scope = reporting_scope(db, viewer, x_admin_token)

    out = []
    for dataset in db.query(Dataset).order_by(Dataset.kind, Dataset.name).all():
        row_count = dataset.row_count
        columns = list(dataset.columns or [])
        if dataset.kind == "builtin":
            # Cheap enough to generate: the numbers must reflect this viewer's
            # perimeter, and a cached row count would report someone else's.
            columns, rows = _builtin_rows(db, dataset.source_key, viewer, x_admin_token)
            row_count = len(rows)
        out.append({
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "kind": dataset.kind,
            "owner": dataset.owner_name,
            "columns": columns,
            "row_count": row_count,
            "source_filename": dataset.source_filename,
            "updated_at": dataset.updated_at,
        })
    return {"datasets": out, "scope": scope.label}


@router.post("/datasets", status_code=201)
async def upload_dataset(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    description: str = Form(default=""),
    learner_id: int | None = Form(default=None),
    replace_id: int | None = Form(default=None),
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Turn a CSV or Excel file into a dataset people can report on.

    `replace_id` re-uploads over an existing dataset, keeping its id — and so
    keeping every saved view built on it working. Without that, refreshing last
    month's extract would quietly orphan every report anyone had saved.
    """
    viewer = _viewer(db, learner_id, x_admin_token)

    blob = await file.read()
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_UPLOAD_BYTES // 1024 // 1024} Mo).",
        )
    if not blob:
        raise HTTPException(status_code=400, detail="Fichier vide.")

    try:
        columns, rows = parse_upload(file.filename or "upload.csv", blob)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        log.exception("dataset parse failed")
        raise HTTPException(
            status_code=400, detail=f"Impossible de lire le fichier : {exc}"
        ) from exc

    if replace_id:
        dataset = db.get(Dataset, replace_id)
        if not dataset or dataset.kind != "upload":
            raise HTTPException(status_code=404, detail="Dataset à remplacer introuvable.")
        db.query(DatasetRow).filter_by(dataset_id=dataset.id).delete()
    else:
        dataset = Dataset(kind="upload")
        db.add(dataset)

    dataset.name = (name.strip() or (file.filename or "Import").rsplit(".", 1)[0])[:160]
    dataset.description = description.strip()[:600]
    dataset.columns = columns
    dataset.row_count = len(rows)
    dataset.source_filename = (file.filename or "")[:255]
    if viewer:
        dataset.owner_id = viewer.id
        dataset.owner_name = viewer.name or viewer.handle
    db.flush()

    db.bulk_save_objects(
        [
            DatasetRow(dataset_id=dataset.id, idx=i, data=row)
            for i, row in enumerate(rows)
        ]
    )
    db.commit()
    db.refresh(dataset)

    return {
        "id": dataset.id,
        "name": dataset.name,
        "columns": dataset.columns,
        "row_count": dataset.row_count,
        "replaced": bool(replace_id),
    }


@router.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(
    dataset_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _viewer(db, learner_id, x_admin_token)
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        return
    if dataset.kind == "builtin":
        raise HTTPException(
            status_code=400,
            detail="Les jeux de données UpSkill ne peuvent pas être supprimés.",
        )
    db.delete(dataset)
    db.commit()


@router.get("/datasets/{dataset_id}/preview")
def preview(
    dataset_id: int,
    limit: int = 25,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The first rows, raw — so someone can check the file landed correctly."""
    viewer = _viewer(db, learner_id, x_admin_token)
    dataset, columns, rows = _load(db, dataset_id, viewer, x_admin_token)
    return {
        "id": dataset.id,
        "name": dataset.name,
        "columns": columns,
        "rows": rows[: max(1, min(limit, ROW_CAP))],
        "row_count": len(rows),
    }


# --------------------------------------------------------------------------- #
# querying                                                                    #
# --------------------------------------------------------------------------- #


class MeasureIn(BaseModel):
    column: str
    agg: str = "sum"
    label: str = ""


class FilterIn(BaseModel):
    column: str
    op: str = "eq"
    value: object = None


class QueryIn(BaseModel):
    learner_id: int | None = None
    dimensions: list[str] = Field(default_factory=list, max_length=4)
    measures: list[MeasureIn] = Field(default_factory=list, max_length=6)
    filters: list[FilterIn] = Field(default_factory=list, max_length=12)
    sort: dict | None = None
    limit: int = ROW_CAP


@router.post("/datasets/{dataset_id}/query")
def run_query(
    dataset_id: int,
    payload: QueryIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Group, measure and filter a dataset. The engine behind every view."""
    viewer = _viewer(db, payload.learner_id, x_admin_token)
    dataset, columns, rows = _load(db, dataset_id, viewer, x_admin_token)

    known = {c["name"] for c in columns}
    unknown = [
        c
        for c in [*payload.dimensions, *(m.column for m in payload.measures)]
        if c not in known
    ]
    if unknown:
        # Naming them beats a generic 400: after a re-upload with renamed
        # headers, this is exactly the message that explains a broken view.
        raise HTTPException(
            status_code=400,
            detail="Colonnes inconnues : " + ", ".join(sorted(set(unknown))),
        )
    for measure in payload.measures:
        if measure.agg not in AGGREGATIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Agrégation inconnue '{measure.agg}'. Attendu : {', '.join(AGGREGATIONS)}.",
            )
    for clause in payload.filters:
        if clause.op not in OPERATORS:
            raise HTTPException(
                status_code=400, detail=f"Opérateur inconnu '{clause.op}'."
            )

    measures = [
        {
            "column": m.column,
            "agg": m.agg,
            "label": m.label or f"{m.agg}({m.column})",
        }
        for m in payload.measures
    ]
    result = aggregate(
        rows,
        payload.dimensions,
        measures,
        [f.model_dump() for f in payload.filters],
        payload.sort,
        payload.limit,
    )
    result["dataset"] = {"id": dataset.id, "name": dataset.name}
    result["measures"] = [m["label"] for m in measures]
    result["dimensions"] = payload.dimensions
    return result


@router.get("/datasets/{dataset_id}/values")
def column_values(
    dataset_id: int,
    column: str,
    learner_id: int | None = None,
    limit: int = ROW_CAP,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Distinct values in one column, for building a filter without typing."""
    viewer = _viewer(db, learner_id, x_admin_token)
    _, columns, rows = _load(db, dataset_id, viewer, x_admin_token)
    if column not in {c["name"] for c in columns}:
        raise HTTPException(status_code=400, detail=f"Colonne inconnue '{column}'.")
    values = sorted(
        {r.get(column) for r in rows if r.get(column) not in (None, "")},
        key=lambda v: (isinstance(v, str), v),
    )
    return {"column": column, "values": values[:limit], "truncated": len(values) > limit}


# --------------------------------------------------------------------------- #
# saved views                                                                 #
# --------------------------------------------------------------------------- #


class ViewIn(BaseModel):
    learner_id: int | None = None
    dataset_id: int
    name: str = Field(min_length=1, max_length=160)
    description: str = ""
    shared: bool = False
    config: dict = Field(default_factory=dict)


@router.get("/views")
def list_views(
    learner_id: int | None = None,
    dataset_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = _viewer(db, learner_id, x_admin_token)
    query = db.query(SavedView)
    if dataset_id:
        query = query.filter(SavedView.dataset_id == dataset_id)
    rows = query.order_by(SavedView.name).all()
    # Somebody else's private view is not listed at all. Listing it and refusing
    # to open it would leak what other people are looking into.
    visible = [
        v for v in rows if v.shared or (viewer and v.owner_id == viewer.id) or not viewer
    ]
    return {
        "views": [
            {
                "id": v.id,
                "dataset_id": v.dataset_id,
                "name": v.name,
                "description": v.description,
                "owner": v.owner_name,
                "shared": v.shared,
                "mine": bool(viewer and v.owner_id == viewer.id),
                "config": v.config,
                "updated_at": v.updated_at,
            }
            for v in visible
        ]
    }


@router.post("/views", status_code=201)
def save_view(
    payload: ViewIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = _viewer(db, payload.learner_id, x_admin_token)
    if not db.get(Dataset, payload.dataset_id):
        raise HTTPException(status_code=404, detail="Dataset introuvable.")

    # Saving under a name that already exists updates it, which is what people
    # mean by "save" the second time. Only the owner may overwrite.
    view = (
        db.query(SavedView)
        .filter_by(dataset_id=payload.dataset_id, name=payload.name.strip())
        .first()
    )
    if view and viewer and view.owner_id not in (None, viewer.id):
        raise HTTPException(
            status_code=409,
            detail=f"« {view.name} » appartient à {view.owner_name}. Choisissez un autre nom.",
        )
    if not view:
        view = SavedView(dataset_id=payload.dataset_id, name=payload.name.strip())
        db.add(view)

    view.description = payload.description.strip()
    view.shared = payload.shared
    view.config = payload.config
    if viewer:
        view.owner_id = viewer.id
        view.owner_name = viewer.name or viewer.handle
    db.commit()
    db.refresh(view)
    return {"id": view.id, "name": view.name, "shared": view.shared}


@router.delete("/views/{view_id}", status_code=204)
def delete_view(
    view_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = _viewer(db, learner_id, x_admin_token)
    view = db.get(SavedView, view_id)
    if not view:
        return
    if viewer and view.owner_id not in (None, viewer.id) and viewer.role != "admin":
        raise HTTPException(
            status_code=403, detail="Seul le propriétaire peut supprimer cette vue."
        )
    db.delete(view)
    db.commit()


@router.post("/views/{view_id}/opened", status_code=204)
def mark_opened(view_id: int, db: Session = Depends(get_db)):
    """Track use, so an unused view can later be told from a load-bearing one."""
    view = db.get(SavedView, view_id)
    if view:
        view.last_opened_at = dt.datetime.now(dt.timezone.utc)
        db.commit()


# --------------------------------------------------------------------------- #
# exporting a built view                                                      #
# --------------------------------------------------------------------------- #


class ExportIn(QueryIn):
    """A query plus how to render it. Same shape as the live query on purpose:
    the export must be the thing on screen, not a second query that drifts."""

    fmt: str = "xlsx"  # xlsx | pdf
    chart: str = "bar"  # bar | column | pie | line | table
    title: str = "Rapport UpSkill"


@router.post("/datasets/{dataset_id}/export")
def export_query(
    dataset_id: int,
    payload: ExportIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Render the current view as a workbook or a PDF, chart included.

    The chart is built from the same aggregated rows the screen is showing, so
    what someone hands round in a meeting is what they were looking at. A CSV
    of the same numbers is still one click away — this is for the version that
    gets attached to an email.
    """
    if payload.fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=400, detail="fmt doit être xlsx ou pdf.")

    result = run_query(dataset_id, payload, x_admin_token, db)
    dimensions = result["dimensions"]
    measures = result["measures"]
    rows = result["rows"]

    headers = [*dimensions, *measures, "Lignes"]
    table_rows = [
        [*[r.get(d) for d in dimensions], *[r.get(m) for m in measures], r.get("_rows")]
        for r in rows
    ]

    charts: list[Chart] = []
    if measures and payload.chart != "table":
        first = measures[0]
        charts.append(
            Chart(
                f"{first} par {' · '.join(dimensions) or 'total'}",
                payload.chart,
                [
                    (" · ".join(str(r.get(d) or "—") for d in dimensions) or "Total",
                     r.get(first) or 0)
                    for r in rows
                ],
                first,
            )
        )

    stamp = dt.date.today().strftime("%Y-%m-%d")
    title = payload.title.strip() or result["dataset"]["name"]

    if payload.fmt == "xlsx":
        blob = build_xlsx([(title[:28] or "Rapport", headers, table_rows)], charts=charts)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        name = f"aida-{stamp}.xlsx"
    else:
        kpis = [
            (m, f"{result['totals'].get(m):,}".replace(",", " "))
            for m in measures
            if result["totals"].get(m) is not None
        ]
        blob = build_pdf(
            title,
            f"{result['dataset']['name']} · {result['totals']['_rows']} lignes",
            kpis,
            [(title, headers, table_rows)],
            charts=charts,
        )
        media = "application/pdf"
        name = f"aida-{stamp}.pdf"

    return Response(
        content=blob,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
