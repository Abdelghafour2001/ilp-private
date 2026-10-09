"""The company-wide skill catalogue: every domain, hard and soft.

The platform started inside one practice, and the catalogue showed it — ten
skills, all data and AI, with "Soft skills" as a category sitting beside
"Data" as though a behaviour and a query language were the same kind of thing.
A colleague in HR, finance, cybersecurity or instrumentation opened the skills
page, recognised nothing, and correctly concluded the tool was not for them.

This is the catalogue as data, so it is one file to read and one file to argue
with. Two axes, kept apart deliberately:

* **domain** (`category`) — where the skill lives: Cybersecurity, SAP &
  enterprise applications, Human resources, Leadership & management…
* **kind** — `hard` (a craft, demonstrable, often certifiable) or `soft`
  (behavioural, transversal, the same skill whatever the job). Every competency
  framework an HR team has ever used separates these two, and reports on them
  separately.

A domain is all hard or all soft, which is why the kind sits on the domain
rather than on each line: it keeps the list skimmable, and a domain that needed
both would really be two domains.

Names are the key. Seeding is an upsert on the name, so a skill somebody already
follows keeps its id, its ratings and its content links while its domain and
kind are corrected — nobody's history is thrown away to tidy a label.

This is a **starting point**, not a policy: L&D add, rename and retire skills in
the app. What matters is that day one is a catalogue the whole company can see
itself in, rather than one practice's vocabulary.
"""

from __future__ import annotations

# domain -> (kind, [(name, what it means)])
TAXONOMY: dict[str, tuple[str, list[tuple[str, str]]]] = {
    # ---------------------------------------------------------------- soft
    "Leadership & management": ("soft", [
        ("Delegation", "Handing over work with the authority to do it."),
        ("Giving feedback", "Saying what needs to change, in a way that is heard."),
        ("Coaching", "Developing somebody by asking rather than telling."),
        ("Decision making", "Choosing under uncertainty, and owning the choice."),
        ("Change management", "Taking a team through a change they did not ask for."),
        ("Performance management", "Setting objectives and holding an honest review."),
        ("Conflict resolution", "Addressing disagreement before it becomes a departure."),
        ("Strategic thinking", "Connecting today's work to where the business is going."),
    ]),
    "Communication & influence": ("soft", [
        ("Communication", "Being understood, in writing and in person."),
        ("Written communication", "Documents and emails that need no second reading."),
        ("Presenting", "Holding a room, with or without slides."),
        ("Active listening", "Hearing what was meant, not only what was said."),
        ("Facilitation", "Running a meeting or workshop that reaches a decision."),
        ("Negotiation", "Reaching an agreement both sides will honour."),
        ("Stakeholder management", "Keeping the people who matter informed and on board."),
        ("Cross-cultural collaboration", "Working across sites, languages and conventions."),
    ]),
    "Personal effectiveness": ("soft", [
        ("Time management", "Deciding what not to do today."),
        ("Problem solving", "Getting from a symptom to a cause to a fix."),
        ("Critical thinking", "Questioning a claim before acting on it."),
        ("Adaptability", "Staying effective when the plan changes."),
        ("Learning agility", "Picking up an unfamiliar subject quickly."),
        ("Attention to detail", "Catching the error before the client does."),
        ("Stress management", "Keeping judgement under pressure."),
        ("Autonomy", "Moving work forward without being asked twice."),
    ]),
    "Teamwork & client orientation": ("soft", [
        ("Teamwork", "Making the team's result better than your own."),
        ("Mentoring", "Bringing a colleague up to your level on purpose."),
        ("Knowledge sharing", "Writing it down so the next person does not ask."),
        ("Client orientation", "Understanding what the client is actually trying to achieve."),
        ("Commercial awareness", "Knowing what the work costs and what it is worth."),
        ("Service mindset", "Treating an internal colleague like a client."),
    ]),
    # ---------------------------------------------------------------- hard
    "Human resources": ("hard", [
        ("Recruitment & sourcing", "Finding, assessing and closing candidates."),
        ("Onboarding", "The first ninety days, designed rather than improvised."),
        ("Payroll", "Paying people correctly and on time."),
        ("Labour law", "The legal frame around employment and termination."),
        ("Compensation & benefits", "Pay structure, grades and benchmarking."),
        ("HRIS administration", "Running the HR system of record."),
        ("Training & development", "Building, buying and measuring learning."),
        ("HR analytics", "Headcount, turnover and skills, as figures."),
        ("Employee relations", "Representation, discipline and social dialogue."),
        ("Talent & succession planning", "Knowing who could do the critical jobs next."),
    ]),
    "Finance & procurement": ("hard", [
        ("Financial reporting", "Statutory and management accounts."),
        ("Budgeting & forecasting", "Planning the numbers and revising them honestly."),
        ("Cost control", "Watching spend against plan, line by line."),
        ("Accounts payable & receivable", "Invoices in, invoices out, cash collected."),
        ("Procurement & sourcing", "Choosing suppliers and running a tender."),
        ("Contract management", "What was signed, and what it obliges."),
        ("Tax & compliance", "Returns, deadlines and the rules behind them."),
        ("Internal audit", "Testing whether controls do what they claim."),
        ("Financial analysis", "Turning figures into a recommendation."),
    ]),
    "Project & service delivery": ("hard", [
        ("Project Management", "Scope, plan, budget and the people delivering it."),
        ("Agile & Scrum", "Iterative delivery, and the ceremonies that keep it honest."),
        ("Risk management", "Naming what could go wrong while it is still cheap."),
        ("Planning & scheduling", "Dependencies, critical path and realistic dates."),
        ("Resource planning", "Matching people and skills to committed work."),
        ("PMO & reporting", "Portfolio status somebody can act on."),
        ("ITIL service management", "Incidents, changes and service levels."),
        ("Vendor management", "Holding a supplier to what they promised."),
    ]),
    "Quality, health & safety": ("hard", [
        ("QHSE fundamentals", "The standards and why they exist."),
        ("ISO 9001", "Quality management, audited."),
        ("ISO 27001", "Information security management, audited."),
        ("Incident investigation", "Root cause, not blame."),
        ("Continuous improvement (Lean)", "Removing waste from how work is done."),
        ("Compliance & GRC", "Governance, risk and the evidence for both."),
    ]),
    "Sales & bids": ("hard", [
        ("Proposal writing", "A document that answers what was asked."),
        ("Bid management", "Running a tender response to the deadline."),
        ("Pricing", "What to charge, and why it holds."),
        ("Pre-sales solutioning", "Turning a need into a deliverable shape."),
        ("CRM administration", "Keeping the pipeline true."),
        ("Account management", "Growing a client relationship after the sale."),
    ]),
    "SAP & enterprise applications": ("hard", [
        ("SAP S/4HANA Finance (FI/CO)", "The finance core: ledgers, costing, closing."),
        ("SAP S/4HANA Logistics (MM/SD)", "Materials, sales and distribution."),
        ("SAP ABAP", "Developing and extending SAP itself."),
        ("SAP BTP", "Extensions and integration on SAP's platform."),
        ("SAP Basis", "Running the systems SAP modules sit on."),
        ("SAP HCM", "Personnel administration, time and payroll in SAP."),
        ("SuccessFactors", "Cloud HR: recruiting, performance, learning."),
        ("Workday HCM", "Workday as the HR system of record."),
        ("EPM & consolidation", "Group reporting, planning and consolidation."),
        ("Integration (middleware)", "Making systems agree, in both directions."),
    ]),
    "IT infrastructure & cloud": ("hard", [
        ("Linux administration", "Running, hardening and debugging Linux servers."),
        ("Windows Server", "Roles, updates and the estate around them."),
        ("Microsoft Azure", "Designing and running workloads on Azure."),
        ("Amazon Web Services", "Designing and running workloads on AWS."),
        ("Networking", "Routing, switching, firewalls and why it is slow."),
        ("Virtualisation", "Hypervisors, clusters and capacity."),
        ("Backup & disaster recovery", "Restores that have actually been tested."),
        ("Microsoft 365 administration", "Identity, mail and collaboration at scale."),
        ("Active Directory & identity", "Who exists, and what they may reach."),
        ("Managed services operations", "Running somebody else's estate to a contract."),
    ]),
    "Cybersecurity": ("hard", [
        ("Security operations (SOC)", "Detection, triage and escalation."),
        ("Incident response", "Containing and recovering from a breach."),
        ("Identity & access management", "Least privilege, enforced."),
        ("Vulnerability management", "Finding, ranking and closing exposure."),
        ("Network security", "Segmentation, inspection and perimeter control."),
        ("Cloud security", "Securing what nobody racked."),
        ("Penetration testing", "Attacking your own estate, with authorisation."),
        ("Security awareness", "Making the human layer harder to fool."),
        ("Risk & governance (ISO 27005)", "Expressing security as business risk."),
    ]),
    "DevOps & automation": ("hard", [
        ("CI/CD pipelines", "From commit to production, repeatably."),
        ("Docker", "Packaging an application and its dependencies."),
        ("Kubernetes", "Running containers at scale, and debugging them."),
        ("Terraform", "Infrastructure described in code and reviewed."),
        ("Ansible", "Configuration applied the same way every time."),
        ("Git", "Branching, reviewing and recovering."),
        ("Observability & monitoring", "Knowing it broke before the client calls."),
        ("Scripting (Bash/PowerShell)", "Automating the task you have done twice."),
    ]),
    "Software engineering": ("hard", [
        ("Python", "General-purpose programming, from scripts to services."),
        ("Java", "Enterprise back-end development."),
        (".NET & C#", "Microsoft-stack application development."),
        ("JavaScript & TypeScript", "Web front ends and Node services."),
        ("API design", "Contracts other teams can build on."),
        ("Software architecture", "Decisions that are expensive to change later."),
        ("Testing & QA automation", "Proving it works, repeatedly and cheaply."),
        ("Secure coding", "Not writing the vulnerability in the first place."),
        ("UX Design", "Interfaces people can use without being taught."),
    ]),
    "Data & analytics": ("hard", [
        ("SQL", "Querying and shaping relational data."),
        ("Data modelling", "Structures that answer tomorrow's questions too."),
        ("ETL & data pipelines", "Moving data reliably and on schedule."),
        ("Data Engineering", "Building the platform the analytics sit on."),
        ("dbt", "Transformations as version-controlled, tested models."),
        ("Power BI", "Reports and dashboards people actually open."),
        ("Data Quality", "Knowing whether a figure can be trusted."),
        ("Data governance", "Ownership, definitions and access."),
        ("Apache Spark", "Processing data too big for one machine."),
        ("Statistics", "Telling a real difference from noise."),
    ]),
    "Artificial intelligence": ("hard", [
        ("Machine learning", "Models that learn from data, and their limits."),
        ("Deep learning", "Neural networks and when they are worth it."),
        ("Prompt Engineering", "Getting reliable work out of a language model."),
        ("GenAI Literacy", "What these tools can and cannot be trusted with."),
        ("MLOps", "Deploying, monitoring and retraining models."),
        ("Natural language processing", "Working with text at scale."),
        ("Computer vision", "Working with images and video."),
        ("Responsible AI", "Bias, privacy and explainability as requirements."),
    ]),
    "Industrial automation & instrumentation": ("hard", [
        ("PLC programming", "Controllers on the line, and their logic."),
        ("SCADA & HMI", "Supervising and visualising a process."),
        ("Instrumentation & calibration", "Measuring correctly, and proving it."),
        ("Industrial networks", "Fieldbus, Ethernet/IP and determinism."),
        ("Functional safety", "Safety instrumented systems and SIL."),
        ("Predictive maintenance", "Acting on condition rather than calendar."),
        ("Electrical engineering", "Power, protection and schematics."),
    ]),
    "Languages": ("hard", [
        ("French", "Professional written and spoken French."),
        ("English", "Professional written and spoken English."),
        ("Arabic", "Professional written and spoken Arabic."),
        ("Spanish", "Professional written and spoken Spanish."),
    ]),
}

# What the first onboarding question preselects. Keys are the OnboardingRole
# keys; three of the seven offered nothing at all, so an HR colleague finished
# onboarding following no skills and saw an empty profile.
ROLE_SKILLS: dict[str, list[str]] = {
    "business": ["Client orientation", "Project Management", "Written communication",
                 "GenAI Literacy", "Commercial awareness"],
    "manager": ["Delegation", "Giving feedback", "Performance management",
                "Decision making", "Conflict resolution"],
    "engineering": ["Linux administration", "Networking", "Git",
                    "Problem solving", "Scripting (Bash/PowerShell)"],
    "data_analyst": ["SQL", "Power BI", "Data Quality", "Statistics", "Data modelling"],
    "ai": ["Prompt Engineering", "GenAI Literacy", "Machine learning", "Responsible AI"],
    "support": ["Recruitment & sourcing", "HR analytics", "Financial reporting",
                "Procurement & sourcing", "Written communication"],
    "other": ["Communication", "GenAI Literacy", "Learning agility", "Time management"],
    # Retired but kept: learners still carry the key.
    "data_engineer": ["SQL", "Data Engineering", "dbt", "ETL & data pipelines"],
}


def flat() -> list[tuple[str, str, str, str]]:
    """(name, domain, kind, description) for every skill in the catalogue."""
    return [
        (name, domain, kind, description)
        for domain, (kind, skills) in TAXONOMY.items()
        for name, description in skills
    ]


def kinds() -> dict[str, list[str]]:
    """Domains grouped by kind, for a UI that offers them as two lists."""
    out: dict[str, list[str]] = {"soft": [], "hard": []}
    for domain, (kind, _skills) in TAXONOMY.items():
        out[kind].append(domain)
    return out
