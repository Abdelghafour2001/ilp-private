"""Seed org profiles (BU / Practice / Location / Job Level / Matricule),
training costs and star ratings on the demo population — so the HR panel
(F-02 cost, F-03 ratings, F-07 profile, M-06 filters) is demonstrable.

Run inside the backend container:
    python -m app.seed_org_profiles

Idempotent: overwrites the demo people's org fields and re-applies costs;
ratings are inserted only if absent.
"""

from app.db.session import SessionLocal
from app.models import Course, Formation, Learner, Review

# handle -> (bu, practice, location, job_level, matricule)
PROFILES = {
    "abdelghafour.lahrache": ("Digital & Data", "Data & Analytics", "Casablanca", "Confirmé", "MGM-10241"),
    "salaheddine.elbaidoury": ("Digital & Data", "Business Intelligence", "Casablanca", "Senior", "MGM-10188"),
    "mohannad.tazi": ("Digital & Data", "Data & Analytics", "Casablanca", "Junior", "MGM-10502"),
    "salma.elbarbori": ("Digital & Data", "Data & Analytics", "Casablanca", "Confirmé", "MGM-10333"),
    "omar.elouafi": ("Digital & Data", "Data & Analytics", "Casablanca", "Manager", "MGM-09980"),
    "rachid.berrada": ("Digital & Data", "Data Engineering", "Casablanca", "Lead", "MGM-09912"),
    "youssef.benali": ("Mining Operations", "Data & Analytics", "Marrakech", "Confirmé", "MGM-10611"),
    "imane.zahraoui": ("Mining Operations", "Data Engineering", "Marrakech", "Senior", "MGM-10077"),
    "mehdi": ("Mining Operations", "Business Intelligence", "Marrakech", "Junior", "MGM-10745"),
    "sara.amrani": ("Mining Operations", "Business Intelligence", "Marrakech", "Junior", "MGM-10788"),
    "salma.idrissi": ("Mining Operations", "Data & Analytics", "Marrakech", "Lead", "MGM-09901"),
    "nadia.bouzid": ("Exploration", "AI & GenAI", "Marrakech", "Confirmé", "MGM-10420"),
    "omar.tazi": ("Exploration", "AI & GenAI", "Marrakech", "Junior", "MGM-10699"),
    "yasmine.alaoui": ("Exploration", "AI & GenAI", "Marrakech", "Senior", "MGM-10155"),
    "sofia": ("Exploration", "Data & Analytics", "Rabat", "Junior", "MGM-10812"),
    "karim.mansouri": ("Exploration", "AI & GenAI", "Marrakech", "Lead", "MGM-09933"),
    "hicham.raji": ("Corporate", "Management", "Rabat", "Manager", "MGM-09855"),
    "leila.senhaji": ("Corporate", "Management", "Rabat", "Manager", "MGM-09877"),
    "fatima.benjelloun": ("Corporate", "Learning & Dev", "Rabat", "Senior", "MGM-10011"),
    "khalid.ou": ("Corporate", "HR", "Rabat", "Manager", "MGM-09800"),
}

# training title -> cost (MAD)
COSTS = {
    "Prompt Engineering for GenAI": 12000,
    "Data Quality Fundamentals": 8000,
    "GenAI for Business Teams": 6000,
    "Effective Communication & Feedback": 9500,
    "Project Management Essentials": 15000,
    "UX Fundamentals for Non-Designers": 7000,
}

# formation title -> [(handle, stars)]
RATINGS = {
    "Prompt Engineering for GenAI": [("imane.zahraoui", 5), ("youssef.benali", 5), ("nadia.bouzid", 4), ("abdelghafour.lahrache", 5), ("mehdi", 4)],
    "Data Quality Fundamentals": [("salaheddine.elbaidoury", 5), ("sofia", 4), ("youssef.benali", 4), ("mehdi", 5)],
    "Effective Communication & Feedback": [("sara.amrani", 5), ("mohannad.tazi", 4), ("nadia.bouzid", 5)],
    "Project Management Essentials": [("karim.mansouri", 5), ("salaheddine.elbaidoury", 4), ("imane.zahraoui", 5), ("hicham.raji", 4)],
    "UX Fundamentals for Non-Designers": [("salma.elbarbori", 4), ("yasmine.alaoui", 5)],
}


def seed() -> None:
    db = SessionLocal()
    try:
        n = 0
        for handle, (bu, practice, loc, jl, mat) in PROFILES.items():
            l = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if l:
                l.bu, l.practice, l.location, l.job_level, l.matricule = bu, practice, loc, jl, mat
                n += 1

        for title, cost in COSTS.items():
            f = db.query(Formation).filter(Formation.title == title).first()
            if f:
                f.cost = cost
        for c in db.query(Course).filter(Course.provider.ilike("%coursera%")):
            c.cost = 400

        r = 0
        for title, votes in RATINGS.items():
            f = db.query(Formation).filter(Formation.title == title).first()
            if not f:
                continue
            for handle, stars in votes:
                l = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
                if not l:
                    continue
                exists = db.query(Review).filter_by(
                    entity_type="formation", entity_id=f.id, learner_id=l.id
                ).first()
                if not exists:
                    db.add(Review(entity_type="formation", entity_id=f.id, learner_id=l.id, stars=stars))
                    r += 1

        db.commit()
        print(f"Org profiles seeded: {n} people, {len(COSTS)} training costs, {r} ratings added")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
