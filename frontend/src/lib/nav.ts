import type { IconName } from "@/components/Icon";

/**
 * Navigation is defined once and rendered in the viewer's language.
 *
 * Each entry carries an i18n key *and* the English literal. The literal is the
 * built-in fallback, so a missing translation shows readable English rather
 * than a bare key like `nav.dashboard`.
 */
export interface NavItem {
  href: string;
  labelKey: string;
  label: string;
  icon: IconName;
  descKey: string;
  desc: string;
  /**
   * Roles that may see this entry. Absent = everyone.
   *
   * This is navigation, not security — the API refuses these routes on its own
   * and must keep doing so, because a hidden link is still a reachable URL.
   * What it fixes is the other failure: a collaborator reading "Administration"
   * in their sidebar, clicking it, and being told no. Advertising a door
   * somebody cannot open is its own kind of bug.
   */
  roles?: string[];
  /**
   * The switchboard key this entry belongs to. When that module is off for the
   * viewer, the link goes with it — a sidebar advertising a module the server
   * will refuse is the same bug as advertising one the role cannot open.
   *
   * Entries with no feature are the platform itself and cannot be switched off.
   */
  feature?: string;
}

/** Who sees the governance and reporting surfaces. */
export const HR_ROLES = ["hr", "hr_lead", "admin"];
export const LD_ROLES = ["hr_lead", "admin"];
export const OVERSEER_ROLES = ["manager", "bu_head", "hr", "hr_lead", "admin"];

export interface NavGroup {
  titleKey: string;
  title: string;
  items: NavItem[];
}

/**
 * The navigation this role should be offered.
 *
 * A group whose every entry is filtered out disappears with them; leaving an
 * empty "Tools" heading behind is worse than showing the link, because it tells
 * the reader something is missing without saying what.
 */
export function navFor(
  role: string | null | undefined,
  /** The viewer's feature map. Undefined (still loading, or an older caller)
   *  shows everything their role allows, which is the behaviour from before
   *  the switchboard existed. */
  features?: Record<string, boolean>,
): NavGroup[] {
  const mine = role ?? "user";
  const on = (item: NavItem) => !item.feature || features?.[item.feature] !== false;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.roles || item.roles.includes(mine)) && on(item)),
  })).filter((group) => group.items.length > 0);
}

/** Grouped navigation — drives both the sidebar and the command palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "nav.group.overview",
    title: "Overview",
    items: [
      { href: "/", labelKey: "nav.dashboard", label: "Dashboard", icon: "home", descKey: "nav.dashboard.desc", desc: "Your learning home" },
      { href: "/schedule", labelKey: "nav.schedule", label: "Schedule", icon: "calendar", descKey: "nav.schedule.desc", desc: "Upcoming training sessions & events", feature: "sessions" },
      // Approvals is a decision queue, and a collaborator decides nothing: all
      // they had there was a list of their own requests, which My learning
      // already shows. The page still works for anyone who has its URL —
      // their own requests are their own data — it just stops being offered.
      { href: "/approvals", labelKey: "nav.approvals", label: "Approvals", icon: "team", descKey: "nav.approvals.desc", desc: "Requests waiting on you, and what you asked for", roles: OVERSEER_ROLES },
      { href: "/team", labelKey: "nav.team", label: "My Team", icon: "team", descKey: "nav.team.desc", desc: "Managers: track your team's progress", roles: OVERSEER_ROLES },
      { href: "/org", labelKey: "nav.org", label: "Organization", icon: "org", descKey: "nav.org.desc", desc: "HR analytics: UpSkill, Coursera, or both together", roles: HR_ROLES },
      { href: "/mandatory", labelKey: "nav.mandatory", label: "Tracking", icon: "target", descKey: "nav.mandatory.desc", desc: "L&D: what was assigned, and how everyone is getting on", roles: HR_ROLES, feature: "compliance" },
      // Governance and the report builder were two entries, both about the
      // organisation, and L&D could not tell which held what. One door, three
      // tabs: the org, the people, the reports.
      { href: "/admin/governance", labelKey: "nav.orgReports", label: "Org & reports", icon: "org", descKey: "nav.orgReports.desc", desc: "Business units, people, invitations and the report builder", roles: LD_ROLES },
      { href: "/admin/onboarding", labelKey: "nav.onboardingAdmin", label: "Onboarding", icon: "sparkles", descKey: "nav.onboardingAdmin.desc", desc: "L&D: what a new colleague sees on day one", roles: LD_ROLES },
    ],
  },
  {
    titleKey: "nav.group.learn",
    title: "Learn",
    items: [
      { href: "/formations", labelKey: "nav.formations", label: "Trainings", icon: "formations", descKey: "nav.formations.desc", desc: "Instructor-led trainings & courses" },
      { href: "/pathways", labelKey: "nav.pathways", label: "Pathways", icon: "route", descKey: "nav.pathways.desc", desc: "Curated journeys: trainings, courses & certs", feature: "pathways" },
      { href: "/courses", labelKey: "nav.courses", label: "Courses", icon: "courses", descKey: "nav.courses.desc", desc: "In-app & external courses" },
      { href: "/labs", labelKey: "nav.labs", label: "Labs", icon: "labs", descKey: "nav.labs.desc", desc: "Hands-on, graded lessons", feature: "labs" },
      { href: "/stacks", labelKey: "nav.stacks", label: "Stacks", icon: "stacks", descKey: "nav.stacks.desc", desc: "Local tool recipes", feature: "stacks" },
      { href: "/certifications", labelKey: "nav.certifications", label: "Certifications", icon: "award", descKey: "nav.certifications.desc", desc: "Catalog, team suggestions & earned certificates", feature: "certifications" },
    ],
  },
  {
    // Everything here is switched off for the first release (see
    // app/ops_launch_config.py): the product introduces itself as a training
    // platform, and an innovation board beside it reads as a second product.
    // The entries stay so that turning the switch back on restores the menu.
    titleKey: "nav.group.collaborate",
    title: "Collaborate",
    items: [
      { href: "/challenges", labelKey: "nav.challenges", label: "Challenges", icon: "challenges", descKey: "nav.challenges.desc", desc: "Open innovation board", feature: "challenges" },
      { href: "/sessions", labelKey: "nav.sessions", label: "Sessions", icon: "sessions", descKey: "nav.sessions.desc", desc: "Team talks & decks", feature: "sessions" },
      { href: "/assets", labelKey: "nav.assets", label: "Assets", icon: "assets", descKey: "nav.assets.desc", desc: "Shared notebooks & models", feature: "assets" },
    ],
  },
  {
    titleKey: "nav.group.me",
    title: "My space",
    items: [
      { href: "/settings", labelKey: "nav.settings", label: "Settings", icon: "admin", descKey: "nav.settings.desc", desc: "Your account, language and sign-in" },
      { href: "/history", labelKey: "nav.history", label: "My learning", icon: "route", descKey: "nav.history.desc", desc: "Your record: finished, in progress, and what is due" },
      { href: "/profile", labelKey: "nav.profile", label: "My Profile", icon: "trophy", descKey: "nav.profile.desc", desc: "Level, streak, badges & skill tree" },
      { href: "/skills", labelKey: "nav.mySkills", label: "My skills", icon: "target", descKey: "nav.skills.desc", desc: "Follow skills, self-rate, close the gaps", feature: "skills" },
      { href: "/leaderboard", labelKey: "nav.leaderboard", label: "Leaderboard", icon: "leaderboard", descKey: "nav.leaderboard.desc", desc: "XP & badge rankings", feature: "leaderboard" },
    ],
  },
  {
    titleKey: "nav.group.tools",
    title: "Tools",
    items: [
      // Platform administration proper: roles, labs, integrations, deletions.
      // Narrower than governance — running the people is not running the app.
      { href: "/admin", labelKey: "nav.admin", label: "Admin", icon: "admin", descKey: "nav.admin.desc", desc: "Manage the platform", roles: ["admin"] },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
