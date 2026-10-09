"""Fill the Collaborate modules with work that looks like real work.

The four collaborate surfaces — challenges, sessions, assets, certifications —
were seeded with placeholders ("Churn EDA notebook", "Best internal GenAI use
case"). Placeholders demo the mechanism and nothing else: a reviewer cannot tell
whether the asset library is useful from a row called "Cleaned customer sample".

So this seeds content grounded in the client's own units and in real industry
references: the certifications are the actual current exams with their real
validity periods, the challenge briefs are problems an AI & Data practice
genuinely runs, and the assets are the artefacts such a practice produces.

Two things kept honest on purpose. Exam codes are current as of September 2026 —
DP-203 retired in March 2025 and is *not* seeded, because a catalogue offering a
retired exam is worse than a short catalogue. And the client-required flags
match certifications a mining and industrial client would actually demand,
since that flag drives the renewal alerts.

Run inside the backend container:  python -m app.seed_collaborate [--force]
"""

import datetime as dt
import re
import sys

from app.db.session import SessionLocal
from app.models import (
    Asset,
    Certification,
    CertificationSuggestion,
    Challenge,
    ChallengeSubmission,
    ChallengeVote,
    EarnedCertificate,
    Learner,
    SharingSession,
    Team,
)

TODAY = dt.date.today()
NOW = dt.datetime.now(dt.timezone.utc)


def days(n: int) -> dt.date:
    return TODAY + dt.timedelta(days=n)


# --------------------------------------------------------------------------- #
# certifications — the real catalogue                                         #
# --------------------------------------------------------------------------- #
# name, provider, level, validity_months, client_required, client_name, url, tags, description
CERTIFICATIONS = [
    (
        "Microsoft Certified: Fabric Data Engineer Associate (DP-700)",
        "Microsoft", "intermediate", 12, True, "Managem — Data Platform",
        "https://learn.microsoft.com/credentials/certifications/fabric-data-engineer-associate/",
        ["Fabric", "Data Engineering", "Azure", "Lakehouse"],
        "Ingestion, transformation et supervision de solutions analytiques sur Microsoft Fabric. "
        "Remplace DP-203, retiré en mars 2025.",
    ),
    (
        "Microsoft Certified: Fabric Analytics Engineer Associate (DP-600)",
        "Microsoft", "intermediate", 12, False, "",
        "https://learn.microsoft.com/credentials/certifications/fabric-analytics-engineer-associate/",
        ["Fabric", "Power BI", "Modélisation", "DAX"],
        "Conception de modèles sémantiques et de rapports d'entreprise sur Fabric et Power BI.",
    ),
    (
        "Microsoft Certified: Azure Data Fundamentals (DP-900)",
        "Microsoft", "beginner", 0, False, "",
        "https://learn.microsoft.com/credentials/certifications/azure-data-fundamentals/",
        ["Azure", "Fondamentaux", "Data"],
        "Concepts de données relationnelles et non relationnelles, et services de données Azure. "
        "Sans expiration — le socle recommandé avant toute certification de rôle.",
    ),
    (
        "Microsoft Certified: Azure AI Fundamentals (AI-900)",
        "Microsoft", "beginner", 0, False, "",
        "https://learn.microsoft.com/credentials/certifications/azure-ai-fundamentals/",
        ["Azure", "IA", "Fondamentaux"],
        "Notions de machine learning et d'IA appliquées aux services Azure AI.",
    ),
    (
        "Databricks Certified Data Engineer Associate",
        "Databricks", "intermediate", 24, True, "Managem — Data Platform",
        "https://www.databricks.com/learn/certification/data-engineer-associate",
        ["Databricks", "Spark", "Delta Lake", "ETL"],
        "Delta Lake, Structured Streaming et industrialisation des pipelines sur la plateforme "
        "Databricks. Validité 2 ans.",
    ),
    (
        "Databricks Certified Machine Learning Associate",
        "Databricks", "intermediate", 24, False, "",
        "https://www.databricks.com/learn/certification/machine-learning-associate",
        ["Databricks", "MLflow", "Machine Learning"],
        "Cycle de vie d'un modèle avec MLflow, feature engineering et déploiement.",
    ),
    (
        "AWS Certified Data Engineer — Associate (DEA-C01)",
        "AWS", "intermediate", 36, False, "",
        "https://aws.amazon.com/certification/certified-data-engineer-associate/",
        ["AWS", "Glue", "Redshift", "Data Engineering"],
        "Conception et exploitation de pipelines sur AWS : Glue, Kinesis, Redshift, Lake Formation. "
        "Validité 3 ans.",
    ),
    (
        "AWS Certified Machine Learning Engineer — Associate (MLA-C01)",
        "AWS", "intermediate", 36, False, "",
        "https://aws.amazon.com/certification/certified-machine-learning-engineer-associate/",
        ["AWS", "SageMaker", "MLOps"],
        "Industrialisation de modèles sur SageMaker : entraînement, déploiement, supervision.",
    ),
    (
        "Google Cloud Professional Data Engineer",
        "Google Cloud", "advanced", 24, False, "",
        "https://cloud.google.com/learn/certification/data-engineer",
        ["GCP", "BigQuery", "Dataflow", "Architecture"],
        "Conception de systèmes de données sur GCP : BigQuery, Dataflow, Pub/Sub, gouvernance.",
    ),
    (
        "dbt Analytics Engineering Certification",
        "dbt Labs", "intermediate", 24, False, "",
        "https://www.getdbt.com/certifications/analytics-engineer-certification-exam",
        ["dbt", "Analytics Engineering", "SQL", "Tests"],
        "Modélisation dbt, tests, documentation et bonnes pratiques de déploiement.",
    ),
    (
        "SnowPro Core Certification",
        "Snowflake", "intermediate", 24, False, "",
        "https://www.snowflake.com/certifications/",
        ["Snowflake", "Data Warehouse", "SQL"],
        "Architecture Snowflake, gestion des warehouses, sécurité et optimisation des coûts.",
    ),
    (
        "ISO/IEC 27001 Lead Implementer",
        "PECB", "advanced", 36, True, "Managem — Conformité",
        "https://pecb.com/en/education-and-certification-for-individuals/iso-iec-27001",
        ["Sécurité", "Conformité", "ISO 27001"],
        "Mise en œuvre d'un système de management de la sécurité de l'information. "
        "Exigée sur les projets traitant des données de production.",
    ),
]

# certification name fragment -> (team name, note, suggested by handle)
SUGGESTIONS = [
    ("Fabric Data Engineer", "AI Factory",
     "Notre socle Fabric arrive au T1 — deux personnes certifiées avant la bascule.",
     "omar.elouafi"),
    ("dbt Analytics", "Data Practice",
     "On écrit du dbt tous les jours sans convention partagée. Cette certification cadre le sujet.",
     "leila.senhaji"),
    ("ISO/IEC 27001", "IT Operations & Portfolio",
     "Demandée par le client sur le lot production. À couvrir avant la revue de conformité.",
     "hicham.raji"),
]

# handle, certification fragment (or free title), issuer, obtained (days ago), expires (days ahead)
EARNED = [
    ("youssef.benali", "Databricks Certified Data Engineer Associate", "Databricks", -190, 540),
    ("imane.zahraoui", "Microsoft Certified: Azure Data Fundamentals (DP-900)", "Microsoft", -420, None),
    ("nadia.bouzid", "Microsoft Certified: Azure AI Fundamentals (AI-900)", "Microsoft", -95, None),
    ("karim.mansouri", "AWS Certified Machine Learning Engineer — Associate (MLA-C01)", "AWS", -60, 1035),
    ("abdelghafour.lahrache", "dbt Analytics Engineering Certification", "dbt Labs", -260, 470),
    ("sara.amrani", "Microsoft Certified: Fabric Analytics Engineer Associate (DP-600)", "Microsoft", -310, 45),
    ("omar.tazi", "Google Cloud Professional Data Engineer", "Google Cloud", -700, -20),
]


# --------------------------------------------------------------------------- #
# challenges — briefs a practice actually runs                                #
# --------------------------------------------------------------------------- #
CHALLENGES = [
    {
        "title": "Réduire de 30 % le coût de nos pipelines de données",
        "theme": "FinOps",
        "summary": "Notre facture cloud data a augmenté de 42 % en un an sans hausse "
                   "équivalente du volume traité. Où part l'argent, et que coupe-t-on ?",
        "prize": "Présentation au comité de direction + budget formation de l'équipe gagnante",
        "deadline": days(24),
        "tags": ["FinOps", "Coûts", "Pipelines", "Optimisation"],
        "author": "mostapha.aibi",
        "brief_md": """## Le contexte

La facture data (stockage + compute) est passée de 38 k MAD à 54 k MAD par mois en
douze mois, pour un volume traité en hausse de seulement 11 %. Personne ne sait
précisément d'où vient l'écart.

## Ce qu'on attend

Une analyse chiffrée et **au moins une action mise en œuvre**, pas une note
d'intention. Les propositions sont jugées sur :

- l'économie mensuelle démontrée (mesurée, pas estimée) ;
- l'absence de régression sur les SLA de fraîcheur des données ;
- la reproductibilité : ce qui marche chez nous doit marcher ailleurs.

## Données à disposition

- Export de facturation détaillé sur 14 mois
- Logs d'exécution des jobs (durée, ressources, échecs)
- Catalogue des tables avec dates de dernier accès

## Hors périmètre

Renégocier le contrat fournisseur. Le sujet est technique.""",
        "submissions": [
            {
                "title": "Supprimer les 61 tables jamais lues en 9 mois",
                "author": "imane.zahraoui",
                "summary": "Un audit des accès montre que 61 tables (2,4 To) n'ont pas été "
                           "lues depuis 9 mois. Archivage en stockage froid puis suppression.",
                "votes": ["youssef.benali", "omar.elouafi", "nadia.bouzid", "sara.amrani", "mostapha.aibi"],
                "body_md": """### Méthode

Croisement du catalogue avec les logs d'accès sur 9 mois. Trois catégories :

| Catégorie | Tables | Volume | Action |
|---|---|---|---|
| Jamais lues | 61 | 2,4 To | Archivage puis suppression à J+90 |
| Lues < 1×/mois | 34 | 1,1 To | Passage en stockage froid |
| Actives | 218 | 5,8 To | Aucune |

### Économie mesurée

**-8 900 MAD/mois** sur le stockage, constatée sur la facture du mois suivant.

### Le piège évité

Deux tables « jamais lues » alimentaient un rapport réglementaire trimestriel —
elles n'étaient donc lues que 4 fois par an et sortaient de la fenêtre d'analyse.
La règle finale exclut toute table référencée dans un rapport, quel que soit son
historique d'accès. C'est le genre de suppression qui ne se remarque qu'au moment
du contrôle.""",
            },
            {
                "title": "Passer les 12 jobs les plus lourds en incrémental",
                "author": "youssef.benali",
                "summary": "12 jobs relisent l'intégralité de l'historique à chaque exécution. "
                           "Bascule en traitement incrémental sur clé de partition.",
                "votes": ["imane.zahraoui", "omar.elouafi", "mehdi", "mostapha.aibi"],
                "body_md": """### Constat

Les 12 jobs concernés représentent **68 % du temps de compute total** et relisent
chacun entre 3 et 7 ans d'historique à chaque exécution quotidienne.

### Mise en œuvre

Bascule en `incremental` avec `unique_key` sur la clé métier et filtre sur la
partition de date. Trois jobs ont nécessité une reprise d'historique préalable
car les données sources arrivaient en retard de 48 h.

### Résultat

- Temps d'exécution total : **4 h 20 → 52 min**
- Compute : **-31 %** sur le mois complet
- Un effet non anticipé : la fenêtre de traitement passe sous l'heure, ce qui
  permet un second rafraîchissement en milieu de journée que le métier demandait
  depuis un an.""",
            },
            {
                "title": "Arrêter les clusters de développement la nuit et le week-end",
                "author": "mehdi",
                "summary": "Les environnements de dev tournent 168 h/semaine pour un usage "
                           "réel de 45 h. Extinction automatique hors plage de travail.",
                "votes": ["sara.amrani", "youssef.benali"],
                "body_md": """### Chiffres

Analyse des logs de connexion sur 8 semaines : usage réel des environnements de
développement entre 8 h et 19 h en semaine, soit **45 h sur 168**.

### Proposition

Extinction automatique à 20 h et le week-end, redémarrage à la demande en moins
de 90 secondes. Exception paramétrable pour les traitements longs planifiés.

### Économie estimée

**-6 200 MAD/mois**. Estimée et non mesurée : la mise en œuvre attend l'accord
de l'équipe Infrastructure, ce qui est la raison pour laquelle cette proposition
arrive derrière les deux autres.""",
            },
        ],
    },
    {
        "title": "Détecter les dérives d'usure sur les convoyeurs avant la panne",
        "theme": "Maintenance prédictive",
        "summary": "Trois arrêts non planifiés en six mois sur la ligne de convoyage. "
                   "Les capteurs existent déjà — la donnée n'est pas exploitée.",
        "prize": "Industrialisation du modèle retenu avec l'équipe Exploitation",
        "deadline": days(38),
        "tags": ["Time series", "Maintenance", "Industrie", "Anomalies"],
        "author": "leila.senhaji",
        "brief_md": """## Le problème

Trois arrêts non planifiés en six mois, d'une durée moyenne de 11 heures. Le coût
d'un arrêt est estimé par l'Exploitation entre 180 k et 240 k MAD.

Les convoyeurs sont équipés depuis 2024 de capteurs de vibration, de température
de palier et d'ampérage moteur, échantillonnés à 1 Hz. Ces données arrivent dans
le lac mais ne sont lues par personne.

## Ce qu'on attend

Un signal exploitable **avant** la panne, avec une fenêtre d'alerte utile — une
alerte 20 minutes avant l'arrêt ne sert à rien à la maintenance.

Critères de jugement, dans cet ordre :

1. Préavis médian ≥ 48 h sur les trois pannes historiques
2. Taux de fausses alertes acceptable par l'Exploitation (< 1 par semaine)
3. Explicabilité : un technicien doit comprendre *pourquoi* l'alerte s'est déclenchée

## Attention

Trois pannes, c'est trois exemples positifs. Toute approche supervisée classique
va sur-apprendre. C'est le cœur de la difficulté, pas un détail.""",
        "submissions": [
            {
                "title": "Détection non supervisée sur résidus spectraux",
                "author": "nadia.bouzid",
                "summary": "Modèle de la signature vibratoire normale par bande de fréquence, "
                           "alerte sur dérive persistante du résidu. Préavis médian 3,4 jours.",
                "votes": ["leila.senhaji", "karim.mansouri", "omar.tazi", "yasmine.alaoui", "mostapha.aibi", "imane.zahraoui"],
                "body_md": """### Approche

Le problème n'a que trois exemples positifs : toute classification supervisée
sur-apprend. L'approche retenue est donc **non supervisée** — on modélise le
fonctionnement normal et on alerte sur l'écart.

1. FFT glissante sur fenêtre de 10 minutes, agrégation en 8 bandes de fréquence
2. Baseline par bande apprise sur les périodes sans incident (14 mois)
3. Score d'anomalie = écart normalisé au profil de référence, lissé sur 6 heures
4. Alerte quand le score dépasse le seuil **et s'y maintient 4 heures**

La condition de persistance est ce qui a fait chuter les fausses alertes de 9 à
0,7 par semaine : les pics isolés correspondent presque toujours à des
redémarrages ou à des changements de charge, pas à de l'usure.

### Résultats sur les trois pannes historiques

| Panne | Préavis | Bande déclenchante |
|---|---|---|
| Mars 2026 | 4,1 j | 120–180 Hz |
| Juillet 2026 | 3,4 j | 120–180 Hz |
| Août 2026 | 2,2 j | 300–400 Hz |

Fausses alertes : **0,7 / semaine** sur la période de validation.

### Limite honnête

Trois pannes restent trois pannes. Le préavis médian est encourageant mais
l'intervalle de confiance est large, et la bande 300–400 Hz de la panne d'août
suggère un mode de défaillance différent des deux premiers. À valider en
observation sur six mois avant tout déclenchement automatique d'intervention.""",
            },
            {
                "title": "Suivi de la température de palier avec seuil adaptatif",
                "author": "omar.tazi",
                "summary": "Approche simple : seuil de température ajusté à la température "
                           "ambiante et à la charge. Préavis plus court mais immédiatement lisible.",
                "votes": ["yasmine.alaoui", "leila.senhaji", "mehdi"],
                "body_md": """### Idée

Une régression linéaire prédit la température de palier attendue à partir de la
température ambiante et de la charge moteur. L'alerte se déclenche quand l'écart
au prédit dépasse 6 °C pendant 2 heures.

### Pourquoi c'est intéressant malgré un préavis plus faible

Préavis médian de **1,6 jour**, soit moins que l'approche spectrale. Mais :

- un technicien comprend l'alerte en une phrase : « le palier chauffe 7 °C de
  plus que ce que justifient la charge et l'ambiante » ;
- le modèle tient en 30 lignes et ne nécessite aucune infrastructure ;
- il peut tourner **en complément**, pas en remplacement.

### Proposition

Combiner les deux : le spectral pour le préavis long, la température pour la
confirmation. Une alerte confirmée par les deux signaux justifie une
intervention ; une alerte spectrale seule justifie une inspection.""",
            },
        ],
    },
    {
        "title": "Un assistant de recherche sur nos procédures HSE",
        "theme": "GenAI",
        "summary": "1 400 pages de procédures HSE réparties sur quatre référentiels. "
                   "Trouver la bonne consigne prend en moyenne 12 minutes.",
        "prize": "Mise en production sur l'intranet + accompagnement de l'équipe HSE",
        "deadline": days(-6),
        "status": "closed",
        "tags": ["GenAI", "RAG", "HSE", "Recherche documentaire"],
        "author": "abdelghafour.lahrache",
        "brief_md": """## Le besoin

Les consignes HSE vivent dans quatre référentiels distincts : le manuel groupe,
les instructions par site, les fiches de sécurité produit et les comptes rendus
d'analyse d'incident. Un chef d'équipe met en moyenne **12 minutes** à retrouver
la consigne applicable, mesuré sur 30 recherches chronométrées.

## Ce qu'on attend

Une réponse sourcée en moins d'une minute. **Sourcée** est non négociable : une
consigne HSE sans référence au document d'origine n'est pas utilisable, et une
réponse inventée sur ce sujet est un risque, pas une gêne.

## Critères

1. Toute réponse cite le document et la section
2. L'assistant dit « je ne sais pas » plutôt que d'extrapoler
3. Évaluation sur un jeu de 40 questions rédigées par l'équipe HSE""",
        "submissions": [
            {
                "title": "RAG avec citation obligatoire et refus explicite",
                "author": "karim.mansouri",
                "summary": "Découpage par section réglementaire, recherche hybride, et un "
                           "garde-fou qui bloque toute réponse non ancrée dans un extrait.",
                "votes": ["abdelghafour.lahrache", "nadia.bouzid", "leila.senhaji", "salma.elbarbori",
                          "mostapha.aibi", "omar.tazi", "yasmine.alaoui"],
                "body_md": """### Architecture

- **Découpage** par section réglementaire plutôt que par nombre de caractères :
  une consigne coupée en deux est une consigne fausse.
- **Recherche hybride** BM25 + vectorielle. Le lexical seul rate les
  reformulations, le vectoriel seul rate les références de type « article 4.2.1 ».
- **Garde-fou** : si aucun extrait ne dépasse le seuil de pertinence, l'assistant
  répond « je ne trouve pas cette information » et propose le contact HSE. Pas de
  génération sans ancrage.

### Évaluation sur les 40 questions HSE

| Mesure | Résultat |
|---|---|
| Réponse correcte et sourcée | 34 / 40 |
| Refus correct (info absente) | 4 / 4 |
| Réponse incorrecte | **2 / 40** |
| Temps médian | 14 s |

### Les deux erreurs, en détail

Les deux réponses incorrectes portaient sur des consignes **contradictoires entre
le manuel groupe et l'instruction de site** — l'assistant a cité la plus récente
sans signaler le conflit. Ce n'est pas un défaut du modèle : c'est un problème de
référentiel que l'équipe HSE a depuis pris en charge. L'assistant a rendu visible
une contradiction qui existait déjà et que personne n'avait relevée.

C'est, pour être franc, le résultat le plus utile du projet.""",
            },
            {
                "title": "Index de recherche classique enrichi de synonymes métier",
                "author": "yasmine.alaoui",
                "summary": "Sans LLM : moteur de recherche plein texte avec thésaurus métier. "
                           "Moins impressionnant, zéro risque d'hallucination.",
                "votes": ["omar.tazi", "mehdi"],
                "body_md": """### Position

Avant d'ajouter un LLM, vérifier ce qu'un bon moteur de recherche fait déjà. Le
coût d'exploitation est nul et le risque d'hallucination est structurellement
absent.

### Mise en œuvre

Index plein texte, thésaurus de 180 synonymes métier construit avec deux
préventeurs (« EPI » / « équipement de protection », « consignation » /
« LOTO »…), et affichage de l'extrait dans son contexte.

### Résultats

- Bonne consigne dans les 3 premiers résultats : **31 / 40**
- Temps médian jusqu'à la réponse : **48 s** (contre 12 min aujourd'hui)

### Conclusion

Moins bon que le RAG sur la pertinence, largement meilleur que l'existant, et
déployable en une semaine. Je le propose comme **socle** : le thésaurus servira
de toute façon à la recherche hybride de la proposition retenue.""",
            },
        ],
    },
    {
        "title": "Prévoir la consommation électrique des sites à 7 jours",
        "theme": "Prévision",
        "summary": "La facture énergétique est le deuxième poste de coût. "
                   "Aucune prévision au-delà de la veille pour l'instant.",
        "prize": "Intégration au tableau de bord Exploitation",
        "deadline": days(52),
        "tags": ["Time series", "Énergie", "Prévision", "Exploitation"],
        "author": "mostapha.aibi",
        "brief_md": """## Contexte

L'énergie est le deuxième poste de coût après la masse salariale. L'achat se fait
aujourd'hui à J-1 sur la base d'un historique glissant, sans modèle.

## Attendu

Une prévision à 7 jours au pas horaire, avec **intervalle de confiance**. Une
prévision ponctuelle sans incertitude n'est pas exploitable pour un achat.

## Données

- Consommation horaire par site, 4 ans
- Planning de production prévisionnel
- Historique météo (température, humidité) et prévisions à 7 jours

## Baseline à battre

La moyenne des 4 dernières semaines à la même heure : **MAPE 14,2 %**.""",
        "submissions": [],
    },
]


# --------------------------------------------------------------------------- #
# assets — the artefacts a practice produces                                  #
# --------------------------------------------------------------------------- #
ASSETS = [
    {
        "title": "Détection d'anomalies convoyeurs — notebook de référence",
        "kind": "notebook", "author": "nadia.bouzid", "status": "approved",
        "reviewed_by": "Omar El Ouafi",
        "tags": ["Time series", "Anomalies", "Maintenance", "Python"],
        "summary": "Le notebook complet derrière la proposition retenue au challenge "
                   "convoyeurs : FFT glissante, baseline par bande, score d'anomalie.",
        "link": "https://github.com/teal-aida/anomaly-conveyor/blob/main/notebooks/spectral_baseline.ipynb",
        "body_md": """Notebook reproductible, exécutable de bout en bout sur l'échantillon fourni.

**Ce qu'il contient**

1. Chargement et resynchronisation des trois flux capteurs (les horloges dérivent
   de quelques secondes par jour — corrigé explicitement, pas ignoré)
2. FFT glissante et agrégation en 8 bandes
3. Apprentissage de la baseline sur les périodes saines
4. Score d'anomalie, lissage, règle de persistance
5. Rejeu sur les trois pannes historiques avec les figures du rapport

**À savoir avant de le réutiliser**

La baseline doit être réapprise après toute intervention mécanique majeure : un
palier changé modifie la signature normale, et le modèle interprète sinon la
réparation comme une dérive.""",
    },
    {
        "title": "Garde-fou RAG — refus explicite quand aucune source ne correspond",
        "kind": "code", "author": "karim.mansouri", "status": "approved",
        "reviewed_by": "Leila Senhaji",
        "tags": ["GenAI", "RAG", "Python", "Qualité"],
        "summary": "Le bout de code qui empêche un assistant documentaire de répondre "
                   "sans source. Extrait du projet HSE, réutilisable tel quel.",
        "code": '''def answer_or_refuse(question: str, chunks: list[Chunk], threshold: float = 0.62):
    """Answer only from retrieved context, or say so.

    The threshold is not a tuning knob to maximise coverage — it is the line
    below which the model would be improvising. On safety documentation an
    invented answer is a hazard, not a poor user experience, so the refusal
    branch is the important one and it is tested first.
    """
    grounded = [c for c in chunks if c.score >= threshold]
    if not grounded:
        return Refusal(
            message="Je ne trouve pas cette information dans les référentiels HSE.",
            contact="hse@…",
        )

    answer = llm.complete(PROMPT.format(
        question=question,
        context="\\n\\n".join(f"[{c.doc}§{c.section}] {c.text}" for c in grounded),
    ))

    # A citation the retrieved set cannot support is a fabrication with a
    # reference number attached, which is worse than an uncited one.
    cited = extract_citations(answer)
    known = {(c.doc, c.section) for c in grounded}
    if not cited or not cited <= known:
        return Refusal(message="Réponse non vérifiable — reformulez la question.")

    return Answer(text=answer, sources=sorted(cited))''',
        "body_md": """Trois décisions valent la peine d'être expliquées.

**Le seuil n'est pas un curseur de couverture.** Le baisser augmente le taux de
réponse et le taux d'erreur en même temps. Sur de la documentation sécurité, la
seconde courbe compte plus que la première.

**Les citations sont vérifiées contre le contexte réellement récupéré.** Un
modèle qui cite « manuel §4.2 » alors que ce passage n'a pas été récupéré vient
d'inventer une réponse *avec un numéro de référence dessus* — plus crédible et
donc plus dangereux qu'une réponse sans source.

**Le refus est testé en premier.** Le jeu d'évaluation contient quatre questions
dont la réponse n'existe nulle part dans le corpus ; elles sont exécutées avant
les autres dans la CI.""",
    },
    {
        "title": "Template dbt — conventions de nommage et tests par couche",
        "kind": "code", "author": "abdelghafour.lahrache", "status": "approved",
        "reviewed_by": "Omar El Ouafi",
        "tags": ["dbt", "SQL", "Conventions", "Qualité"],
        "summary": "Le squelette de projet dbt que l'on applique depuis mars : "
                   "staging / intermediate / marts, avec les tests attendus à chaque couche.",
        "link": "https://github.com/teal-aida/dbt-starter",
        "body_md": """**Les trois couches**

| Couche | Rôle | Tests obligatoires |
|---|---|---|
| `staging` | Renommage, typage, rien d'autre | `unique`, `not_null` sur la clé |
| `intermediate` | Jointures et logique métier | `relationships` sur chaque clé étrangère |
| `marts` | Ce que le métier consomme | `accepted_values`, tests de fraîcheur |

**La règle qui a le plus servi**

Aucune logique métier en `staging`. La tentation est permanente — un `CASE WHEN`
« vite fait » au moment du renommage — et c'est ce qui rend les modèles
impossibles à rejouer six mois plus tard, parce que la règle métier est enterrée
dans une couche censée être mécanique.""",
    },
    {
        "title": "Jeu d'évaluation HSE — 40 questions et réponses attendues",
        "kind": "dataset", "author": "karim.mansouri", "status": "approved",
        "reviewed_by": "Aicha Abouaid",
        "tags": ["GenAI", "Évaluation", "HSE", "Jeu de test"],
        "summary": "Les 40 questions rédigées par l'équipe HSE, avec la réponse attendue "
                   "et sa source. Dont 4 sans réponse, volontairement.",
        "body_md": """Ce jeu est ce qui a permis de comparer les propositions du challenge HSE
autrement qu'à l'impression.

**Composition**

- 30 questions à réponse unique et sourcée
- 6 questions à réponse multi-documents
- **4 questions dont la réponse n'existe pas dans le corpus**

Les quatre dernières sont les plus importantes : elles mesurent si l'assistant
sait se taire. Un système qui répond à tout obtient un excellent score sur les
36 premières et devrait être disqualifié par les 4 dernières.

**Réutilisation**

Le format est générique — question, réponse attendue, document source, section.
Tout assistant documentaire interne peut être évalué de la même façon.""",
    },
    {
        "title": "Modèle de prévision énergétique — baseline saisonnière",
        "kind": "model", "author": "omar.tazi", "status": "pending",
        "tags": ["Time series", "Énergie", "Prévision", "Baseline"],
        "summary": "La baseline à battre pour le challenge énergie : saisonnalité "
                   "hebdomadaire et journalière, MAPE 14,2 % à 7 jours.",
        "body_md": """Publié comme **baseline**, pas comme solution. Toute proposition au challenge
énergie doit faire mieux que ce modèle pour mériter d'être industrialisée.

**Ce que fait le modèle**

Moyenne des 4 dernières semaines à la même heure et au même jour de semaine,
corrigée d'un facteur de température. C'est délibérément simple.

**Performance**

MAPE **14,2 %** à 7 jours, **9,8 %** à 24 h.

**Où il échoue**

Les jours fériés et les arrêts planifiés, qu'il ne connaît pas. Sur ces journées
le MAPE dépasse 40 %, ce qui suggère que le planning de production est la
première variable à ajouter — avant toute complexification du modèle lui-même.""",
    },
    {
        "title": "Audit d'accès aux tables — requête et tableau de bord",
        "kind": "code", "author": "imane.zahraoui", "status": "approved",
        "reviewed_by": "Omar El Ouafi",
        "tags": ["FinOps", "Gouvernance", "SQL", "Catalogue"],
        "summary": "La requête derrière l'économie de 8 900 MAD/mois : croiser le "
                   "catalogue avec les logs d'accès pour trouver ce que personne ne lit.",
        "code": '''-- Tables not read in the observation window, with the exclusions that matter.
--
-- The `NOT EXISTS` on report_dependencies is the whole point: a table feeding a
-- quarterly regulatory report is read four times a year and looks abandoned in
-- any window shorter than a quarter. Dropping one of those is only discovered
-- at audit time.
WITH last_access AS (
    SELECT table_schema, table_name, MAX(query_time) AS last_read
    FROM query_history
    WHERE query_time >= CURRENT_DATE - INTERVAL '9 months'
    GROUP BY 1, 2
)
SELECT c.table_schema,
       c.table_name,
       ROUND(c.size_bytes / 1024.0 / 1024 / 1024, 1) AS size_gb,
       a.last_read
FROM catalog_tables c
LEFT JOIN last_access a
       ON a.table_schema = c.table_schema
      AND a.table_name   = c.table_name
WHERE a.last_read IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM report_dependencies r
      WHERE r.table_schema = c.table_schema
        AND r.table_name   = c.table_name
  )
ORDER BY c.size_bytes DESC;''',
        "body_md": """À exécuter avant toute campagne de nettoyage.

La clause `NOT EXISTS` est la partie qui compte. Sans elle, la requête a proposé
la suppression de deux tables alimentant un rapport réglementaire trimestriel —
lues quatre fois par an, donc invisibles dans n'importe quelle fenêtre inférieure
au trimestre. Le genre d'erreur qui ne se voit qu'au contrôle.""",
    },
    {
        "title": "Bibliothèque de prompts — extraction depuis documents techniques",
        "kind": "code", "author": "salma.elbarbori", "status": "pending",
        "tags": ["GenAI", "Prompts", "Extraction", "Documentation"],
        "summary": "Six prompts éprouvés pour extraire des données structurées de "
                   "fiches techniques et de rapports d'intervention, avec leurs limites.",
        "body_md": """Chaque prompt est accompagné de **ce sur quoi il échoue**, ce qui est la
partie que les bibliothèques de prompts omettent en général.

**Exemple — extraction de fiche technique**

Taux d'extraction correcte : 91 % sur 120 fiches.

Échecs constatés :
- tableaux sur deux colonnes lus dans le mauvais ordre (7 cas)
- unités implicites, « 3,5 » sans préciser bar ou kPa (4 cas)

Le second échec n'est pas corrigeable par le prompt : l'information n'est pas
dans le document. Il faut la demander à l'auteur de la fiche, ce qui est une
conclusion plus utile qu'un prompt de plus.""",
    },
    {
        "title": "Convention de nommage des tableaux de bord Power BI",
        "kind": "idea", "author": "sara.amrani", "status": "approved",
        "reviewed_by": "Hicham Raji",
        "tags": ["Power BI", "Conventions", "Gouvernance"],
        "summary": "Proposition de nommage et de cycle de vie pour arrêter les 40 rapports "
                   "« Copie de Copie de Ventes final v3 ».",
        "body_md": """**Le constat**

47 rapports publiés sur l'espace de travail, dont 19 n'ont pas été ouverts depuis
90 jours et 6 portent un nom contenant « final », « v2 » ou « copie ».

**La proposition**

`[BU] – [Sujet] – [Fréquence]`, par exemple `AI&Data – Consommation énergie –
Hebdo`. Plus un propriétaire nommé et une date de revue à 6 mois.

**Ce qui rend la règle applicable**

Un rapport sans propriétaire ou sans ouverture depuis 6 mois passe en archive
automatiquement, avec un préavis de 30 jours à son créateur. Sans mécanisme
d'expiration, une convention de nommage ne survit pas à son troisième mois.""",
    },
]


# --------------------------------------------------------------------------- #
# sharing sessions — the internal talks                                       #
# --------------------------------------------------------------------------- #
SESSIONS = [
    {
        "title": "RAG en production : ce que les démos ne montrent pas",
        "presenter": "Karim Mansouri", "author": "karim.mansouri",
        "date": days(-12),
        "tags": ["GenAI", "RAG", "Retour d'expérience"],
        "abstract": "Six mois sur l'assistant HSE : le découpage qui casse les consignes, "
                    "le seuil qu'il ne faut pas optimiser, et la contradiction de "
                    "référentiel que le projet a révélée sans la chercher.",
        "body_md": """### Plan

1. Pourquoi le découpage par nombre de caractères produit des consignes fausses
2. Recherche hybride : ce que le lexical rattrape que le vectoriel rate
3. Le seuil de pertinence n'est pas un curseur de couverture
4. Évaluer : 40 questions, dont 4 sans réponse
5. Ce que nous n'avions pas prévu — l'assistant a rendu visible une
   contradiction entre le manuel groupe et une instruction de site

### Le point à retenir

La partie difficile n'était ni le modèle ni l'infrastructure. C'était d'admettre
qu'un assistant doit pouvoir répondre « je ne sais pas », et de le mesurer.""",
    },
    {
        "title": "Trois pannes, zéro modèle supervisé",
        "presenter": "Nadia Bouzid", "author": "nadia.bouzid",
        "date": days(-5),
        "tags": ["Time series", "Anomalies", "Maintenance", "Méthode"],
        "abstract": "Comment aborder une détection de panne quand on n'a que trois "
                    "exemples positifs — et pourquoi la règle de persistance a compté "
                    "davantage que le choix du modèle.",
        "body_md": """### Le piège

Trois pannes en historique. Toute approche supervisée sur-apprend, et le score de
validation croisée ment de façon convaincante.

### L'approche

Modéliser le normal, alerter sur l'écart. Non supervisé par nécessité, pas par
préférence.

### Ce qui a réellement fait la différence

Le passage de 9 à 0,7 fausse alerte par semaine ne vient pas du modèle mais d'une
règle : **le score doit rester au-dessus du seuil pendant 4 heures**. Les pics
isolés étaient des redémarrages, pas de l'usure.

Une heure de discussion avec un technicien de maintenance a apporté plus que
trois jours de réglage d'hyperparamètres.""",
    },
    {
        "title": "dbt : nos conventions, et pourquoi elles tiennent",
        "presenter": "Abdelghafour Lahrache", "author": "abdelghafour.lahrache",
        "date": days(-26),
        "tags": ["dbt", "SQL", "Conventions"],
        "abstract": "Le découpage staging / intermediate / marts, les tests attendus à "
                    "chaque couche, et la seule règle qu'il ne faut jamais assouplir.",
        "body_md": """### La règle non négociable

Aucune logique métier en `staging`. Renommage et typage, rien d'autre.

La tentation est permanente et le coût est différé : un `CASE WHEN` ajouté « vite
fait » au moment du renommage rend le modèle impossible à rejouer six mois plus
tard, parce que la règle métier est enterrée dans une couche censée être
mécanique. On l'a appris en le faisant.""",
    },
    {
        "title": "FinOps data : où part réellement la facture",
        "presenter": "Imane Zahraoui", "author": "imane.zahraoui",
        "date": days(-3),
        "tags": ["FinOps", "Coûts", "Gouvernance"],
        "abstract": "Une facture en hausse de 42 % pour 11 % de volume en plus. "
                    "L'analyse, les deux actions retenues, et la suppression qu'il ne "
                    "fallait surtout pas faire.",
        "body_md": """### Les chiffres

38 k → 54 k MAD/mois en douze mois. Volume traité : +11 %.

### Où c'était parti

- 61 tables jamais lues en 9 mois : 2,4 To
- 12 jobs relisant tout l'historique quotidiennement : 68 % du compute
- Environnements de dev allumés 168 h/semaine pour 45 h d'usage

### L'erreur évitée de justesse

Deux des tables « jamais lues » alimentaient un rapport réglementaire
trimestriel. Lues quatre fois par an, donc absentes de toute fenêtre d'analyse
plus courte qu'un trimestre. La règle finale exclut toute table référencée dans
un rapport, quel que soit son historique d'accès.""",
    },
    {
        "title": "Notre lakehouse, expliqué simplement",
        "presenter": "Omar El Ouafi", "author": "omar.elouafi",
        "date": days(-40),
        "tags": ["Architecture", "Lakehouse", "Fondamentaux"],
        "abstract": "Session d'introduction pour les collègues non-data : ce qu'on stocke, "
                    "pourquoi en trois couches, et ce que cela change pour eux.",
        "body_md": """Session destinée aux équipes métier, sans prérequis technique.

Trois questions traitées :

1. Pourquoi ne pas tout mettre dans une seule base
2. Ce que veut dire « la donnée est fraîche de 2 heures »
3. À qui s'adresser quand un chiffre semble faux — et quelles informations
   fournir pour que la réponse arrive vite""",
    },
    {
        "title": "Évaluer un modèle de langage autrement qu'au ressenti",
        "presenter": "Leila Senhaji", "author": "leila.senhaji",
        "date": days(9),
        "tags": ["GenAI", "Évaluation", "Méthode"],
        "abstract": "Construire un jeu d'évaluation utile, inclure les questions sans "
                    "réponse, et lire un score de 91 % sans se mentir.",
        "body_md": """### Ce que couvre la session

- Constituer un jeu d'évaluation avec les métiers, pas à leur place
- Pourquoi les questions **sans réponse** sont les plus discriminantes
- Lire un taux de réussite : 91 % sur quoi, comparé à quoi
- Automatiser le rejeu à chaque changement de prompt

### Format

Atelier — apportez un cas d'usage, on construit le jeu d'évaluation ensemble.""",
    },
    {
        "title": "Du notebook au pipeline : ce qu'il faut changer",
        "presenter": "Youssef Benali", "author": "youssef.benali",
        "date": days(17),
        "tags": ["Industrialisation", "Python", "Bonnes pratiques"],
        "abstract": "Un notebook qui marche et un pipeline qui tient ne sont pas le même "
                    "objet. Les six différences qui coûtent le plus cher à découvrir tard.",
        "body_md": """### Les six différences

1. L'ordre d'exécution est garanti (un notebook, non)
2. Les chemins et secrets viennent de la configuration
3. L'échec est explicite et alerte quelqu'un
4. Le rejeu d'une journée passée donne le même résultat
5. Les dépendances sont figées
6. Quelqu'un d'autre peut le faire tourner

Le point 4 est celui qu'on découvre le plus tard et qui coûte le plus cher.""",
    },
]


# --------------------------------------------------------------------------- #
def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        people = {p.handle: p for p in db.query(Learner).all()}
        teams = {t.name: t for t in db.query(Team).all()}

        def who(handle: str) -> Learner | None:
            return people.get(handle)

        def display(handle: str) -> str:
            person = people.get(handle)
            return (person.name or handle) if person else handle

        # --- certifications ------------------------------------------------
        certs: dict[str, Certification] = {}
        for (name, provider, level, validity, required, client, url, tags, desc) in CERTIFICATIONS:
            row = db.query(Certification).filter(Certification.name == name).first()
            if not row:
                row = Certification(name=name)
                db.add(row)
            row.provider, row.level, row.validity_months = provider, level, validity
            row.client_required, row.client_name = required, client
            row.url, row.tags, row.description = url, tags, desc
            row.added_by_name = "Aicha Abouaid"
            certs[name] = row
        db.flush()

        def find_cert(fragment: str) -> Certification | None:
            return next((c for n, c in certs.items() if fragment.lower() in n.lower()), None)

        # Retire the placeholder entries the real catalogue supersedes. Matched
        # by their exact old names rather than by fuzzy similarity: "Databricks
        # Data Engineer Associate" and "Databricks Certified Data Engineer
        # Associate" are the same exam under two spellings, and only one of
        # those is what Databricks calls it.
        SUPERSEDED = (
            "dbt Fundamentals",
            "AWS Certified Data Engineer — Associate",
            "Databricks Data Engineer Associate",
            "Microsoft Azure Data Fundamentals (DP-900)",
            "Microsoft Azure AI Fundamentals (AI-900)",
        )
        for stale in SUPERSEDED:
            row = db.query(Certification).filter(Certification.name == stale).first()
            if not row:
                continue
            # Certificates people already earned point at the old row. Move them
            # onto the correct entry instead of orphaning somebody's credential.
            replacement = next(
                (c for n, c in certs.items() if stale.split("(")[0].strip()[:18].lower() in n.lower()),
                None,
            )
            db.query(EarnedCertificate).filter_by(certification_id=row.id).update(
                {"certification_id": replacement.id if replacement else None}
            )
            db.query(CertificationSuggestion).filter_by(certification_id=row.id).delete()
            db.delete(row)

        # --- suggestions ---------------------------------------------------
        suggestions = 0
        for fragment, team_name, note, by_handle in SUGGESTIONS:
            cert, team, author = find_cert(fragment), teams.get(team_name), who(by_handle)
            if not (cert and team):
                continue
            existing = (
                db.query(CertificationSuggestion)
                .filter_by(certification_id=cert.id, team_id=team.id)
                .first()
            )
            if not existing:
                existing = CertificationSuggestion(certification_id=cert.id, team_id=team.id)
                db.add(existing)
            existing.note = note
            existing.suggested_by_id = author.id if author else None
            existing.suggested_by_name = display(by_handle)
            suggestions += 1

        # --- earned certificates -------------------------------------------
        earned = 0
        for handle, title, issuer, obtained_offset, expiry_offset in EARNED:
            person = who(handle)
            if not person:
                continue
            row = (
                db.query(EarnedCertificate)
                .filter_by(learner_id=person.id, title=title)
                .first()
            )
            if not row:
                row = EarnedCertificate(learner_id=person.id, title=title)
                db.add(row)
            cert = find_cert(title[:28])
            row.certification_id = cert.id if cert else None
            row.issuer = issuer
            row.obtained_on = days(obtained_offset)
            row.expires_on = days(expiry_offset) if expiry_offset is not None else None
            row.credential_url = "https://learn.microsoft.com/users/…/credentials"
            earned += 1

        # A person can hold the same exam twice under the old and new spelling
        # once the catalogue is renamed. Keep the linked row, drop the loose one
        # — two entries for one exam make the recognition wall look padded.
        deduped = 0
        by_person: dict[int, set[str]] = {}
        for row in db.query(EarnedCertificate).order_by(
            EarnedCertificate.certification_id.is_(None)
        ).all():
            # Prefer the exam code — "Microsoft Certified: Azure Data
            # Fundamentals (DP-900)" and "Microsoft Azure Data Fundamentals
            # (DP-900)" are one exam, and no prefix-of-the-title comparison
            # spots that. Fall back to the normalised title when there is no
            # code, which is the case for course badges.
            code = re.search(r"\(([A-Z]{2,4}-?[A-Z0-9]{2,6})\)", row.title)
            fingerprint = (
                code.group(1).upper()
                if code
                else "".join(ch for ch in row.title.lower() if ch.isalnum())[:26]
            )
            seen = by_person.setdefault(row.learner_id, set())
            if fingerprint in seen:
                db.delete(row)
                deduped += 1
            else:
                seen.add(fingerprint)

        # --- challenges ----------------------------------------------------
        challenges = submissions = votes = 0
        for spec in CHALLENGES:
            row = db.query(Challenge).filter(Challenge.title == spec["title"]).first()
            if not row:
                row = Challenge(title=spec["title"])
                db.add(row)
            author = who(spec["author"])
            row.summary, row.brief_md = spec["summary"], spec["brief_md"]
            row.theme, row.prize, row.deadline = spec["theme"], spec.get("prize"), spec["deadline"]
            row.status = spec.get("status", "open")
            row.tags = spec["tags"]
            row.author = display(spec["author"])
            row.learner_id = author.id if author else None
            db.flush()
            challenges += 1

            for sub in spec["submissions"]:
                entry = (
                    db.query(ChallengeSubmission)
                    .filter_by(challenge_id=row.id, title=sub["title"])
                    .first()
                )
                if not entry:
                    entry = ChallengeSubmission(challenge_id=row.id, title=sub["title"])
                    db.add(entry)
                writer = who(sub["author"])
                entry.summary, entry.body_md = sub["summary"], sub["body_md"]
                entry.author = display(sub["author"])
                entry.learner_id = writer.id if writer else None
                db.flush()
                submissions += 1

                for voter_handle in sub["votes"]:
                    voter = who(voter_handle)
                    if not voter:
                        continue
                    exists = (
                        db.query(ChallengeVote)
                        .filter_by(submission_id=entry.id, learner_id=voter.id)
                        .first()
                    )
                    if not exists:
                        db.add(ChallengeVote(submission_id=entry.id, learner_id=voter.id))
                        votes += 1

        # Remove the placeholder challenges the real briefs replace.
        for stale in ("Cut our data pipeline costs by 30%", "Best internal GenAI use case"):
            row = db.query(Challenge).filter(Challenge.title == stale).first()
            if row:
                db.delete(row)

        # --- assets --------------------------------------------------------
        assets = 0
        for spec in ASSETS:
            row = db.query(Asset).filter(Asset.title == spec["title"]).first()
            if not row:
                row = Asset(title=spec["title"])
                db.add(row)
            author = who(spec["author"])
            row.kind, row.summary, row.body_md = spec["kind"], spec["summary"], spec["body_md"]
            row.code, row.link, row.tags = spec.get("code"), spec.get("link"), spec["tags"]
            row.author = display(spec["author"])
            row.learner_id = author.id if author else None
            row.status = spec["status"]
            if spec["status"] == "approved":
                row.reviewed_by = spec.get("reviewed_by", "Omar El Ouafi")
                row.review_note = spec.get("review_note", "Réutilisable en l'état. Merci.")
                row.reviewed_at = NOW - dt.timedelta(days=4)
            assets += 1

        # Placeholder assets go, except the two the approval demo depends on:
        # the pending notebook Omar has to decide, and the rejected HR export
        # that carries his refusal note.
        for stale in ("Churn EDA notebook", "Reusable DQ check decorator",
                      "Lead-scoring baseline", "Cleaned customer sample",
                      "Auto-document our dbt models"):
            row = db.query(Asset).filter(Asset.title == stale).first()
            if row:
                db.delete(row)

        # --- sharing sessions ----------------------------------------------
        talks = 0
        for spec in SESSIONS:
            row = db.query(SharingSession).filter(SharingSession.title == spec["title"]).first()
            if not row:
                row = SharingSession(title=spec["title"])
                db.add(row)
            author = who(spec["author"])
            row.abstract, row.body_md = spec["abstract"], spec["body_md"]
            row.presenter, row.session_date, row.tags = spec["presenter"], spec["date"], spec["tags"]
            row.author = display(spec["author"])
            row.learner_id = author.id if author else None
            talks += 1

        for stale in ("Intro to our Lakehouse", "RAG in production: lessons learned",
                      "dbt best practices"):
            row = db.query(SharingSession).filter(SharingSession.title == stale).first()
            if row:
                db.delete(row)

        db.commit()
        print("Collaborate content seeded:")
        print(f"  certifications: {len(certs)}  ·  suggestions: {suggestions}  ·  earned: {earned}  ·  doublons retirés: {deduped}")
        print(f"  challenges: {challenges}  ·  submissions: {submissions}  ·  votes: {votes}")
        print(f"  assets: {assets}  ·  sessions: {talks}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
