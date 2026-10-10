// Thin typed client over the DQ-AI backend. All calls go through the Next.js
// /api proxy (see next.config.js) so there are no CORS surprises in dev.

export interface CheckKind {
  name: string;
  label: string;
  description: string;
  requires_column: boolean;
  params: Record<string, string>;
}

// ---- Learning platform ----

export interface LabSummary {
  id: string;
  title: string;
  track: string;
  difficulty: string;
  summary: string;
  tags: string[];
  total_xp: number;
  step_count: number;
  gradable_count: number;
  completed_count: number;
}

export interface LabStep {
  id: string;
  type: "concept" | "exercise" | "challenge";
  title: string;
  body_md: string;
  xp: number;
  builder: {
    mode: "none" | "check" | "sql" | "choice" | "code";
    table: string;
    schema: string;
    hint_column: string | null;
    options: string[];
    language?: string | null;
    starter_code?: string;
    test_code?: string;
  };
  gradable: boolean;
}

export interface Lab {
  id: string;
  title: string;
  track: string;
  difficulty: string;
  summary: string;
  tags: string[];
  total_xp: number;
  dataset: { schema: string; table: string };
  steps: LabStep[];
}

export interface GradeResult {
  passed: boolean;
  message: string;
  detail: Record<string, unknown>;
  awarded_xp: number;
  new_badges: string[];
  learner_xp: number | null;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

/**
 * The role ladder. `skill_lead` and `manager` are siblings — both oversee a
 * team, and their reach is bounded by which teams they actually lead rather
 * than by the role itself. `hr_lead` sees every HRBP and the whole org, but is
 * not a platform administrator.
 */
export type LearnerRole =
  | "user"
  | "trainer"
  | "skill_lead"
  | "manager"
  | "hr"
  | "hr_lead"
  | "admin";

export interface Learner {
  id: number;
  handle: string;
  /** Real name. Null on accounts that never got one — show the handle then. */
  name: string | null;
  xp: number;
  role?: LearnerRole;
  onboarded?: boolean;
}

export interface RecentActivity {
  lab_id: string;
  lab_title: string;
  step_title: string;
  xp: number;
  at: string;
}

export interface LearnerProfile extends Learner {
  bu: string;
  practice: string;
  location: string;
  matricule: string | null;
  job_level: string;
  completed_steps: string[];
  badges: string[];
  level: number;
  level_title: string;
  xp_into_level: number;
  xp_for_level: number;
  xp_to_next: number;
  level_pct: number;
  current_streak: number;
  longest_streak: number;
  recent: RecentActivity[];
}

export interface LeaderboardEntry {
  handle: string;
  name: string | null;
  team_id: number | null;
  team_name: string;
  xp: number;
  badges: number;
  level: number;
  level_title: string;
  current_streak: number;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  done: boolean;
}

export interface WeeklyQuests {
  week_start: string;
  completed: number;
  total: number;
  quests: Quest[];
}

export interface SkillLab {
  id: string;
  title: string;
  difficulty: string;
  total_steps: number;
  completed_steps: number;
  total_xp: number;
  done: boolean;
}

export interface SkillTrack {
  track: string;
  labs: SkillLab[];
  total_steps: number;
  completed_steps: number;
  total_xp: number;
  earned_xp: number;
  pct: number;
  done: boolean;
}

// ---- Stacks (local toolbox) ----

export interface StackSummary {
  id: string;
  name: string;
  category: string;
  emoji: string;
  difficulty: string;
  summary: string;
  tags: string[];
  use_case_count: number;
}

export interface StackBlock {
  type: "md" | "code";
  body: string;
  language?: string | null;
  filename?: string | null;
}

export interface StackUseCase {
  title: string;
  body: string;
}

export interface StackRecipe {
  id: string;
  name: string;
  category: string;
  emoji: string;
  difficulty: string;
  summary: string;
  tags: string[];
  prerequisites: string[];
  blocks: StackBlock[];
  use_cases: StackUseCase[];
}

// ---- Assets (shared AI/data work) ----

export interface AssetSummary {
  id: number;
  title: string;
  kind: string;
  summary: string;
  tags: string[];
  author: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  learner_id: number | null;
}

export interface Asset extends AssetSummary {
  body_md: string;
  code: string | null;
  link: string | null;
  reviewed_by: string | null;
  review_note: string | null;
}

// ---- Courses ----

export interface SessionGuest {
  id: number;
  email: string;
  name: string;
  company: string;
  status: "invited" | "accepted" | "declined";
  attended: boolean | null;
  invited_by: string;
}

export interface GuestInvitation {
  guest: { name: string; company: string; status: string };
  invited_by: string;
  session: {
    id: number;
    title: string;
    description: string;
    starts_at: string;
    duration_min: number;
    location: string;
    meeting_url: string;
  };
}

export interface GoalTarget {
  skill_id: number;
  name: string;
  current: number;
  target: number;
  gap: number;
  reached: boolean;
}

export interface Goal {
  id: number;
  learner_id: number;
  title: string;
  why: string;
  due_date: string | null;
  overdue: boolean;
  status: "active" | "achieved" | "dropped";
  /** Set when a manager or L&D proposed it rather than the person themselves. */
  created_by: string;
  targets: GoalTarget[];
  reached: number;
  total: number;
  percent: number;
  recommended: { kind: string; id: number; title: string; link: string }[];
}

export interface SearchHit {
  kind: string;
  id: number | string;
  title: string;
  detail: string;
  link: string;
  meta: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  groups: { kind: string; count: number; items: SearchHit[] }[];
  truncated: boolean;
}

export interface TrackingItem {
  kind: "course" | "formation" | "pathway";
  entity_id: number;
  title: string;
  link: string;
  learner_id: number;
  name: string;
  email: string | null;
  bu: string;
  team: string;
  mandatory: boolean;
  assigned_by: string;
  /** Set when the assignment arrived with a team rather than by name. */
  via_team: string;
  due_date: string | null;
  overdue: boolean;
  done: number;
  total: number;
  /** The assignment row itself, so the board can act on it. */
  id: number;
  percent: number;
  status: "not_started" | "in_progress" | "completed";
  /** Set when L&D closed this on evidence outside the platform. */
  accepted_on: string | null;
  accepted_by: string;
  accepted_note: string;
  /** null = not provider content. false = assigned and never signed up, which
   *  is the only state chasing can fix. */
  provider_enrolled: boolean | null;
  attempts: number;
  failed_attempts: number;
  best_score: number | null;
  last_score: number | null;
}

export interface TrackingResponse {
  scope: string;
  /** When the provider figures here were last refreshed. Every Coursera number
   *  on this board is as of this moment, not of now. */
  provider_synced_at: string | null;
  items: TrackingItem[];
  totals: {
    assignments: number;
    people: number;
    mandatory: number;
    completed: number;
    overdue: number;
    never_started: number;
    /** Closed on a decision rather than on a sync. */
    accepted: number;
    /** Assigned, and the provider has never heard of them. */
    not_enrolled: number;
    /** Two or more failed attempts: who needs help, not who is late. */
    struggling: number;
  };
}

export interface Recommendation {
  title: string;
  /** Why this is being suggested, in one checkable sentence. */
  reason: string;
  kind: "finish" | "programme" | "popular_unit" | "popular_org";
  percent: number;
  slug: string;
  course_id: number | null;
  link: string;
  /** True when we do not hold it: the link leaves for the provider. */
  external: boolean;
}

export interface CourseFilters {
  domain?: string;
  provider?: string;
  level?: string;
  pathway?: number;
}

export interface CourseSummary {
  id: number;
  title: string;
  summary: string;
  level: string;
  emoji: string;
  tags: string[];
  author: string;
  external_url: string;
  provider: string;
  /** The provider's own subject classification. */
  domain: string;
  subdomain: string;
  /** Resolved server-side: explicit cover, derived video thumbnail, or "". */
  cover_url: string;
  /** Provider-published course length in hours; 0 = unknown. */
  external_hours: number;
  external_measured_hours: number;
  cost: number;
  created_at: string;
}

export interface CourseLesson {
  id: string;
  title: string;
  type: "article" | "video" | "lab" | "quiz";
  body_md: string;
  video_url?: string | null;
  lab_id?: string | null;
  question?: string | null;
  options: string[];
  answer?: string | null;
}

export interface CourseSection {
  title: string;
  lessons: CourseLesson[];
}

/** Where a course sits in its lifecycle. Only `published` is on the catalogue. */
export type ContentStatus = "draft" | "pending" | "published" | "archived";

export interface Course extends CourseSummary {
  curriculum: { sections: CourseSection[] };
  learner_id: number | null;
  status: ContentStatus;
  reviewed_by: string | null;
  review_note: string | null;
}

export interface CourseProgress {
  total: number;
  completed: string[];
  percent: number;
}

// ---- Formations (instructor-led trainings) ----

export type FormationLessonType =
  | "article"
  | "video"
  | "lab"
  | "quiz"
  | "prompt_playground"
  | "prompt_challenge"
  /** A catalogue course done on the provider — Coursera & co. */
  | "external_course";

export interface FormationQuizQuestion {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
}

export interface FormationLesson {
  id: string;
  title: string;
  type: FormationLessonType;
  body_md: string;
  xp: number;
  duration_min: number;
  video_url?: string | null;
  lab_id?: string | null;
  /** external_course — the catalogue entry this step sends the trainee to. */
  course_id?: number | null;
  questions: FormationQuizQuestion[];
  scenario?: string | null;
  starter_prompt?: string | null;
  goal_md?: string | null;
  task?: string | null;
  challenge_input?: string | null;
  rubric: string[];
  min_score: number;
  /** "" | pre | post — marks a quiz as the entry or exit evaluation. */
  assessment?: string;
}

export interface FormationModule {
  title: string;
  lessons: FormationLesson[];
}

export type TrainingFormat = "in_person" | "virtual" | "hybrid" | "elearning";

export interface SkillTag {
  id: number;
  name: string;
  category: string;
}

export interface FormationSummary {
  id: number;
  title: string;
  summary: string;
  level: string;
  emoji: string;
  tags: string[];
  objectives: string[];
  prerequisites: string;
  format: TrainingFormat;
  /** Declared length in hours; null means "computed from the lessons". */
  duration_hours?: number | null;
  /** type de programme: internal (built in-house) or external (bought in). */
  source: "internal" | "external";
  provider: string;
  trainer_name: string;
  trainer_id: number | null;
  status: string; // draft | published | archived
  open_enrollment: boolean;
  cost: number;
  /** Compliance: expected of the people it is assigned to. */
  mandatory: boolean;
  /** 100% is only reached once the learner has left feedback. */
  require_feedback: boolean;
  created_at: string;
}

export interface FormationCard extends FormationSummary {
  lesson_count: number;
  module_count: number;
  total_xp: number;
  duration_min: number;
  enrolled_count: number;
  my_status: "invited" | "active" | "completed" | "trainer" | null;
  my_progress: number;
}

export interface Formation extends FormationSummary {
  curriculum: { modules: FormationModule[] };
  join_code: string;
  skills: SkillTag[];
}

export interface FormationProgress {
  /** True when the review counts as the last step, so `total` is one more
   *  than the lesson count and 100% waits for it. */
  feedback_required: boolean;
  feedback_given: boolean;
  /** The entry assessment blocking the rest, and the baseline it captured. */
  gating_lesson_id: string | null;
  gate_passed: boolean;
  entry_score: number | null;
  total: number;
  completed: string[];
  percent: number;
  xp_earned: number;
}

export interface PromptJudgement {
  score: number;
  verdict: string;
  criteria: string[];
  strengths: string[];
  improvements: string[];
}

export interface ChallengeResult {
  output: string;
  judgement: PromptJudgement;
  passed: boolean;
  min_score: number;
  progress: FormationProgress;
}

export interface RosterTrainee {
  learner_id: number;
  handle: string;
  name: string | null;
  status: string;
  invited_by: string;
  enrolled_at: string;
  completed: string[];
  percent: number;
  lesson_data: Record<string, { score?: number; prompt?: string; runs?: number }>;
}

export interface Roster {
  formation_id: number;
  join_code: string;
  lesson_ids: string[];
  trainees: RosterTrainee[];
}

export interface FormationAssessments {
  configured: boolean;
  pre_count: number;
  post_count: number;
  rows: {
    learner_id: number;
    handle: string;
    name: string | null;
    pre_score: number | null;
    post_score: number | null;
    gain: number | null;
  }[];
  summary: {
    measured?: number;
    avg_pre?: number | null;
    avg_post?: number | null;
    avg_gain?: number | null;
    improved?: number;
  };
}

// ---- Live sessions & schedule ----

export type RegistrationStatus = "registered" | "waitlisted" | "cancelled";

export interface FormationSession {
  id: number;
  /** null for a standalone open session that belongs to no formation. */
  formation_id: number | null;
  title: string;
  description: string;
  starts_at: string;
  duration_min: number;
  location: string;
  meeting_url: string;
  open_to_all: boolean;
  capacity: number; // 0 = unlimited
  registration_deadline: string | null;
  theme: string;
  trainer_name: string;
  registered_count: number;
  waitlist_count: number;
  seats_left: number | null; // null = unlimited
  registration_open: boolean;
  my_registration: RegistrationStatus | null;
}

export interface UpcomingEvent extends FormationSession {
  formation_title: string;
  formation_emoji: string;
  formation_level: string;
  my_status: "invited" | "active" | "completed" | "trainer" | null;
}

export interface SessionRosterEntry {
  learner_id: number;
  handle: string;
  name: string | null;
  status: RegistrationStatus;
  attended: boolean | null;
}

// ---- Teams (Skill Lead dashboards) ----

export interface Team {
  id: number;
  name: string;
  description: string;
  lead_id: number | null;
  lead_handle: string;
  manager_id: number | null;
  manager_handle: string;
  member_count: number;
  created_at: string;
}

export interface MemberFormation {
  id: number;
  title: string;
  emoji: string;
  status: string;
  percent: number;
}

export interface TeamMember {
  learner_id: number;
  handle: string;
  name: string | null;
  /** Their address — the key their learning record opens under. */
  email: string;
  role: string;
  xp: number;
  level: number;
  level_title: string;
  current_streak: number;
  badges: number;
  lab_steps: number;
  last_active_on: string | null;
  formations: MemberFormation[];
}

export interface TeamTotals {
  members: number;
  total_xp: number;
  badges: number;
  active_this_week: number;
  avg_formation_pct: number;
}

export interface TeamDashboard {
  team: Team;
  totals: TeamTotals;
  members: TeamMember[];
  can_manage: boolean;
}

// ---- Certifications ----

export interface Certification {
  id: number;
  name: string;
  provider: string;
  description: string;
  url: string;
  level: string;
  tags: string[];
  /** Contractually required by a client — prioritised in the renewal view. */
  client_required: boolean;
  client_name: string;
  /** Months of validity; 0 = never expires. Pre-fills a shared certificate's expiry. */
  validity_months: number;
  added_by_name: string;
  created_at: string;
  earned_count: number;
}

export interface CertSuggestion {
  id: number;
  certification: Certification;
  team_id: number | null;
  team_name: string;
  target_id: number | null;
  target_handle: string;
  suggested_by_name: string;
  note: string;
  created_at: string;
}

/** A person in a compliance bucket for one client-required certification. */
/** One slice of the Coursera activity — a programme, a unit, a partner. */
export interface CourseraSlice {
  label: string;
  enrollments: number;
  completed: number;
  not_started: number;
  hours: number;
  people: number;
  completion_rate: number;
}

export interface CourseraOverview {
  synced_at: string | null;
  contract: string;
  totals: {
    people: number;
    enrollments: number;
    completed: number;
    in_progress: number;
    not_started: number;
    completion_rate: number;
    hours: number;
    man_days: number;
    certificates: number;
    avg_grade: number | null;
    /** People whose Coursera account is linked to an AIDA account. */
    matched_people: number;
    active_90d: number;
    /** Multi-course programmes, derived from the completed courses: the
        provider's report never names them. */
    specializations: { programmes_known: number; earned: number; people: number };
  };
  by: {
    program: CourseraSlice[];
    business_unit: CourseraSlice[];
    location: CourseraSlice[];
    partner: CourseraSlice[];
    content_type: CourseraSlice[];
    manager: CourseraSlice[];
  };
  trend: { label: string; value: number }[];
  top_courses: {
    title: string;
    partner: string;
    enrollments: number;
    completed: number;
    hours: number;
    completion_rate: number;
  }[];
}

export interface CourseraPerson {
  email: string;
  name: string;
  business_unit: string;
  job_title: string;
  location: string;
  manager: string;
  program: string;
  learner_id: number | null;
  enrollments: number;
  completed: number;
  not_started: number;
  hours: number;
  certificates: number;
  completion_rate: number;
  last_activity: string | null;
}

export interface CourseraLearnerQuery {
  search?: string;
  program?: string;
  business_unit?: string;
  status?: "all" | "active" | "stalled" | "inactive";
  sort?: "hours" | "completed" | "enrollments" | "completion_rate" | "name" | "last_activity";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Who has one piece of content, and where each of them got to. */
export interface AssignmentRoster {
  people: {
    learner_id: number;
    handle: string;
    name: string;
    email: string;
    bu: string;
    mandatory: boolean;
    due_date: string | null;
    assigned_by: string;
    /** Set when the assignment arrived with a team rather than by name. */
    via_team: string;
    percent: number;
    status: "completed" | "in_progress" | "not_started";
    overdue: boolean;
  }[];
  summary: {
    assigned: number;
    mandatory: number;
    completed: number;
    in_progress: number;
    not_started: number;
    overdue: number;
  };
}

/* ------------------------------------------------ assignment campaigns -- */

/** One thing being handed out. */
export interface CampaignItem {
  entity_type: "course" | "formation" | "pathway";
  entity_id: number;
}

/** Who it goes to. Every field adds people; none removes any, and `roles`
 *  narrows whatever the others selected. */
export interface CampaignAudience {
  learner_ids: number[];
  team_ids: number[];
  bus: string[];
  practices: string[];
  roles: string[];
}

export interface CampaignRequest {
  items: CampaignItem[];
  audience: CampaignAudience;
  mandatory: boolean;
  due_date: string | null;
  note: string;
  learner_id?: number;
}

export interface CampaignPreview {
  people: {
    learner_id: number;
    name: string;
    email: string;
    bu: string;
    team_id: number | null;
    role: string;
  }[];
  items: {
    entity_type: string;
    entity_id: number;
    title: string;
    /** People who do not have it yet — the obligations about to be created. */
    new: number;
    already: number;
  }[];
  totals: {
    people: number;
    items: number;
    assignments: number;
    already: number;
    emails: number;
    /** Named, because somebody with no address will never hear about this. */
    no_email: string[];
  };
}

export interface CampaignResult {
  people: number;
  assignments: number;
  updated: number;
  emails: number;
  mandatory: boolean;
  due_date: string | null;
  items: string[];
}

/** The switchboard: every module, and how it is currently set. */
export interface Switchboard {
  features: {
    key: string;
    label: string;
    /** What turning it off actually removes, in plain words. */
    effect: string;
    enabled: boolean;
    roles: string[];
    bus: string[];
    note: string;
    updated_by: string;
    updated_at: string;
    /** False = nobody has ever touched it, so it is on by default. */
    configured: boolean;
  }[];
  roles: string[];
  bus: string[];
}

/** One person's state on a course or training that was assigned to them. */
export interface TrackedPerson {
  learner_id: number;
  handle?: string;
  name: string;
  email?: string | null;
  bu: string;
  mandatory?: boolean;
  due_date: string | null;
  assigned_by: string;
  lessons_done: number;
  lessons_total: number;
  percent: number;
  status: "completed" | "in_progress" | "not_started";
  overdue: boolean;
}

export interface TrackingSummary {
  assigned: number;
  completed: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

export interface CourseTracking {
  course: { id: number; title: string; mandatory: boolean; lessons: number };
  summary: TrackingSummary;
  people: TrackedPerson[];
}

export interface MandatoryProgramme {
  kind: "course" | "formation";
  id: number;
  title: string;
  summary: TrackingSummary & { rate: number };
  people: {
    learner_id: number;
    name: string;
    bu: string;
    done: number;
    total: number;
    percent: number;
    status: "completed" | "in_progress" | "not_started";
    due_date: string | null;
    overdue: boolean;
    assigned_by: string;
  }[];
}

/** One line of a learner's history, whatever produced it. */
export interface HistoryItem {
  kind: "training" | "course" | "lab" | "external" | "declared";
  id: number;
  title: string;
  status: "completed" | "in_progress" | "not_started";
  percent: number;
  /** For a catalogue entry done on a provider: whether the provider has ever
   *  seen this person on it. null for anything else. */
  provider_enrolled?: boolean | null;
  /** Where to go and sign up, when they have not. */
  provider_url?: string;
  started_on: string | null;
  completed_on: string | null;
  hours: number;
  grade: number | null;
  certificate: boolean;
  mandatory: boolean;
  due_date: string | null;
  /** Who asked for it. Empty for anything the learner started themselves. */
  assigned_by: string;
  link: string | null;
  source: string;
  detail: string;
}

export interface HistoryResponse {
  learner: { id: number; handle: string; name: string | null; xp: number };
  totals: {
    items: number;
    completed: number;
    in_progress: number;
    not_started: number;
    hours: number;
    certificates: number;
    mandatory_open: number;
    overdue: number;
  };
  items: HistoryItem[];
  certificates: {
    id: number; title: string; issuer: string;
    obtained_on: string | null; expires_on: string | null; credential_url: string;
  }[];
}

export interface CompliancePerson {
  learner_id: number;
  handle: string;
  name: string;
  bu: string;
  expires_on: string | null;
}

export interface ComplianceRow {
  certification_id: number;
  name: string;
  provider: string;
  client_name: string;
  validity_months: number | null;
  /** False when nobody has been designated to hold it (no suggestion yet). */
  audience_defined: boolean;
  expected: number;
  valid: CompliancePerson[];
  expiring: CompliancePerson[];
  lapsed: CompliancePerson[];
  missing: CompliancePerson[];
}

export interface CourseraStatus {
  catalog: { available: boolean; auth_required: boolean; note: string };
  reporting: {
    mode: string;
    configured: boolean;
    note: string;
    enrollments: number;
    unmatched: number;
    last_synced_at: string | null;
  };
}

export interface CourseraCatalogPage {
  items: CourseraLookup[];
  next_start: number;
  /** How many catalogue entries were actually read to build this page. */
  scanned: number;
  exhausted: boolean;
  /** True when the filtering was done by us, not by Coursera. */
  search_is_local: boolean;
}

export interface CourseraLookup {
  slug: string;
  title: string;
  summary: string;
  cover_url: string;
  external_url: string;
  workload: string;
  estimated_hours: number | null;
  partners: string[];
}

export interface CourseraSyncResult {
  mode: string;
  created: number;
  updated: number;
  matched_learners: number;
  unmatched: number;
  certificates_recorded: number;
  measured_hours: number;
  estimated_hours: number;
  unmatched_emails: string[];
}

export interface EarnedCertificate {
  id: number;
  learner_id: number;
  handle: string;
  name: string | null;
  team_name: string;
  certification_id: number | null;
  title: string;
  issuer: string;
  obtained_on: string | null;
  expires_on: string | null;
  client_required?: boolean;
  client_name?: string;
  credential_url: string;
  has_file: boolean;
  created_at: string;
}

// ---- Social (comments, likes, shares) ----

export type SocialEntity = "course" | "formation";

export interface SocialComment {
  id: number;
  learner_id: number;
  handle: string;
  name: string | null;
  body: string;
  created_at: string;
}

export interface SocialState {
  likes: number;
  shares: number;
  liked_by_me: boolean;
  shared_by_me: boolean;
  avg_stars: number | null;
  reviews_count: number;
  my_stars: number | null;
  comments: SocialComment[];
}

// ---- HR analytics ----

export interface HrContentRow {
  type: SocialEntity;
  id: number;
  title: string;
  emoji: string;
  owner: string;
  editors: string[];
  subscribers: number;
  completed: number | null;
  completion_rate: number | null;
  comments: number;
  likes: number;
  shares: number;
  hours: number;
  man_days: number;
  cost: number;
  /** mode de formation */
  format: TrainingFormat | "";
  /** type de programme */
  source: "internal" | "external";
  provider: string;
  attendance_rate: number | null;
  external: string;
  avg_stars: number | null;
  reviews_count: number;
  feedback_rate: number;
}

export interface HrCollaboratorRow {
  learner_id: number;
  handle: string;
  name: string | null;
  email: string | null;
  team: string;
  role: string;
  bu: string;
  practice: string;
  location: string;
  matricule: string;
  job_level: string;
  trainings_followed: number;
  courses_followed: number;
  lessons_done: number;
  /** Everything together: in-platform, external and declared. */
  hours: number;
  man_days: number;
  /** In-platform time alone. `hours` already includes `external_hours`, so
   *  comparing the two platforms needs this side stated on its own. */
  app_hours: number;
  /** Share of `hours` done on an external platform (Coursera & co.). */
  external_hours: number;
  external_measured_hours: number;
  external_courses: number;
  external_completed: number;
  external_certificates: number;
  external_completion_rate: number | null;
  external_last_activity: string | null;
  /** The provider account this person is linked to, "" when unlinked. */
  coursera_email: string;
  /** Hours the person logged themselves (articles, books, mentoring…). */
  declared_hours: number;
  declared_records: number;
  sessions_marked: number;
  sessions_attended: number;
  attendance_rate: number | null;
  comments: number;
  likes: number;
  shares: number;
  certificates: number;
  active_this_week: boolean;
  last_active_on: string | null;
}

export interface HrAnalytics {
  /** Which slice of the org the viewer may see (an HRBP is limited to their BU). */
  scope: { label: string; bu: string; bus: string[]; org_wide: boolean };
  hours_per_man_day: number;
  /** Cost is an L&D figure. When false the cost fields are absent from this
   *  payload entirely — hide the column on this flag rather than on a missing
   *  value, which would also hide it on a failed fetch. */
  can_see_cost: boolean;
  totals: {
    learners: number;
    active_this_week: number;
    learning_hours: number;
    man_days: number;
    comments: number;
    likes: number;
    shares: number;
    certificates: number;
    trainings: number;
    courses: number;
    internal_programs: number;
    external_programs: number;
    total_cost?: number;
    completion_rate: number;
    attendance_rate: number | null;
    sessions_attended: number;
    sessions_marked: number;
    /** Measured share: attendance at live sessions, at their scheduled length. */
    session_hours: number;
    /** In-platform hours alone — `learning_hours` minus `external_hours`. */
    app_hours: number;
    /** External platforms (Coursera & co.), measured and estimated together. */
    external_hours: number;
    external_courses: number;
    external_completed: number;
    external_certificates: number;
    external_completion_rate: number | null;
    /** People here with at least one provider enrolment. */
    external_people: number;
    /** The share of `external_hours` the provider reported as time actually
     *  spent, rather than our estimate from published course length. */
    external_measured_hours: number;
    /** Provider accounts we could not tie to a learner here. */
    external_unmatched: number;
    /** Self-declared share — weaker evidence, so reported separately. */
    declared_hours: number;
    declared_records: number;
    declared_verified: number;
    feedback_rate: number;
  };
  content: HrContentRow[];
  collaborators: HrCollaboratorRow[];
}

// ---- Skills ----

export interface SkillRow {
  id: number;
  name: string;
  /** The domain it belongs to: Cybersecurity, Human resources, Leadership… */
  category: string;
  /** "hard" (a craft) or "soft" (a behaviour). HR reads the two separately. */
  kind: "hard" | "soft";
  description: string;
  content_count: number;
  followers: number;
  my_level: number | null;
  following: boolean;
}

export interface SkillContent {
  entity_type: string;
  entity_id: number;
  title: string;
  emoji: string;
}

export interface SkillGap {
  team: { id: number; name: string };
  members: { id: number; handle: string; name: string | null }[];
  skills: {
    skill_id: number;
    name: string;
    category: string;
    levels: Record<string, number | null>;
    avg: number;
    covered: number;
  }[];
}

// ---- Skill growth: ratings with provenance, role targets, logged learning ----

export type RatingSource = "self" | "peer" | "manager" | "assessment" | "none";

export interface SkillStateRow {
  skill_id: number;
  name: string;
  category: string;
  /** Most authoritative rating available. */
  level: number;
  /** Where that level came from — a level is only meaningful with its source. */
  source: RatingSource;
  self: number;
  peers: number;
  manager: number;
  assessment: number;
  /** Level the person's role expects; null when the role sets none. */
  target: number | null;
  /** target − level. Positive = short. null when there is no target. */
  gap: number | null;
}

export interface MySkillState {
  profile: { id: number; name: string; description: string } | null;
  skills: SkillStateRow[];
  gaps: number;
}

export interface SkillRatingDetail {
  self: number;
  effective: { level: number; source: RatingSource };
  ratings: {
    id: number;
    level: number;
    source: RatingSource;
    rater_name: string;
    note: string;
    created_at: string;
  }[];
}

export interface SkillHeatmapCell {
  skill_id: number;
  avg_level: number;
  rated: number;
  /** % of the group at level 3+ ("can do this unaided"). */
  coverage: number;
  targeted: number;
  avg_gap: number;
  people_short: number;
}

export interface SkillHeatmap {
  axis: string;
  scope: "org" | "bu";
  skills: { id: number; name: string; category: string }[];
  groups: { group: string; members: number; cells: SkillHeatmapCell[] }[];
}

export type LearningKind =
  | "article" | "book" | "video" | "podcast" | "course"
  | "conference" | "mentoring" | "on_the_job" | "other";

export interface LearningRecord {
  id: number;
  learner_id: number;
  kind: LearningKind;
  title: string;
  url: string;
  provider: string;
  minutes: number;
  hours: number;
  notes: string;
  completed_on: string | null;
  /** A manager vouched for it. Unverified records still count. */
  verified: boolean;
  review_status: ApprovalStatus;
  review_note: string;
  verified_by_name: string;
  created_at: string;
  skills: { id: number; name: string }[];
}

export interface TeamLearningRecord extends LearningRecord {
  learner_name: string;
  learner_email: string;
}

// ---- Approvals: the tracking board ----

export type ApprovalKind = "training_request" | "asset" | "learning_record" | "course";
export type ApprovalStatus = "pending" | "approved" | "declined";

/** One stage of a training request's approval path. */
export interface ApprovalStep {
  position: number;
  stage: "manager" | "bu_head";
  stage_label: string;
  approver: string;
  approver_id: number | null;
  /** Pending with nobody appointed: the request is blocked, not just waiting. */
  unassigned: boolean;
  status: "pending" | "approved" | "declined" | "skipped";
  note: string;
  decided_at: string | null;
}

export interface ApprovalItem {
  kind: ApprovalKind;
  id: number;
  title: string;
  detail: string;
  /** Null unless the viewer is allowed to see money: an approver decides
   *  on the work, not the budget line. */
  cost: number | null;
  requester: { id: number | null; handle: string; name: string };
  status: ApprovalStatus;
  decided_by: string;
  /** Required on a decline — the requester needs to know why. */
  decision_note: string;
  decided_at: string | null;
  created_at: string;
  link: string;
  /** Set on items that count regardless of the decision (logged learning). */
  advisory?: boolean;
  /** Training requests only: the full path, and the stage it sits on now. */
  chain?: ApprovalStep[];
  awaiting?: ApprovalStep | null;
}

export interface ApprovalInbox {
  can_decide: boolean;
  scope: "org" | "team" | "none";
  pending: ApprovalItem[];
  history: ApprovalItem[];
  counts: { pending: number; approved: number; declined: number };
}

export interface MyApprovals {
  items: ApprovalItem[];
  approver: { id: number | null; handle: string; name: string } | null;
  counts: { pending: number; approved: number; declined: number };
}

export interface HrPerimeters {
  hrbps: {
    id: number;
    handle: string;
    name: string;
    bus: string[];
    headcount: number;
    /** No BU assigned — sees nothing, and probably by accident. */
    unassigned: boolean;
  }[];
  all_bus: string[];
  /** BUs with nobody accountable for them. */
  uncovered_bus: string[];
  totals: { hrbps: number; bus: number; uncovered: number; people: number };
}

// ---- Pathways ----

export interface PathwayStep {
  id: number;
  position: number;
  entity_type: string;
  entity_id: number;
  note: string;
  /** Mandatory step (counts towards completion) vs optional enrichment. */
  required: boolean;
  /** Checkpoint: nothing after it opens until the required work before it is done. */
  milestone: boolean;
  done: boolean;
  /** 0-100, or null when the step has nothing to measure — a certification is
   *  held or it is not, and a half-full bar under it would be a lie. */
  percent: number | null;
  /** Gated behind an unmet milestone. */
  locked: boolean;
  locked_by: string;
  title: string;
  emoji: string;
  link: string;
}

export interface Pathway {
  id: number;
  title: string;
  summary: string;
  emoji: string;
  created_by_name: string;
  published: boolean;
  mandatory: boolean;
  steps: PathwayStep[];
  step_count: number;
  required_count: number;
  required_done: number;
  optional_count: number;
  done_count: number;
  percent: number;
  complete: boolean;
  /** First position that is gated, or null when nothing is locked. */
  locked_from: number | null;
  locked_by: string;
  enrolled: boolean;
  due_date: string | null;
  /** Set on the assignment: this pathway is compliance, not a suggestion.
   *  Separate from the pathway-level `mandatory` above. */
  assigned_mandatory: boolean;
  assigned_by: string;
  enrolled_count: number;
}

// ---- For You feed ----

export interface MyFeed {
  goal: { weekly_goal_min: number; done_min: number };
  pending: { formation_id: number; title: string; emoji: string; invited_by: string; link: string }[];
  recommendations: { certification: string; note: string; by: string; link: string }[];
  upcoming: { title: string; formation: string; emoji: string; starts_at: string; location: string; link: string }[];
  pathways: Pathway[];
  team_activity: { kind: string; text: string; at: string; link: string }[];
}

// ---- Notifications ----

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

export interface NotificationList {
  unread: number;
  items: AppNotification[];
}

// ---- Challenges (open innovation) ----

export interface ChallengeSummary {
  id: number;
  title: string;
  summary: string;
  theme: string;
  prize: string | null;
  deadline: string | null;
  status: string;
  tags: string[];
  author: string;
  created_at: string;
}

export interface Submission {
  id: number;
  challenge_id: number;
  title: string;
  summary: string;
  body_md: string;
  link: string | null;
  author: string;
  learner_id: number | null;
  created_at: string;
  votes: number;
}

export interface ChallengeDetail extends ChallengeSummary {
  brief_md: string;
  learner_id: number | null;
  submissions: Submission[];
}

// ---- Sharing sessions ----

export interface SharingSummary {
  id: number;
  title: string;
  abstract: string;
  presenter: string;
  session_date: string | null;
  tags: string[];
  author: string;
  created_at: string;
  has_deck: boolean;
  recording_url: string | null;
}

export interface SharingSession extends SharingSummary {
  body_md: string;
  file_name: string | null;
  file_original_name: string | null;
  learner_id: number | null;
}

// ---- Admin ----

export interface AdminLabRow {
  id: string;
  title: string;
  track: string;
  difficulty: string;
  steps: number;
  total_xp: number;
  source: "file" | "db";
  published: boolean;
  overridden: boolean;
}

export interface AdminStats {
  labs: { file: number; db: number; published: number; total_visible: number };
  tracks: string[];
  learners: number;
  completions: number;
  badges_awarded: number;
  total_xp: number;
  stacks: number;
  assets: number;
  courses: number;
  challenges: number;
  sessions: number;
}

export interface AdminLearnerRow {
  id: number;
  handle: string;
  role: LearnerRole;
  xp: number;
  completions: number;
  badges: number;
  bu: string;
  practice: string;
  location: string;
  matricule: string;
  job_level: string;
}

export interface LearnerOrgFields {
  bu: string;
  practice: string;
  location: string;
  matricule: string;
  job_level: string;
}

// A lab definition mirrors the YAML schema; kept loose for the editor.
export type LabDefinition = {
  id: string;
  title: string;
  track: string;
  difficulty: string;
  summary: string;
  tags: string[];
  dataset: { schema: string; table: string };
  steps: Array<Record<string, unknown>>;
};

function adminHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("dqai.adminToken");
  return t ? { "X-Admin-Token": t } : {};
}

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("dqai.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Every call goes through the Next.js /api proxy (see next.config.js). */
const API_BASE = "/api";

/**
 * Open a PDF the API will only hand to an authenticated caller.
 *
 * These used to be `window.open("/api/.../person.pdf?…")`. A new tab is a
 * fresh request with no Authorization header — the session token lives in
 * localStorage, not in a cookie — so the server saw an anonymous caller,
 * stripped the `learner_id` it could not prove, and answered "sign in to
 * continue". The link looked right and never worked.
 *
 * So fetch it like any other call, with the token, and open the bytes.
 * `adminToken` is included because the reporting screens can also be driven
 * by somebody holding only the platform token.
 */
export async function openPdf(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...authHeader(), ...adminHeaders() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `Request failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank");
  // The tab has the bytes; the handle is only needed until it loads.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    // The session died somewhere else — it expired, the password was changed,
    // or somebody signed out in another tab. Whatever the screen was doing,
    // the honest answer is the sign-in page, not an error card telling the
    // reader to sign in while the app keeps pretending they are in.
    // Not on the sign-in calls themselves: a wrong password is also a 401,
    // and bouncing there would clear the page and swallow the one message the
    // person needs to read.
    const signingIn = path.startsWith("/auth/login") || path.startsWith("/auth/password");
    if (res.status === 401 && !signingIn && typeof window !== "undefined") {
      const { signOutEverywhere } = await import("./auth");
      await signOutEverywhere();
    }
    throw new Error(detail.detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** One choice in the first-connection wizard, as L&D configured it.
 *  Labels ship in both languages: they are content, not interface chrome, so
 *  they live in the database rather than the UI dictionary. */
export interface OnboardingRole {
  id: number;
  key: string;
  label_fr: string;
  label_en: string;
  emoji: string;
  sort_order: number;
  active: boolean;
  skill_ids: number[];
}

export interface OnboardingGoal {
  id: number;
  minutes: number;
  label_fr: string;
  label_en: string;
  sort_order: number;
  active: boolean;
}

/** What the console submits — no ids: rows are matched on key / minutes. */
export type OnboardingRoleIn = Omit<OnboardingRole, "id" | "sort_order">;
export type OnboardingGoalIn = Omit<OnboardingGoal, "id" | "sort_order">;

/** The signed-in person's own account (see backend routes/account.py). */
export interface Account {
  id: number;
  handle: string;
  name: string;
  email: string;
  role: string;
  role_label: string;
  bu: string;
  practice: string;
  team: string;
  title: string;
  job_level: string;
  location: string;
  matricule: string;
  locale: "fr" | "en";
  weekly_goal_min: number;
  onboarded: boolean;
  xp: number;
  /** How this person proves who they are. */
  sign_in: "azure" | "password" | "handle";
  sso_available: boolean;
  sso_linked: boolean;
  password_managed_by: "microsoft" | "none";
}

/** What the server believes about this request — the honest answer to
 *  "am I actually signed in?", independent of what the browser thinks. */
export interface SessionInfo {
  sso_configured: boolean;
  tenant_id: string;
  token_present: boolean;
  token_valid: boolean;
  token_email: string;
  token_is_admin: boolean;
  identity_enforced: boolean;
  learner_id: number | null;
  handle: string;
}

/** One person as they appear anywhere in the org chart. */
export interface OrgPerson {
  id: number | null;
  handle: string;
  name: string;
  /** Their address, and the key their learning record is keyed by. Empty for
   *  the synthetic "Administration" node, which is nobody. */
  email: string;
  role: string;
  /** How this person appears at this spot in the chart — a trainer can be a
   *  team's skill lead, so the role and the label are not always the same. */
  role_label: string;
  bu: string;
  job_level: string;
}

export interface OrgChartTeam {
  id: number;
  name: string;
  manager: OrgPerson | null;
  lead: OrgPerson | null;
  members: OrgPerson[];
  member_count: number;
}

export interface OrgChartBu {
  name: string;
  /** Who runs the BU, above every team manager in it. Null means nobody does —
   *  which also means training requests raised there stall at their second
   *  approval stage. */
  head: OrgPerson | null;
  teams: OrgChartTeam[];
  team_count: number;
  /** People organised into a team. */
  member_count: number;
  /** Everyone in the BU, team or not — the two differ exactly where somebody
   *  sits in a BU with no team, which is worth seeing. */
  headcount: number;
}

export interface OrgChartHrbp extends OrgPerson {
  bus: OrgChartBu[];
  bu_count: number;
  member_count: number;
  headcount: number;
  /** No BU assigned — a misconfiguration, not a decision. */
  unassigned: boolean;
}

/** The reporting line: HR lead over HRBPs, HRBPs over BUs, BUs over teams. */
export interface OrgChart {
  root: OrgPerson | null;
  scope: { label: string; org_wide: boolean };
  /** False when the viewer is an HRBP looking at their own perimeter: they are
   *  the root of what they can see, but they lead no other HRBP. */
  root_leads_hrbps: boolean;
  hrbps: OrgChartHrbp[];
  /** BUs with teams but no HRBP, plus teams whose members carry no BU. */
  unattached_bus: OrgChartBu[];
  totals: {
    hrbps: number;
    bus: number;
    teams: number;
    people: number;
    uncovered_bus: number;
    /** BUs with no operational head. */
    headless_bus: number;
  };
}


/* ----------------------------------------------------------- reporting -- */

export interface DatasetColumn {
  name: string;
  type: "text" | "number" | "date";
}

export interface DatasetSummary {
  id: number;
  name: string;
  description: string;
  /** "builtin" = AIDA's own data; "upload" = a file somebody loaded. */
  kind: "builtin" | "upload";
  owner: string;
  columns: DatasetColumn[];
  row_count: number;
  source_filename: string;
  updated_at: string;
}

export interface QueryResult {
  /** One object per group: dimension values plus one key per measure label. */
  rows: Record<string, unknown>[];
  group_count: number;
  /** True when more groups exist than were returned; totals still cover all. */
  truncated: boolean;
  totals: Record<string, number | null> & { _rows: number };
  dataset: { id: number; name: string };
  measures: string[];
  dimensions: string[];
}

export interface SavedViewOut {
  id: number;
  dataset_id: number;
  name: string;
  description: string;
  owner: string;
  shared: boolean;
  mine: boolean;
  config: Record<string, unknown>;
  updated_at: string;
}

/* ---------------------------------------------------------- governance -- */

export interface GovPerson {
  id: number;
  handle: string;
  name: string;
  role: string;
  title: string;
}

export interface GovTeam {
  id: number;
  name: string;
  manager: GovPerson | null;
  member_count: number;
}

export interface GovBu {
  id: number;
  name: string;
  code: string;
  description: string;
  position: number;
  archived: boolean;
  /** Runs the unit operationally, and takes stage 2 of its approvals. */
  head: GovPerson | null;
  /** HR business partners covering it — reporting, not authority. */
  hrbps: GovPerson[];
  teams: GovTeam[];
  headcount: number;
  practices: { id: number; name: string; position: number; headcount: number }[];
}

export interface GovOverview {
  business_units: GovBu[];
  /** People tagged with a BU that has no registry row — only possible from
   *  pre-registry data, and invisible in the chart until fixed. */
  orphan_bus: string[];
  unassigned_people: GovPerson[];
  roles: string[];
  /** Teams under no unit — they render as "Sans BU" on the org chart. */
  unattached_teams: GovTeam[];
}

export interface GovDirectoryPerson {
  id: number;
  handle: string;
  name: string;
  email: string;
  role: string;
  title: string;
  job_level: string;
  practice: string;
  location: string;
  matricule: string;
  bu: string;
  team_id: number | null;
  team: string;
  heads_bus: string[];
  hr_bus: string[];
}

export const api = {
  // ai
  aiStatus: () => req<{ enabled: boolean; provider: string; model: string }>("/ai/status"),
  tutor: (body: unknown) =>
    req<{ hint: string }>("/ai/tutor", { method: "POST", body: JSON.stringify(body) }),
  reviewCode: (body: { language: string; code: string; task: string; dataset?: string | null }) =>
    req<import("./ai").CodeReview>("/ai/review", { method: "POST", body: JSON.stringify(body) }),
  quiz: (body: { lab_id?: string; topic?: string; n?: number }) =>
    req<import("./ai").Quiz>("/ai/quiz", { method: "POST", body: JSON.stringify(body) }),
  recommend: (learnerId?: number) =>
    req<import("./ai").LearningPath>(`/ai/recommend${learnerId ? `?learner_id=${learnerId}` : ""}`),

  // labs
  listLabs: (learnerId?: number) =>
    req<LabSummary[]>(`/labs${learnerId ? `?learner_id=${learnerId}` : ""}`),
  getLab: (id: string) => req<Lab>(`/labs/${id}`),
  /** Grader kinds a lab step can use. Moved under /labs when the
   *  data-quality suite builder that used to own them was removed. */
  checkKinds: () => req<CheckKind[]>("/labs/check-kinds"),
  badges: () => req<Badge[]>("/labs/badges"),
  gradeStep: (labId: string, stepId: string, body: unknown) =>
    req<GradeResult>(`/labs/${labId}/steps/${stepId}/grade`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // auth
  authMe: () =>
    req<{
      authenticated: boolean;
      learner_id: number;
      handle: string;
      email: string;
      name: string;
      is_admin: boolean;
      role: LearnerRole;
      xp: number;
      onboarded: boolean;
      must_change_password: boolean;
    }>("/auth/me"),

  // learners
  /** Sign in with a work email and a password. Returns a session token the
   *  caller stores under `dqai.token`, where every request already looks. */
  login: (email: string, password: string) =>
    req<{
      token: string;
      learner_id: number;
      handle: string;
      name: string | null;
      email: string | null;
      role: string;
      onboarded: boolean;
      /** The password was set by somebody else. The app blocks until it is
       *  replaced — see ChoosePassword. */
      must_change_password: boolean;
    }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  /** Change your own password. The new token replaces the old one, which the
   *  server has just invalidated along with every other session. */
  changePassword: (body: { current_password: string; new_password: string; learner_id?: number }) =>
    req<{ token: string }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
  /** Take somebody out of the live organisation without erasing their record:
   *  team, BU and any head/HR roles are cleared, the history stays in the
   *  reports it already counts towards. Deleting them would rewrite last
   *  year's figures, which is not what "they left" means. */
  govDeactivate: (personId: number, learnerId?: number) =>
    req<void>(
      `/governance/people/${personId}/deactivate${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "POST", headers: adminHeaders() },
    ),
  /** L&D or admin: give somebody a password, or replace a forgotten one. */
  setPassword: (body: { email: string; new_password: string; learner_id?: number }) =>
    req<{
      handle: string;
      email: string;
      password_set: boolean;
      must_change_password: boolean;
    }>("/auth/password/set", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  /** Which modules this viewer gets — the switchboard, as it applies to them. */
  myFeatures: (learnerId?: number) =>
    req<{ features: Record<string, boolean> }>(
      `/features/mine${learnerId ? `?learner_id=${learnerId}` : ""}`,
    ),
  /** Admin only, and deliberately absent from the API docs. */
  switchboard: (learnerId?: number) =>
    req<Switchboard>(`/admin/switchboard${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),
  setSwitch: (body: {
    key: string;
    enabled: boolean;
    roles: string[];
    bus: string[];
    note: string;
    learner_id?: number;
  }) =>
    req<{ key: string; enabled: boolean }>("/admin/switchboard", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  clearSwitch: (key: string, learnerId?: number) =>
    req<{ key: string; cleared: boolean }>(
      `/admin/switchboard/${key}${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "DELETE", headers: adminHeaders() },
    ),
  createLearner: (handle: string) =>
    req<Learner>("/learners", { method: "POST", body: JSON.stringify({ handle }) }),
  learnerProfile: (id: number, viewerId?: number) =>
    req<LearnerProfile>(`/learners/${id}${viewerId ? `?viewer_id=${viewerId}` : ""}`),
  quests: (id: number) => req<WeeklyQuests>(`/learners/${id}/quests`),
  tracks: (learnerId?: number) =>
    req<{ tracks: SkillTrack[] }>(`/tracks${learnerId ? `?learner_id=${learnerId}` : ""}`),
  leaderboard: (opts?: { teamId?: number | null; days?: number | null }) => {
    const p = new URLSearchParams();
    if (opts?.teamId) p.set("team_id", String(opts.teamId));
    if (opts?.days) p.set("days", String(opts.days));
    const qs = p.toString();
    return req<LeaderboardEntry[]>(`/leaderboard${qs ? `?${qs}` : ""}`);
  },
  teamNames: () => req<{ id: number; name: string }[]>("/teams/names"),

  // stacks
  listStacks: () => req<StackSummary[]>("/stacks"),
  getStack: (id: string) => req<StackRecipe>(`/stacks/${id}`),

  // assets
  listAssets: (opts?: { kind?: string; q?: string; learnerId?: number ; pendingReview?: boolean}) => {
    const p = new URLSearchParams();
    if (opts?.kind) p.set("kind", opts.kind);
    if (opts?.q) p.set("q", opts.q);
    if (opts?.learnerId) p.set("learner_id", String(opts.learnerId));
    if (opts?.pendingReview) p.set("pending_review", "true");
    const qs = p.toString();
    return req<AssetSummary[]>(`/assets${qs ? `?${qs}` : ""}`);
  },
    reviewAsset: (assetId: number, learnerId: number, decision: "approve" | "reject", note = "") =>
    req<Asset>(`/assets/${assetId}/review`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, decision, note }),
    }),
  getAsset: (id: number) => req<Asset>(`/assets/${id}`),
  createAsset: (body: unknown) =>
    req<Asset>("/assets", { method: "POST", body: JSON.stringify(body) }),
  deleteAsset: (id: number, learnerId?: number) =>
    req<void>(`/assets/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),

  // courses
  /** The catalogue. `mine` also returns that learner's own drafts; the rest
   *  narrow it, which an 800-entry catalogue needs to be usable. */
  /** Guests from outside the company, on one session. */
  sessionGuests: (sessionId: number, learnerId?: number) =>
    req<SessionGuest[]>(
      `/training-sessions/${sessionId}/guests${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  inviteGuest: (
    sessionId: number,
    body: { email: string; name?: string; company?: string; learner_id?: number },
  ) =>
    req<SessionGuest>(`/training-sessions/${sessionId}/guests`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  withdrawGuest: (sessionId: number, guestId: number, learnerId?: number) =>
    req<void>(
      `/training-sessions/${sessionId}/guests/${guestId}${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "DELETE", headers: adminHeaders() },
    ),
  markGuestAttendance: (sessionId: number, guestId: number, attended: boolean, learnerId?: number) =>
    req<SessionGuest>(`/training-sessions/${sessionId}/guests/attendance`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ guest_id: guestId, attended, learner_id: learnerId }),
    }),
  /** The invitation a guest opens. The token is the whole credential. */
  guestInvitation: (token: string) =>
    req<GuestInvitation>(`/training-sessions/guest/${token}`),
  guestReply: (token: string, reply: "accepted" | "declined") =>
    req<{ status: string }>(`/training-sessions/guest/${token}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply }),
    }),
  /** Somebody's learning goals: their own, or within your perimeter. */
  listGoals: (learnerId: number, viewerId?: number) =>
    req<{ goals: Goal[]; totals: { active: number; achieved: number; overdue: number } }>(
      `/goals?learner_id=${learnerId}${viewerId ? `&viewer_id=${viewerId}` : ""}`,
    ),
  createGoal: (body: {
    learner_id: number;
    title: string;
    why?: string;
    targets: { skill_id: number; target: number }[];
    due_date?: string | null;
    author_id?: number;
  }) => req<Goal>("/goals", { method: "POST", body: JSON.stringify(body) }),
  setGoalStatus: (goalId: number, status: "achieved" | "dropped" | "active", learnerId: number) =>
    req<Goal>(`/goals/${goalId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, learner_id: learnerId }),
    }),
  /** One search across courses, trainings, pathways, labs, sessions,
   *  challenges, assets, certifications and skills. */
  search: (q: string, limit = 40) =>
    req<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** Hand a course, training or pathway to people and/or a whole team. */
  assign: (body: {
    entity_type: "course" | "formation" | "pathway";
    entity_id: number;
    learner_ids?: number[];
    team_id?: number | null;
    mandatory?: boolean;
    due_date?: string | null;
    note?: string;
    learner_id?: number;
  }) => req<{ assigned: string[]; updated: string[] }>("/assignments", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  }),
  /** Who already has one course, training or pathway. */
  assignmentRoster: (
    entityType: "course" | "formation" | "pathway",
    entityId: number,
    learnerId?: number,
  ) =>
    req<AssignmentRoster>(
      `/assignments/roster?${new URLSearchParams({
        entity_type: entityType,
        entity_id: String(entityId),
        ...(learnerId ? { learner_id: String(learnerId) } : {}),
      })}`,
      { headers: adminHeaders() },
    ),
  /** Who a campaign would reach, and what they already have — before sending. */
  assignmentPreview: (body: CampaignRequest) =>
    req<CampaignPreview>("/assignments/preview", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  /** Assign several things to a whole audience, with one email per person. */
  assignmentCampaign: (body: CampaignRequest) =>
    req<CampaignResult>("/assignments/campaign", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  /** Close an assignment on evidence the platform cannot see — a Coursera
   *  course taken outside the organisation's programmes, typically. Recorded
   *  with the name of whoever decided. */
  acceptAssignment: (assignmentId: number, learnerId: number, note: string) =>
    req<{ id: number; accepted_on: string | null; accepted_by: string }>(
      `/assignments/${assignmentId}/accept`,
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ learner_id: learnerId, note }) },
    ),
  undoAcceptAssignment: (assignmentId: number, learnerId: number) =>
    req<{ id: number }>(`/assignments/${assignmentId}/accept?learner_id=${learnerId}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  assignmentTracking: (learnerId?: number) =>
    req<TrackingResponse>(
      `/assignments/tracking${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  /** What to learn next, with the reason attached. */
  recommendations: (learnerId: number) =>
    req<{ items: Recommendation[] }>(`/recommendations/mine?learner_id=${learnerId}`),
  listCourses: (q?: string, mine?: number, filters?: CourseFilters) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (mine) qs.set("mine", String(mine));
    if (filters?.domain) qs.set("domain", filters.domain);
    if (filters?.provider) qs.set("provider", filters.provider);
    if (filters?.level) qs.set("level", filters.level);
    if (filters?.pathway) qs.set("pathway", String(filters.pathway));
    return req<CourseSummary[]>(`/courses${qs.toString() ? `?${qs}` : ""}`);
  },
  /** Hand a draft to the curators. A curator's own course publishes straight away. */
  submitCourse: (courseId: number, learnerId?: number) =>
    req<{ status: ContentStatus }>(
      `/courses/${courseId}/submit${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "POST" },
    ),
  getCourse: (id: number) => req<Course>(`/courses/${id}`),
  createCourse: (body: unknown) =>
    req<Course>("/courses", { method: "POST", body: JSON.stringify(body) }),
  updateCourse: (id: number, body: unknown, learnerId?: number) =>
    req<Course>(`/courses/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  assignCourse: (
    courseId: number,
    body: {
      people: string[];
      mandatory: boolean;
      due_date: string | null;
      note: string;
      learner_id: number | null;
    },
  ) =>
    req<{ assigned: string[]; skipped: { who: string; reason: string }[] }>(
      `/courses/${courseId}/assign`,
      { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) },
    ),
  courseTracking: (courseId: number, learnerId?: number) =>
    req<CourseTracking>(
      `/courses/${courseId}/tracking${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  mandatoryTracking: (learnerId?: number) =>
    req<{
      scope: string;
      programmes: MandatoryProgramme[];
      totals: {
        programmes: number;
        assignments: number;
        people: number;
        completed: number;
        overdue: number;
        rate: number;
      };
    }>(`/compliance/mandatory${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),
  deleteCourse: (id: number, learnerId?: number) =>
    req<void>(`/courses/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  completeLesson: (courseId: number, lessonId: string, learnerId: number) =>
    req<CourseProgress>(
      `/courses/${courseId}/lessons/${lessonId}/complete?learner_id=${learnerId}`,
      { method: "POST" },
    ),
  courseProgress: (courseId: number, learnerId: number) =>
    req<CourseProgress>(`/courses/${courseId}/progress?learner_id=${learnerId}`),

  // formations
  listFormations: (learnerId?: number) =>
    req<FormationCard[]>(`/formations${learnerId ? `?learner_id=${learnerId}` : ""}`),
  getFormation: (id: number, learnerId?: number) =>
    req<Formation>(`/formations/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`),
  createFormation: (body: unknown) =>
    req<Formation>("/formations", { method: "POST", body: JSON.stringify(body) }),
  updateFormation: (id: number, body: unknown, learnerId?: number) =>
    req<Formation>(`/formations/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  deleteFormation: (id: number, learnerId?: number) =>
    req<void>(`/formations/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  inviteTrainees: (id: number, handles: string[], learnerId?: number) =>
    req<{ invited: string[]; skipped: { handle: string; reason: string }[] }>(
      `/formations/${id}/invite`,
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ handles, learner_id: learnerId }) },
    ),
  respondToInvite: (id: number, learnerId: number, accept: boolean) =>
    req<{ status: string }>(`/formations/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, accept }),
    }),
  enrollFormation: (id: number, learnerId: number, joinCode?: string) =>
    req<{ status: string }>(`/formations/${id}/enroll`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, join_code: joinCode ?? null }),
    }),
  formationAssessments: (id: number, learnerId?: number) =>
    req<FormationAssessments>(
      `/formations/${id}/assessments${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  formationProgress: (id: number, learnerId: number) =>
    req<FormationProgress>(`/formations/${id}/progress?learner_id=${learnerId}`),
  completeFormationLesson: (id: number, lessonId: string, learnerId: number, data?: Record<string, unknown>) =>
    req<FormationProgress>(`/formations/${id}/lessons/${lessonId}/complete`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, data: data ?? {} }),
    }),
  runPlayground: (id: number, lessonId: string, prompt: string, learnerId?: number) =>
    req<{ output: string }>(`/formations/${id}/lessons/${lessonId}/playground`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId ?? null, prompt }),
    }),
  runChallenge: (id: number, lessonId: string, prompt: string, learnerId: number) =>
    req<ChallengeResult>(`/formations/${id}/lessons/${lessonId}/challenge`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, prompt }),
    }),
  formationRoster: (id: number, learnerId?: number) =>
    req<Roster>(`/formations/${id}/roster${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),

  // live sessions & schedule
  listFormationSessions: (id: number) =>
    req<FormationSession[]>(`/formations/${id}/sessions`),
  createFormationSession: (id: number, body: unknown) =>
    req<FormationSession>(`/formations/${id}/sessions`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  deleteFormationSession: (id: number, sessionId: number, learnerId?: number) =>
    req<void>(
      `/formations/${id}/sessions/${sessionId}${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "DELETE", headers: adminHeaders() },
    ),
  upcomingEvents: (learnerId?: number, days?: number) => {
    const p = new URLSearchParams();
    if (learnerId) p.set("learner_id", String(learnerId));
    if (days) p.set("days", String(days));
    const qs = p.toString();
    return req<UpcomingEvent[]>(`/events/upcoming${qs ? `?${qs}` : ""}`);
  },

  // teams
  listTeams: (learnerId?: number) =>
    req<Team[]>(`/teams${learnerId ? `?learner_id=${learnerId}` : ""}`, { headers: adminHeaders() }),
  createTeam: (body: unknown) =>
    req<Team>("/teams", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) }),
  updateTeam: (id: number, body: unknown) =>
    req<Team>(`/teams/${id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify(body) }),
  deleteTeam: (id: number, learnerId?: number) =>
    req<void>(`/teams/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  addTeamMembers: (id: number, handles: string[], learnerId?: number) =>
    req<{ added: string[]; skipped: { handle: string; reason: string }[] }>(
      `/teams/${id}/members`,
      { method: "POST", headers: adminHeaders(), body: JSON.stringify({ handles, learner_id: learnerId }) },
    ),
  assignFormation: (teamId: number, formationId: number, memberIds: number[], learnerId?: number) =>
    req<{ assigned: string[]; skipped: { handle: string; reason: string }[] }>(
      `/teams/${teamId}/assign-formation`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ formation_id: formationId, member_ids: memberIds, learner_id: learnerId }),
      },
    ),
  removeTeamMember: (id: number, memberId: number, learnerId?: number) =>
    req<void>(`/teams/${id}/members/${memberId}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  orgOverview: (learnerId?: number) =>
    req<TeamDashboard[]>(`/teams/overview${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),

  // social
  socialState: (etype: SocialEntity, eid: number, learnerId?: number) =>
    req<SocialState>(`/social/${etype}/${eid}${learnerId ? `?learner_id=${learnerId}` : ""}`),
  addComment: (etype: SocialEntity, eid: number, learnerId: number, body: string) =>
    req<{ ok: boolean }>(`/social/${etype}/${eid}/comments`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, body }),
    }),
  deleteComment: (commentId: number, learnerId?: number) =>
    req<void>(`/social/comments/${commentId}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  toggleLike: (etype: SocialEntity, eid: number, learnerId: number) =>
    req<{ likes: number; shares: number; liked_by_me: boolean }>(`/social/${etype}/${eid}/like`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId }),
    }),
    rateEntity: (etype: SocialEntity, eid: number, learnerId: number, stars: number) =>
    req<{ avg_stars: number | null; reviews_count: number; my_stars: number }>(
      `/social/${etype}/${eid}/rate`,
      { method: "POST", body: JSON.stringify({ learner_id: learnerId, stars }) },
    ),
  recordShare: (etype: SocialEntity, eid: number, learnerId: number) =>
    req<{ likes: number; shares: number }>(`/social/${etype}/${eid}/share`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId }),
    }),

  // skills
  listSkills: (learnerId?: number) =>
    req<SkillRow[]>(`/skills${learnerId ? `?learner_id=${learnerId}` : ""}`),
  createSkill: (body: unknown) =>
    req<{ id: number }>("/skills", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) }),
  skillContent: (id: number) => req<SkillContent[]>(`/skills/${id}/content`),
  followSkill: (id: number, learnerId: number, opts?: { level?: number; following?: boolean }) =>
    req<{ level: number; following: boolean }>(`/skills/${id}/follow`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, ...opts }),
    }),
  skillGap: (teamId: number, learnerId?: number) =>
    req<SkillGap>(`/skills/gap?team_id=${teamId}${learnerId ? `&learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),

  // training sessions (registration + attendance)
  listTrainingSessions: (params: {
    learnerId?: number;
    days?: number;
    openOnly?: boolean;
    includePast?: boolean;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.learnerId) qs.set("learner_id", String(params.learnerId));
    if (params.days) qs.set("days", String(params.days));
    if (params.openOnly) qs.set("open_only", "true");
    if (params.includePast) qs.set("include_past", "true");
    const q = qs.toString();
    return req<UpcomingEvent[]>(`/training-sessions${q ? `?${q}` : ""}`);
  },
  createTrainingSession: (body: unknown) =>
    req<UpcomingEvent>("/training-sessions", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  deleteTrainingSession: (id: number, learnerId?: number) =>
    req<void>(`/training-sessions/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  registerForSession: (id: number, learnerId: number) =>
    req<{ status: RegistrationStatus; already: boolean }>(`/training-sessions/${id}/register`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId }),
    }),
  cancelSessionRegistration: (id: number, learnerId: number) =>
    req<{ status: string; promoted: number[] }>(`/training-sessions/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId }),
    }),
  sessionRoster: (id: number, learnerId?: number) =>
    req<SessionRosterEntry[]>(
      `/training-sessions/${id}/roster${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  markSessionAttendance: (
    id: number,
    marks: { learner_id: number; attended: boolean | null }[],
    learnerId?: number,
  ) =>
    req<{ updated: number }>(`/training-sessions/${id}/attendance`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ marks, learner_id: learnerId }),
    }),
  /** Absolute URL — the browser downloads it directly. */
  sessionIcsUrl: (id: number) => `${API_BASE}/training-sessions/${id}/ics`,

  // skill growth
  mySkillState: (learnerId: number) =>
    req<MySkillState>(`/skills/me/state?learner_id=${learnerId}`),
  skillRatings: (skillId: number, learnerId: number) =>
    req<SkillRatingDetail>(`/skills/${skillId}/ratings?learner_id=${learnerId}`),
  rateSkill: (
    skillId: number,
    body: { learner_id: number; level: number; source: "peer" | "manager" | "assessment"; note?: string; rater_id?: number },
  ) =>
    req<{ level: number; source: RatingSource }>(`/skills/${skillId}/rate`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  skillProfiles: () =>
    req<{ id: number; name: string; description: string; practice: string; job_level: string; targets: { skill_id: number; name: string; target_level: number }[] }[]>(
      "/skills/profiles",
    ),
  skillHeatmap: (axis: string, learnerId?: number) =>
    req<SkillHeatmap>(
      `/skills/heatmap?axis=${axis}${learnerId ? `&learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),

  // self-reported learning
  learningKinds: () => req<{ kinds: LearningKind[] }>("/learning/kinds"),
  myLearning: (learnerId: number) =>
    req<LearningRecord[]>(`/learning/records?learner_id=${learnerId}`),
  logLearning: (body: {
    learner_id: number; kind: string; title: string; url?: string;
    provider?: string; minutes?: number; notes?: string; skill_ids?: number[];
  }) =>
    req<LearningRecord>("/learning/records", { method: "POST", body: JSON.stringify(body) }),
  /** Declare a Coursera course taken outside the organisation's programmes —
   *  the only way such a course can reach the platform, because the enterprise
   *  report never carries it. The catalogue fills in title and hours. */
  declareCourseraCourse: (body: {
    learner_id: number;
    course_url: string;
    certificate_url?: string;
    completed_on?: string;
  }) =>
    req<LearningRecord>("/learning/records/coursera", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteLearning: (recordId: number, learnerId: number) =>
    req<void>(`/learning/records/${recordId}?learner_id=${learnerId}`, { method: "DELETE" }),
  /** A team's declared learning, for the people allowed to verify it. */
  teamLearning: (teamId: number, viewerId: number) =>
    req<TeamLearningRecord[]>(`/learning/team?team_id=${teamId}&viewer_id=${viewerId}`),
  verifyLearning: (recordId: number, learnerId: number) =>
    req<{ verified: boolean; by: string }>(
      `/learning/records/${recordId}/verify?learner_id=${learnerId}`,
      { method: "POST" },
    ),

  // approvals
  approvalInbox: (learnerId: number) =>
    req<ApprovalInbox>(`/approvals/inbox?learner_id=${learnerId}`),
  myApprovals: (learnerId: number) =>
    req<MyApprovals>(`/approvals/mine?learner_id=${learnerId}`),
  decideApproval: (
    kind: ApprovalKind,
    itemId: number,
    body: { learner_id: number; decision: "approved" | "declined"; note?: string },
  ) =>
    req<{ status: string; decided_by: string }>(`/approvals/${kind}/${itemId}/decide`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requestTraining: (body: {
    learner_id: number; formation_id?: number | null; course_id?: number | null; reason?: string;
  }) => req<ApprovalItem>("/approvals/requests", { method: "POST", body: JSON.stringify(body) }),
  withdrawRequest: (requestId: number, learnerId: number) =>
    req<void>(`/approvals/requests/${requestId}?learner_id=${learnerId}`, { method: "DELETE" }),

  // HR lead
  hrPerimeters: (learnerId?: number) =>
    req<HrPerimeters>(`/analytics/hr/perimeters${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),
  setHrPerimeter: (body: { hr_handle: string; bus: string[]; learner_id?: number }) =>
    req<{ handle: string; bus: string[] }>("/analytics/hr/perimeters", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),

  // pathways
  listPathways: (learnerId?: number) =>
    req<Pathway[]>(`/pathways${learnerId ? `?learner_id=${learnerId}` : ""}`),
  createPathway: (body: unknown) =>
    req<Pathway>("/pathways", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) }),
  updatePathway: (id: number, body: unknown) =>
    req<Pathway>(`/pathways/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  deletePathway: (id: number, learnerId?: number) =>
    req<void>(`/pathways/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  enrollPathway: (id: number, learnerId: number) =>
    req<{ enrolled: boolean }>(`/pathways/${id}/enroll`, {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId }),
    }),
  assignPathway: (id: number, body: { member_ids?: number[]; team_id?: number | null; due_date?: string | null; mandatory?: boolean; learner_id?: number }) =>
    req<{ assigned: string[]; skipped: { handle: string; reason: string }[] }>(`/pathways/${id}/assign`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),

  // account / settings
  /** `learnerId` is only consulted in demo mode: once SSO is configured the
   *  server overwrites it from the bearer token and ignores what we send. */
  account: (learnerId?: number | null) =>
    req<Account>(`/account${learnerId ? `?learner_id=${learnerId}` : ""}`),

  updateAccount: (
    patch: { name?: string; locale?: "fr" | "en"; weekly_goal_min?: number },
    learnerId?: number | null,
  ) =>
    req<Account>(`/account${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  accountSession: (learnerId?: number | null) =>
    req<SessionInfo>(`/account/session${learnerId ? `?learner_id=${learnerId}` : ""}`),

  /** Remember the viewer's language so their emails match the UI they chose. */
  setLocale: (learnerId: number, locale: "fr" | "en") =>
    req<Learner>(`/learners/${learnerId}/locale`, {
      method: "POST",
      body: JSON.stringify({ locale }),
    }),

  // onboarding
  onboardingOptions: () =>
    req<{
      roles: OnboardingRole[];
      goals: OnboardingGoal[];
      skills: { id: number; name: string; category: string; description: string }[];
    }>("/onboarding/options"),
  // L&D console — the same wizard, retired entries included, plus writes.
  onboardingConfig: (learnerId?: number) =>
    req<{
      roles: OnboardingRole[];
      goals: OnboardingGoal[];
      skills: { id: number; name: string; category: string }[];
    }>(`/onboarding/config${learnerId ? `?learner_id=${learnerId}` : ""}`),
  saveOnboardingConfig: (
    body: { roles: OnboardingRoleIn[]; goals: OnboardingGoalIn[] },
    learnerId?: number,
  ) =>
    req<{ roles: OnboardingRole[]; goals: OnboardingGoal[] }>(
      `/onboarding/config${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  completeOnboarding: (body: { learner_id: number; role_focus: string; skill_ids: number[]; goal_min: number }) =>
    req<{
      message: string;
      pathways: { id: number; title: string; emoji: string; summary: string; matched_steps: number }[];
      trainings: { id: number; title: string; emoji: string; summary: string; level: string }[];
    }>("/onboarding/complete", { method: "POST", body: JSON.stringify(body) }),

  // for-you feed + goal
  myFeed: (learnerId: number) => req<MyFeed>(`/feed/me?learner_id=${learnerId}`),
  /** What this person has been assigned — courses, trainings and pathways in
   *  one list, soonest deadline first. Feeds the catalogue pages' mandatory
   *  pinning and filter. */
  myAssignments: (learnerId: number) =>
    req<{ items: import("@/lib/mandatory").Assigned[] }>(
      `/assignments/mine?learner_id=${learnerId}`,
    ),
  setGoal: (learnerId: number, minutes: number) =>
    req<{ weekly_goal_min: number }>("/feed/goal", {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, minutes }),
    }),

  // HR analytics
  /** Absolute URL — the browser downloads the workbook/PDF directly. */
  /** `source` follows the switch on screen, so the file says the same thing
   *  the page does — an AIDA export must not quote Coursera hours. */
  hrExportUrl: (fmt: "xlsx" | "pdf", source: "app" | "coursera" | "both", learnerId?: number) =>
    `${API_BASE}/analytics/hr/export?fmt=${fmt}&source=${source}${learnerId ? `&learner_id=${learnerId}` : ""}`,
  hrAnalytics: (learnerId?: number) =>
    req<HrAnalytics>(`/analytics/hr${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),
  hrOrgChart: (learnerId?: number) =>
    req<OrgChart>(`/analytics/hr/org-chart${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),

  // ---- reporting ---------------------------------------------------------
  // `datasets` is already taken by the Studio's own connections, so the report
  // builder's methods carry a prefix rather than shadowing it.
  reportDatasets: (learnerId?: number) =>
    req<{ datasets: DatasetSummary[]; scope: string }>(
      `/reports/datasets${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  deleteDataset: (id: number, learnerId?: number) =>
    req<void>(`/reports/datasets/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  runReportQuery: (datasetId: number, body: Record<string, unknown>) =>
    req<QueryResult>(`/reports/datasets/${datasetId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  columnValues: (datasetId: number, column: string, learnerId?: number) =>
    req<{ column: string; values: (string | number)[]; truncated: boolean }>(
      `/reports/datasets/${datasetId}/values?column=${encodeURIComponent(column)}${
        learnerId ? `&learner_id=${learnerId}` : ""
      }`,
      { headers: adminHeaders() },
    ),
  savedViews: (learnerId?: number, datasetId?: number) =>
    req<{ views: SavedViewOut[] }>(
      `/reports/views?${new URLSearchParams({
        ...(learnerId ? { learner_id: String(learnerId) } : {}),
        ...(datasetId ? { dataset_id: String(datasetId) } : {}),
      })}`,
      { headers: adminHeaders() },
    ),
  saveReportView: (body: Record<string, unknown>) =>
    req<{ id: number; name: string; shared: boolean }>("/reports/views", {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  deleteReportView: (id: number, learnerId?: number) =>
    req<void>(`/reports/views/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  /** Absolute URL is not enough here — the query lives in the POST body, so
   *  the download is fetched and handed to the browser as a blob. */
  exportReport: async (datasetId: number, body: Record<string, unknown>) => {
    const res = await fetch(`${API_BASE}/reports/datasets/${datasetId}/export`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...adminHeaders() },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
    const blob = await res.blob();
    const name =
      res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `aida-rapport.${body.fmt === "pdf" ? "pdf" : "xlsx"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
  markViewOpened: (id: number) =>
    req<void>(`/reports/views/${id}/opened`, { method: "POST" }),

  // ---- governance (L&D / admin only) -------------------------------------
  govOverview: (learnerId?: number) =>
    req<GovOverview>(
      `/governance/overview${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  govPeople: (learnerId?: number, filters: { q?: string; bu?: string; role?: string } = {}) =>
    req<{ people: GovDirectoryPerson[]; count: number }>(
      `/governance/people?${new URLSearchParams({
        ...(learnerId ? { learner_id: String(learnerId) } : {}),
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.bu ? { bu: filters.bu } : {}),
        ...(filters.role ? { role: filters.role } : {}),
      })}`,
      { headers: adminHeaders() },
    ),
  govCreateBu: (body: Record<string, unknown>) =>
    req<{ id: number; name: string }>("/governance/bus", {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govUpdateBu: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; name: string; people_moved: number }>(`/governance/bus/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govCreatePractice: (body: { learner_id?: number; bu_id: number; name: string; description?: string }) =>
    req<{ id: number; name: string }>("/governance/practices", {
      method: "POST", headers: adminHeaders(), body: JSON.stringify(body),
    }),
  govUpdatePractice: (
    practiceId: number,
    body: { learner_id?: number; name?: string; position?: number; archived?: boolean },
  ) =>
    req<{ id: number; name: string; people_moved: number }>(`/governance/practices/${practiceId}`, {
      method: "PATCH", headers: adminHeaders(), body: JSON.stringify(body),
    }),
  govArchivePractice: (practiceId: number, learnerId?: number) =>
    req<void>(
      `/governance/practices/${practiceId}${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "DELETE", headers: adminHeaders() },
    ),
  govArchiveBu: (id: number, learnerId?: number) =>
    req<void>(`/governance/bus/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  govReorderBus: (body: Record<string, unknown>) =>
    req<{ ordered: number }>("/governance/bus/reorder", {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govSetHead: (buId: number, body: Record<string, unknown>) =>
    req<{ bu: string; head: GovPerson | null }>(`/governance/bus/${buId}/head`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govSetHrbps: (buId: number, body: Record<string, unknown>) =>
    req<{ bu: string; hrbps: GovPerson[] }>(`/governance/bus/${buId}/hrbps`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govCreateTeam: (body: Record<string, unknown>) =>
    req<{ id: number; name: string }>("/governance/teams", {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govUpdateTeam: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; name: string }>(`/governance/teams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govDeleteTeam: (id: number, learnerId?: number) =>
    req<void>(`/governance/teams/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  govUpdatePerson: (id: number, body: Record<string, unknown>) =>
    req<Record<string, unknown>>(`/governance/people/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govInvite: (body: Record<string, unknown>) =>
    req<{
      id: number;
      handle: string;
      name: string;
      pathways: { id: number; title: string }[];
      emailed: boolean;
      email_configured: boolean;
    }>("/governance/invitations", {
      method: "POST",
      body: JSON.stringify(body),
      headers: adminHeaders(),
    }),
  govInvitePreview: (bu: string, learnerId?: number) =>
    req<{ bu: string; pathways: { id: number; title: string; mandatory: boolean }[] }>(
      `/governance/invitations/preview?bu=${encodeURIComponent(bu)}${
        learnerId ? `&learner_id=${learnerId}` : ""
      }`,
      { headers: adminHeaders() },
    ),

  // notifications
  notifications: (learnerId: number) =>
    req<NotificationList>(`/notifications?learner_id=${learnerId}`),
  markNotificationsRead: (learnerId: number, ids?: number[]) =>
    req<{ marked: number }>("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ learner_id: learnerId, ids: ids ?? [] }),
    }),

  teamDashboard: (id: number, learnerId?: number) =>
    req<TeamDashboard>(`/teams/${id}/dashboard${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),

  // certifications
  listCertifications: (q?: string) =>
    req<Certification[]>(`/certifications${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  addCertification: (body: unknown) =>
    req<Certification>("/certifications", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  deleteCertification: (id: number, learnerId?: number) =>
    req<void>(`/certifications/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  certSuggestions: (learnerId?: number, teamId?: number) => {
    const p = new URLSearchParams();
    if (learnerId) p.set("learner_id", String(learnerId));
    if (teamId) p.set("team_id", String(teamId));
    const qs = p.toString();
    return req<CertSuggestion[]>(`/certifications/suggestions${qs ? `?${qs}` : ""}`);
  },
  suggestCertification: (
    certId: number,
    opts: { teamId?: number | null; targetIds?: number[]; note?: string },
    learnerId?: number,
  ) =>
    req<{ created: string[]; skipped: { target: string; reason: string }[] }>(
      `/certifications/${certId}/suggest`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          team_id: opts.teamId ?? null,
          target_ids: opts.targetIds ?? [],
          note: opts.note ?? "",
          learner_id: learnerId,
        }),
      },
    ),
  withdrawCertSuggestion: (id: number, learnerId?: number) =>
    req<void>(`/certifications/suggestions/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  // Follow-up for managers, BU heads, HR and L&D — scoped on the server.
  certExpiring: (learnerId?: number, days = 60) =>
    req<{ scope: string; org_wide: boolean; items: EarnedCertificate[] }>(
      `/certifications/expiring?days=${days}${learnerId ? `&learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  certCompliance: (learnerId?: number) =>
    req<{ scope: string; org_wide: boolean; certifications: ComplianceRow[] }>(
      `/certifications/compliance${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  /** Everything this learner has done, from every source. */
  myHistory: (learnerId: number) =>
    req<HistoryResponse>(`/history?learner_id=${learnerId}`),
  certFeed: (teamId?: number) =>
    req<EarnedCertificate[]>(`/certifications/feed${teamId ? `?team_id=${teamId}` : ""}`),
  shareCertificate: (body: unknown) =>
    req<EarnedCertificate>("/certifications/earned", { method: "POST", body: JSON.stringify(body) }),
  deleteEarnedCertificate: (id: number, learnerId?: number) =>
    req<void>(`/certifications/earned/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  uploadCertificateFile: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/certifications/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(d.detail || "Upload failed");
    }
    return res.json() as Promise<{ file_name: string; file_original_name: string }>;
  },
  certificateFileUrl: (id: number) => `/api/certifications/earned/${id}/file`,

  // challenges
  listChallenges: (status?: string) =>
    req<ChallengeSummary[]>(`/challenges${status ? `?status=${status}` : ""}`),
  getChallenge: (id: number) => req<ChallengeDetail>(`/challenges/${id}`),
  updateChallenge: (id: number, body: unknown) =>
    req<ChallengeSummary>(`/challenges/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  createChallenge: (body: unknown) =>
    req<ChallengeSummary>("/challenges", { method: "POST", body: JSON.stringify(body) }),
  deleteChallenge: (id: number, learnerId?: number) =>
    req<void>(`/challenges/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  setChallengeStatus: (id: number, status: string, learnerId?: number) =>
    req<{ status: string }>(
      `/challenges/${id}/status?status=${status}${learnerId ? `&learner_id=${learnerId}` : ""}`,
      { method: "POST", headers: adminHeaders() },
    ),
  submitToChallenge: (id: number, body: unknown) =>
    req<Submission>(`/challenges/${id}/submissions`, { method: "POST", body: JSON.stringify(body) }),
  voteSubmission: (submissionId: number, learnerId: number) =>
    req<{ votes: number; voted: boolean }>(
      `/submissions/${submissionId}/vote?learner_id=${learnerId}`,
      { method: "POST" },
    ),
  deleteSubmission: (id: number, learnerId?: number) =>
    req<void>(`/submissions/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),

  // sharing sessions
  listSessions: (q?: string) =>
    req<SharingSummary[]>(`/sharing${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getSession: (id: number) => req<SharingSession>(`/sharing/${id}`),
  updateSession: (id: number, body: unknown) =>
    req<SharingSession>(`/sharing/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  createSession: (body: unknown) =>
    req<SharingSession>("/sharing", { method: "POST", body: JSON.stringify(body) }),
  deleteSession: (id: number, learnerId?: number) =>
    req<void>(`/sharing/${id}${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  uploadDeck: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/sharing/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(d.detail || "Upload failed");
    }
    return res.json() as Promise<{ file_name: string; file_original_name: string }>;
  },
  deckUrl: (id: number) => `/api/sharing/${id}/deck`,
  deckViewUrl: (id: number) => `/api/sharing/${id}/deck?view=1`,

  // admin
  adminAuth: () => req<{ ok: boolean; protected: boolean }>("/admin/auth", { headers: adminHeaders() }),
  adminStats: () => req<AdminStats>("/admin/stats", { headers: adminHeaders() }),
  // Coursera — catalogue import (no credentials) and enterprise sync.
  courseraStatus: () => req<CourseraStatus>("/admin/coursera/status", { headers: adminHeaders() }),
  /** Browse the public catalogue. `q` is matched by our backend over the pages
   *  it pulls: Coursera's catalogue API has no server-side search. */
  courseraCatalog: (q: string, start = 0, limit = 24, pages = 4) =>
    req<CourseraCatalogPage>(
      `/admin/coursera/catalog?q=${encodeURIComponent(q)}&start=${start}&limit=${limit}&pages=${pages}`,
      { headers: adminHeaders() },
    ),
  courseraLookup: (slug: string) =>
    req<CourseraLookup>(`/admin/coursera/lookup?slug=${encodeURIComponent(slug)}`, {
      headers: adminHeaders(),
    }),
  courseraImport: (slugs: string[], publish = true) =>
    req<{ imported: string[]; updated: string[]; not_found: string[] }>("/admin/coursera/import", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ slugs, publish }),
    }),
  // Coursera reporting — see backend routes/coursera_analytics.py.
  courseraOverview: (learnerId?: number) =>
    req<CourseraOverview>(
      `/analytics/coursera/overview${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { headers: adminHeaders() },
    ),
  courseraLearners: (query: CourseraLearnerQuery, learnerId?: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    if (learnerId) params.set("learner_id", String(learnerId));
    return req<{
      total: number;
      items: CourseraPerson[];
      programs: string[];
      business_units: string[];
    }>(`/analytics/coursera/learners?${params}`, { headers: adminHeaders() });
  },
  /** One person over a calendar range. `period` shortcuts still work on the
   *  API, but the UI always sends dates. */
  courseraPerson: (email: string, range: { start: string; end: string }, learnerId?: number) => {
    // No dates means the whole record, so empty ones are left off entirely.
    const query = new URLSearchParams({ email });
    if (range.start && range.end) {
      query.set("start", range.start);
      query.set("end", range.end);
    }
    if (learnerId) query.set("learner_id", String(learnerId));
    return req<unknown>(`/analytics/coursera/person?${query}`, { headers: adminHeaders() });
  },
  courseraLink: (who: string, courseraEmail: string) =>
    req<{
      handle: string;
      enrollments: number;
      certificates_recorded: number;
      xp: { granted: number; total_now: number; formula: string };
    }>("/admin/coursera/link", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ who, coursera_email: courseraEmail }),
    }),
  courseraReport: (locale: string, learnerId?: number) =>
    req<{ markdown: string; generated_by: string; findings: string[] }>(
      `/analytics/coursera/report?locale=${locale}${learnerId ? `&learner_id=${learnerId}` : ""}`,
      { method: "POST", headers: adminHeaders() },
    ),
  courseraImportEnrolled: (limit = 25) =>
    req<{ considered: number; imported: string[]; updated: string[]; not_found: string[] }>(
      `/admin/coursera/import-enrolled?limit=${limit}`,
      { method: "POST", headers: adminHeaders() },
    ),
  courseraSync: () =>
    req<CourseraSyncResult>("/admin/coursera/sync", { method: "POST", headers: adminHeaders() }),
  adminListLabs: () => req<AdminLabRow[]>("/admin/labs", { headers: adminHeaders() }),
  adminGetLab: (id: string) =>
    req<{ definition: LabDefinition; published: boolean; source: string }>(`/admin/labs/${id}`, {
      headers: adminHeaders(),
    }),
  adminValidate: (definition: LabDefinition) =>
    req<{ ok: boolean }>("/admin/labs/validate", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ definition, published: true }),
    }),
  adminCreateLab: (definition: LabDefinition, published: boolean) =>
    req<{ id: string }>("/admin/labs", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ definition, published }),
    }),
  adminUpdateLab: (id: string, definition: LabDefinition, published: boolean) =>
    req<{ id: string }>(`/admin/labs/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition, published }),
    }),
  adminDeleteLab: (id: string) =>
    req<void>(`/admin/labs/${id}`, { method: "DELETE", headers: adminHeaders() }),
  adminReloadFiles: () =>
    req<{ loaded: number }>("/admin/labs/reload-files", { method: "POST", headers: adminHeaders() }),
  adminListLearners: (learnerId?: number) =>
    req<AdminLearnerRow[]>(`/admin/learners${learnerId ? `?learner_id=${learnerId}` : ""}`, {
      headers: adminHeaders(),
    }),
  adminSetRole: (id: number, role: LearnerRole) =>
    req<{ id: number; handle: string; role: LearnerRole }>(
      `/admin/learners/${id}/role?role=${role}`,
      { method: "PUT", headers: adminHeaders() },
    ),
  adminSetProfile: (id: number, body: LearnerOrgFields, learnerId?: number) =>
    req<AdminLearnerRow & LearnerOrgFields>(
      `/admin/learners/${id}/profile${learnerId ? `?learner_id=${learnerId}` : ""}`,
      { method: "PUT", headers: adminHeaders(), body: JSON.stringify(body) },
    ),
  adminDeleteLearner: (id: number) =>
    req<void>(`/admin/learners/${id}`, { method: "DELETE", headers: adminHeaders() }),
  adminRunDigest: (days = 7) =>
    req<{ sent: number; skipped_no_activity: number; skipped_no_email: number; mail_enabled: boolean }>(
      `/admin/digest/run?days=${days}`,
      { method: "POST", headers: adminHeaders() },
    ),
  updateAsset: (assetId: number, learnerId: number, body: Partial<AssetSummary & { body_md: string; code: string | null; link: string | null }>) =>
  req<Asset>(`/assets/${assetId}`, {
    method: "PUT",
    body: JSON.stringify({ ...body, learner_id: learnerId }),
  }),  
};
