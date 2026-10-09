"""The tester's guide, as a branded PDF.

Written for people who have never seen the platform and are about to be asked
whether it works. It therefore describes what each role does, in the order they
would do it, with the exact screen names — not a feature list.

It reads from `branding` and from the same type scale as the report PDF, so the
document a tester holds looks like the ones the platform produces.

The assignment chapter is the long one on purpose: it is the process with two
ends, and most of what testers get wrong is assuming the learner's view mirrors
L&D's. It does not — one side sees a deadline and a link out, the other sees a
board of everybody.
"""

from __future__ import annotations

import datetime as dt
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.branding import INK, LOGO_ASPECT, MUTED, TEAL, TEAL_DARK, logo_path
from app.core.config import settings

PAPER_EDGE = "#E2E8F0"
SOFT = "#F1F5F9"


def _styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName="Helvetica", textColor=colors.HexColor(INK), fontSize=9.5, leading=14)
    return {
        "title": ParagraphStyle("t", **{**base, "fontName": "Helvetica-Bold", "fontSize": 26, "leading": 30}),
        "sub": ParagraphStyle("s", **{**base, "fontSize": 12, "leading": 17, "textColor": colors.HexColor(MUTED)}),
        "h1": ParagraphStyle("h1", **{**base, "fontName": "Helvetica-Bold", "fontSize": 17, "leading": 21,
                                      "textColor": colors.HexColor(TEAL_DARK), "spaceBefore": 16, "spaceAfter": 7}),
        "h2": ParagraphStyle("h2", **{**base, "fontName": "Helvetica-Bold", "fontSize": 11.5, "leading": 15,
                                      "spaceBefore": 10, "spaceAfter": 3}),
        "body": ParagraphStyle("b", **{**base, "spaceAfter": 4}),
        "step": ParagraphStyle("st", **{**base, "leftIndent": 12, "spaceAfter": 3}),
        "note": ParagraphStyle("n", **{**base, "fontSize": 9, "leading": 13,
                                       "textColor": colors.HexColor(MUTED)}),
        "cell": ParagraphStyle("c", **{**base, "fontSize": 8.5, "leading": 12}),
        "head": ParagraphStyle("h", **{**base, "fontName": "Helvetica-Bold", "fontSize": 8,
                                       "leading": 11, "textColor": colors.HexColor(TEAL_DARK)}),
    }


def _rule(width: float):
    bar = Table([[""]], colWidths=[width], rowHeights=[2])
    bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(TEAL))]))
    return bar


def _table(rows: list[list[str]], widths: list[float], st: dict) -> Table:
    data = [[Paragraph(c, st["head"] if i == 0 else st["cell"]) for c in row]
            for i, row in enumerate(rows)]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(SOFT)),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor(TEAL)),
        ("LINEBELOW", (0, 1), (-1, -2), 0.3, colors.HexColor(PAPER_EDGE)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def _callout(text: str, st: dict, width: float, tone: str = TEAL) -> Table:
    box = Table([[Paragraph(text, st["cell"])]], colWidths=[width])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SOFT)),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, colors.HexColor(tone)),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return box


def _steps(items: list[tuple[str, str]], st: dict, width: float) -> Table:
    """Numbered steps: the number in its own column, so wrapped text lines up."""
    rows = []
    for i, (what, detail) in enumerate(items, start=1):
        rows.append([
            Paragraph(f'<font color="{TEAL_DARK}"><b>{i}</b></font>', st["cell"]),
            Paragraph(f"<b>{what}</b><br/>{detail}" if detail else f"<b>{what}</b>", st["cell"]),
        ])
    table = Table(rows, colWidths=[12, width - 12])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def _figure(path: str, caption: str, st: dict, width: float, max_h: float = 92 * mm):
    """A screenshot with its caption, kept on one page.

    Captions say what to look at, not what the picture is: a reader can see it
    is a screen, what they cannot see is which number matters.
    """
    from reportlab.lib.utils import ImageReader

    reader = ImageReader(path)
    w, h = reader.getSize()
    draw_w = width
    draw_h = draw_w * h / w
    if draw_h > max_h:
        draw_h = max_h
        draw_w = draw_h * w / h
    shot = RLImage(path, width=draw_w, height=draw_h)
    frame = Table([[shot]], colWidths=[draw_w])
    frame.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(PAPER_EDGE)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return KeepTogether([
        Spacer(1, 6), frame, Spacer(1, 3),
        Paragraph(caption, st["note"]), Spacer(1, 6),
    ])


def build(base_url: str, shots: dict[str, str] | None = None) -> bytes:
    """The guide, as bytes. `base_url` is the environment testers will use."""
    st = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"{settings.app_name} — guide du testeur", author=settings.app_name,
    )
    width = doc.width
    app = settings.app_name
    story: list = []
    shots = shots or {}

    def shot(key: str, caption: str):
        """Place a screenshot when one was captured; skip silently otherwise,
        so the guide still builds on a machine with no browser."""
        if key in shots:
            story.append(_figure(shots[key], caption, st, width))

    def h1(text: str):
        story.append(PageBreak())
        story.append(Paragraph(text, st["h1"]))

    def h2(text: str):
        story.append(Paragraph(text, st["h2"]))

    def p(text: str):
        story.append(Paragraph(text, st["body"]))

    def gap(size: int = 8):
        story.append(Spacer(1, size))

    # ---- cover -----------------------------------------------------------
    mark = logo_path()
    if mark:
        story.append(RLImage(str(mark), width=26 * mm, height=26 * mm / LOGO_ASPECT))
        gap(10)
    story.append(Paragraph(f"{app} — guide du testeur", st["title"]))
    gap(4)
    story.append(Paragraph(
        "Ce que fait chaque rôle, dans l'ordre où il le fait. Écrit pour une "
        "première prise en main : les écrans sont nommés tels qu'ils "
        "apparaissent, et chaque capture vient de l'application elle-même.",
        st["sub"]))
    gap(10)
    story.append(_rule(width))
    gap(12)

    h2("Ce que cette phase cherche à vérifier")
    p("Un seul processus, de bout en bout : <b>l'équipe L&amp;D attribue un "
      "ensemble de cours à des collaborateurs, puis suit leur avancement.</b> "
      "Tout le reste — certifications, sessions, compétences — est là, "
      "utilisable, et vous pouvez le parcourir ; mais c'est la chaîne "
      "affectation → notification → inscription → progression → suivi qui "
      "doit être solide avant d'ouvrir la plateforme à tout le monde.")
    gap(10)

    story.append(_table([
        ["Rôle", "Ce qu'il fait ici", "Écrans qui lui sont propres"],
        ["<b>Apprenant</b>", "Suit ce qu'on lui a confié, déclare ce qu'il a fait ailleurs.",
         "Mon parcours, Cours, Parcours, Mes compétences"],
        ["<b>Manager</b>", "Suit son équipe, reçoit l'alerte quand une échéance approche.",
         "Mon équipe"],
        ["<b>RH</b>", "Lit les chiffres de son périmètre, tient à jour les personnes.",
         "Organisation"],
        ["<b>L&amp;D</b>", "Crée le contenu, affecte, relance, valide.",
         "Suivi, Org &amp; rapports, Onboarding"],
        ["<b>Administrateur</b>", "Décide quels modules existent, ouvre les comptes.",
         "Admin, interrupteurs"],
    ], [26 * mm, 72 * mm, width - 98 * mm], st))
    gap(12)
    story.append(_callout(
        f"<b>Environnement de test :</b> {base_url}<br/>"
        "Connexion au VPN requise. Identifiant : votre adresse e-mail "
        "professionnelle. Mot de passe : transmis séparément, <b>à usage "
        "unique</b> — voir la section 1.", st, width))

    # ---- 1. first sign-in -------------------------------------------------
    h1("1. Première connexion")
    p("La page d'accueil ne demande que deux choses : votre adresse "
      "professionnelle et le mot de passe qu'on vous a communiqué. Il n'y a "
      "pas de « mot de passe oublié » : la réinitialisation passe par "
      "l'équipe formation, volontairement, tant qu'il n'existe pas de lien "
      "à usage unique envoyé par e-mail.")
    shot("login", "La page de connexion. L'identifiant est l'adresse e-mail, "
                  "jamais le nom de compte affiché ailleurs dans l'application.")
    gap(6)

    h2("Le mot de passe qu'on vous a donné ne dure qu'une connexion")
    p("Il a été choisi par quelqu'un d'autre, donc il est traité comme une "
      "clé à usage unique : à la première connexion, l'application s'arrête "
      "sur un écran et ne va pas plus loin tant que vous n'avez pas choisi "
      "le vôtre. À ce moment-là, celui qu'on vous avait transmis cesse de "
      "fonctionner — y compris dans la conversation où il a été envoyé.")
    shot("first_password",
         "L'écran d'accueil d'une première connexion. Ce n'est pas un refus : "
         "saisissez le mot de passe reçu dans le premier champ, le vôtre dans "
         "le second (12 caractères minimum).")
    gap(6)
    story.append(_callout(
        "<b>Si rien ne s'affiche :</b> vérifiez d'abord le VPN. Une page "
        "blanche ou « site inaccessible » vient presque toujours de là, "
        "pas de la plateforme.", st, width, tone="#F2A93B"))

    # ---- 2. L&D assigns ---------------------------------------------------
    h1("2. L&amp;D — affecter un ensemble de cours")
    p("Tout part de <b>Suivi</b>. L'écran répond à une seule question : "
      "qu'a-t-on confié, à qui, et où en est chacun. Les compteurs du haut "
      "sont des filtres : cliquer sur « jamais démarré » ne change pas le "
      "chiffre, il réduit la liste.")
    shot("tracking",
         "<b>Suivi</b>, vu par Aicha (L&amp;D). Sept compteurs, et deux "
         "méritent une lecture attentive : <b>jamais inscrit</b> compte les "
         "gens qui n'ont pas ouvert de compte chez le fournisseur — ce n'est "
         "pas la même chose que « inscrit mais pas commencé » — et "
         "<b>en difficulté</b> compte ceux qui ont échoué deux fois ou plus.")
    gap(6)

    h2("L'assistant, en quatre étapes")
    p("Le bouton <b>Affecter</b> ouvre un assistant plutôt qu'un formulaire : "
      "rien n'est écrit avant la dernière étape, et le panneau de droite "
      "récapitule la campagne en continu.")
    story.append(_steps([
        ("1 — Quoi",
         "Formations, parcours ou cours. Le catalogue de cours étant large, "
         "il faut taper trois lettres pour chercher ; les formations et "
         "parcours, moins nombreux, s'affichent directement."),
        ("2 — Qui",
         "Des personnes nommées, ou une équipe, une unité, un métier entier. "
         "Quelqu'un nommé deux fois n'est affecté qu'une fois."),
        ("3 — Règles",
         "Obligatoire ou recommandé, l'échéance, et la raison qui partira "
         "dans l'e-mail. Un obligatoire sans date ne sera jamais en retard, "
         "donc personne ne le relancera : l'assistant le dit à l'écran."),
        ("4 — Vérification",
         "Qui va le recevoir, qui l'a déjà, combien de personnes seront "
         "prévenues par e-mail. C'est la dernière étape réversible."),
    ], st, width))
    shot("wizard_what",
         "<b>Étape 1 — Quoi.</b> Deux cours cochés ; le panneau de droite les "
         "reprend en pastilles et tient le compte à jour.")
    shot("wizard_who",
         "<b>Étape 2 — Qui.</b> La recherche nominative. En dessous, les "
         "équipes et les unités permettent d'affecter à un groupe entier "
         "sans nommer chacun.")
    shot("wizard_rules",
         "<b>Étape 3 — Règles.</b> « Obligatoire » compte dans la conformité "
         "et déclenche les relances ; « recommandé » reste visible mais n'est "
         "jamais signalé comme un manquement. Notez l'avertissement sous la "
         "date.")
    shot("wizard_review",
         "<b>Étape 4 — Vérification.</b> Ici, un cours sur deux est déjà "
         "détenu par une partie des destinataires : la colonne « l'a déjà » "
         "le dit, et le bouton annonce le nombre réel d'affectations à créer.")
    gap(6)
    story.append(_callout(
        "<b>Réaffecter n'est pas doubler.</b> Quelqu'un qui possède déjà le "
        "contenu le garde : seule son échéance est mise à jour, et il n'est "
        "pas prévenu une seconde fois. C'est ainsi qu'on repousse une date "
        "sans inonder les gens.", st, width))
    shot("wizard_done",
         "La confirmation dit exactement ce qui s'est passé : ce qui a été "
         "créé, qui a été prévenu dans l'application, qui l'a été par "
         "e-mail, et combien d'échéances ont simplement bougé.")

    # ---- 3. the learner ---------------------------------------------------
    h1("3. L'apprenant — trouver, puis faire")
    p("Un apprenant n'a pas à chercher ce qu'on attend de lui. Il le trouve "
      "à trois endroits, et les trois disent la même chose : la cloche, "
      "<b>Mon parcours</b>, et le catalogue lui-même.")
    shot("catalog_mandatory",
         "<b>Cours</b>, vu par un apprenant. Ce qui lui est imposé remonte en "
         "tête, encadré, avec son échéance — et le bouton "
         "<b>Obligatoire pour moi</b> réduit le catalogue à cela seul. Sans "
         "ce tri, retrouver trois obligations parmi des centaines de fiches "
         "revient à ne pas les avoir annoncées.")
    gap(6)
    shot("learner_mylearning",
         "<b>Mon parcours</b>. « Attendu de vous » liste les obligations "
         "ouvertes par ordre d'échéance, avec le nom de qui les a confiées. "
         "Les pourcentages viennent du fournisseur, pas d'une déclaration.")
    gap(6)
    story.append(_steps([
        ("Ouvrir le contenu",
         "Depuis la cloche ou depuis la fiche. Un cours Coursera ouvre "
         "Coursera : la plateforme ne rejoue pas le contenu du fournisseur."),
        ("S'inscrire chez le fournisseur",
         "C'est l'étape qu'on oublie. Tant qu'elle n'est pas faite, le suivi "
         "affiche « jamais inscrit » et la progression reste à zéro."),
        ("Avancer",
         "La progression remonte toute seule, avec le délai de "
         "synchronisation expliqué en section 8."),
        ("Déclarer un cours fait ailleurs",
         "Un cours suivi hors programme peut être déclaré ; il compte, et "
         "reste marqué « déclaré » pour qu'on sache d'où vient le chiffre."),
    ], st, width))

    # ---- 4. the manager ---------------------------------------------------
    h1("4. Le manager")
    p("Les managers ont demandé deux choses : savoir quand on confie du "
      "travail à leurs collaborateurs, et savoir quand une échéance approche "
      "sans que ce soit fini. Les deux sont faciles à construire et faciles "
      "à rater — un message par personne et par contenu, et le cinquième "
      "part déjà dans un dossier que personne n'ouvre.")
    gap(4)
    story.append(_table([
        ["Quand", "Ce qu'il reçoit"],
        ["À l'affectation", "Un résumé par campagne, nommant les personnes et le contenu"],
        ["3 jours avant l'échéance", "Un digest, une ligne par personne en retard potentiel"],
        ["1 jour avant", "Le même digest, s'il reste quelque chose"],
        ["Le jour du retard, puis 1 semaine après", "Deux rappels, et plus rien ensuite"],
    ], [52 * mm, width - 52 * mm], st))
    gap(6)
    p("<b>Un message par manager et par jour au maximum</b>, et seulement "
      "pour de l'obligatoire. Jamais pour du recommandé, jamais pour ce qui "
      "est terminé, jamais pour ce que L&amp;D a validé sur preuve externe.")
    shot("manager_bell",
         "La cloche d'Omar quelques secondes après la campagne de la section "
         "2 : « 1 obligation(s) pour votre équipe », avec le nom de la "
         "personne et le contenu.")
    shot("manager_team",
         "<b>Mon équipe</b>. XP, niveau, badges, formations en cours et "
         "dernière activité, par collaborateur — et la possibilité "
         "d'affecter directement à un membre ou à l'équipe entière.")

    # ---- 5. HR ------------------------------------------------------------
    h1("5. RH")
    p("La vue RH est volontairement limitée à un périmètre : une RH voit son "
      "unité, pas toute l'entreprise. Les trois onglets séparent ce qui vient "
      "d'UpSkill, ce qui vient de Coursera, et les deux ensemble — mélanger "
      "les sources est le plus sûr moyen de faire dire n'importe quoi à un "
      "chiffre.")
    shot("hr_org",
         "<b>Organisation</b>, vu par Zahra (RH). Équipes, managers, heures, "
         "jours-homme, taux de complétion et de présence. Les exports Excel "
         "et PDF reprennent exactement ce qui est à l'écran.")
    gap(6)
    story.append(_callout(
        "RH peut <b>consulter</b> l'organisation ; la modifier — ouvrir un "
        "compte, changer un rattachement, donner un mot de passe — reste à "
        "L&amp;D et à l'administrateur. C'est une séparation volontaire, pas "
        "un oubli.", st, width))

    # ---- 6. certifications ------------------------------------------------
    h1("6. Certifications")
    p("Le catalogue liste ce que l'entreprise reconnaît, avec sa durée de "
      "validité réelle. C'est cette durée qui fait exister les rappels : un "
      "catalogue où rien n'expire ne peut rien relancer.")
    shot("certifications",
         "Le catalogue, les suggestions d'un responsable, et le mur des "
         "certificats obtenus. « Client — … » signale une certification "
         "exigée contractuellement : celles-là passent devant dans l'écran "
         "de renouvellement.")
    gap(6)
    story.append(_steps([
        ("Partager un certificat",
         "<b>Partager un certificat</b> : la pièce jointe et la date "
         "d'obtention suffisent. Il apparaît sur votre profil et sur le mur."),
        ("Suggérer à quelqu'un",
         "Un responsable peut recommander une certification à un "
         "collaborateur ; elle remonte en « recommandé pour vous »."),
        ("Les derniers obtenus",
         "Classés par date d'obtention, pas par date de saisie — un import "
         "en masse ne doit pas passer devant ce qui vient d'être décroché."),
    ], st, width))

    # ---- 7. sessions ------------------------------------------------------
    h1("7. Sessions et planning")
    p("Les sessions sont les moments en direct : lancements, ateliers, "
      "questions-réponses. Une session ouverte à tous accepte les "
      "inscriptions de n'importe qui ; une session rattachée à une formation "
      "ne concerne que ses inscrits.")
    shot("schedule",
         "<b>Planning</b>. Pour chaque séance : l'heure, la durée, qui "
         "l'anime, le lieu ou le lien de réunion, et le nombre d'inscrits. "
         "<b>Calendrier</b> télécharge une invitation à ouvrir dans Outlook.")

    # ---- 8. Coursera ------------------------------------------------------
    h1("8. Coursera — ce que la plateforme voit, et ce qu'elle ne voit pas")
    p("C'est la section à lire avant de signaler un problème de progression.")
    gap(4)
    story.append(_table([
        ["Ce qui est vrai", "Ce que cela implique pour un test"],
        ["La synchronisation tourne toutes les 15 minutes",
         "Une progression affichée à 0 % juste après un clic est normale : "
         "attendez le cycle suivant"],
        ["Seuls les comptes Coursera rattachés sont visibles",
         "Un collaborateur non rattaché restera à 0 % indéfiniment — ce n'est "
         "pas « il n'a rien fait », c'est « on ne voit rien »"],
        ["Le flux ne remonte que les inscriptions passant par un programme",
         "Un cours suivi à titre personnel n'apparaît pas ; il peut être "
         "déclaré par l'apprenant"],
        ["Les heures sont celles mesurées par le fournisseur",
         "Elles alimentent les jours-homme : ce ne sont pas des estimations "
         "à partir de la durée annoncée"],
    ], [66 * mm, width - 66 * mm], st))

    # ---- 9. administration ------------------------------------------------
    h1("9. Comptes, droits et modules")
    p("Deux écrans, deux métiers différents — et c'est la confusion la plus "
      "fréquente. Les <b>rôles</b> se changent dans "
      "<b>Admin → Gérer les apprenants</b> ; les <b>mots de passe</b> se "
      "donnent dans <b>Org &amp; rapports</b>, sur la fiche de la personne.")
    shot("org_reports",
         "<b>Org &amp; rapports</b>. Trois onglets : la structure, les "
         "personnes, les rapports. <b>Inviter un collaborateur</b> ouvre un "
         "compte et envoie le message de bienvenue.")
    shot("person_password",
         "La fiche d'une personne. Nom, intitulé, rôle, rattachement — et "
         "<b>Mot de passe de connexion</b>, avec la phrase qui compte : "
         "« aucun e-mail n'est envoyé, transmettez-le vous-même ». Un mot de "
         "passe donné ici devient une clé à usage unique.")
    gap(6)
    story.append(_steps([
        ("Ouvrir un compte",
         "<b>+ Inviter un collaborateur</b>. L'invitation nomme l'adresse de "
         "connexion et prévient que le mot de passe est à usage unique ; "
         "elle ne contient jamais le mot de passe lui-même."),
        ("Renvoyer une invitation",
         "Si le message s'est perdu, L&amp;D peut le renvoyer sans recréer "
         "le compte. Le texte est identique au premier envoi."),
        ("Retirer quelqu'un",
         "<b>Retirer de l'organisation</b> : l'équipe et l'unité sont "
         "vidées, mais ses heures et ses certificats restent dans les "
         "rapports qu'ils ont déjà alimentés."),
    ], st, width))
    gap(6)
    h2("Modules désactivés")
    p("Certains modules sont volontairement fermés pendant cette phase. Ils "
      "ne sont pas cassés : ils ne sont pas ouverts, et l'application le dit "
      "plutôt que d'afficher une page vide.")
    shot("module_off",
         "Ce qu'on voit sur un module fermé. Si vous tombez là-dessus, ce "
         "n'est pas un bug — c'est un choix, et il se discute.")

    # ---- 10. the test script ---------------------------------------------
    h1("10. Scénario de test, pas à pas")
    p("À faire dans cet ordre, idéalement à deux : quelqu'un sur le compte "
      "L&amp;D, quelqu'un sur un compte apprenant. Chaque ligne est "
      "vérifiable — si ce qui est attendu ne se produit pas, c'est un "
      "signalement.")
    gap(4)
    story.append(_table([
        ["#", "Action", "Ce qu'on doit voir"],
        ["1", "Se connecter avec le mot de passe reçu",
         "L'écran « choisissez votre mot de passe », puis l'accueil"],
        ["2", "Se déconnecter, se reconnecter avec l'ancien mot de passe",
         "Refus — l'ancien ne fonctionne plus"],
        ["3", "L&amp;D affecte 2 cours obligatoires à 2 personnes, échéance dans 15 jours",
         "L'étape 4 annonce le nombre exact ; la confirmation détaille créé / mis à jour"],
        ["4", "L'apprenant ouvre la cloche",
         "Le contenu s'ouvre directement, pas la page d'accueil"],
        ["5", "L'apprenant ouvre <b>Cours</b>",
         "Les deux cours sont en tête, encadrés, avec leur échéance"],
        ["6", "L'apprenant clique <b>Obligatoire pour moi</b>",
         "Le catalogue se réduit à ses seules obligations"],
        ["7", "Le manager ouvre sa cloche",
         "« 1 obligation(s) pour votre équipe », avec les noms"],
        ["8", "L&amp;D réaffecte le même cours avec une date plus lointaine",
         "« l'a déjà » ; l'échéance bouge, personne n'est réaverti"],
        ["9", "L'apprenant s'inscrit sur Coursera et avance",
         "Rien ne change immédiatement — c'est normal"],
        ["10", "Attendre un cycle (15 min), rouvrir <b>Suivi</b>",
         "Le pourcentage a bougé, et « jamais inscrit » a diminué de un"],
        ["11", "Le manager ouvre <b>Mon équipe</b>",
         "La personne apparaît avec sa progression"],
        ["12", "RH ouvre <b>Organisation</b>",
         "Son périmètre seulement ; les heures et le taux de complétion ont bougé"],
        ["13", "L'apprenant déclare un cours fait hors programme",
         "Il compte, et reste marqué « déclaré »"],
        ["14", "L'apprenant partage un certificat",
         "Il apparaît sur son profil et en tête du mur des derniers obtenus"],
    ], [8 * mm, 74 * mm, width - 82 * mm], st))

    # ---- 11. known limits -------------------------------------------------
    h1("11. Ce qui est connu, et n'a pas besoin d'être signalé")
    gap(4)
    story.append(_table([
        ["Ce que vous verrez", "Pourquoi"],
        ["L'expéditeur des e-mails est une adresse de recrutement",
         "UpSkill emprunte l'inscription applicative de l'ATS en attendant "
         "d'avoir sa propre boîte"],
        ["La page d'accueil peut annoncer « rien en attente » alors que vous "
         "avez des obligations",
         "Cette carte ne compte que les invitations à des formations et les "
         "recommandations ; vos affectations sont dans « Attendu de vous »"],
        ["Certains cours du catalogue n'ont rien à voir avec nos métiers",
         "Le catalogue a été constitué par mots-clés sur le fonds Coursera ; "
         "il sera resserré"],
        ["Le classement n'apparaît pas pour un apprenant",
         "Le module est réservé à l'encadrement pendant cette phase"],
        ["Seule une partie des collaborateurs a une progression Coursera",
         "Seuls les comptes rattachés sont visibles — voir la section 8"],
    ], [72 * mm, width - 72 * mm], st))

    # ---- 12. reporting ----------------------------------------------------
    gap(12)
    h2("Signaler un problème")
    p("Quatre informations suffisent, et les quatre comptent : "
      "<b>l'écran</b> (son adresse complète), <b>le compte</b> utilisé, "
      "<b>ce que vous attendiez</b>, <b>ce que vous avez obtenu</b>. "
      "L'heure approximative aide à retrouver la trace côté serveur.")
    gap(6)
    story.append(_callout(
        "Signalez aussi ce qui vous paraît mineur : un libellé ambigu, un "
        "chiffre qui ne correspond pas à votre idée, une étape où vous avez "
        "hésité. Ce sont les plus utiles — un bug franc finit toujours par "
        "être trouvé, une hésitation non dite reste dans le produit.",
        st, width, tone="#F2A93B"))

    gap(14)
    story.append(Paragraph(
        f"{app} · guide du testeur · {dt.date.today():%d/%m/%Y}", st["note"]))

    doc.build(story)
    return buffer.getvalue()
