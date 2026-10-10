export type TaskType = 'assignment' | 'lab' | 'study' | 'examprep' | 'club' | 'course' | 'personal';
export type ItemType = TaskType | 'exam' | 'routine' | 'block' | 'event';
export type Priority = 'critical' | 'high' | 'normal' | 'flexible';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';
export type Effort = 'hard' | 'light' | 'normal';
export type Status = 'planned' | 'done' | 'missed' | 'skipped';

export const TASK_TYPES: TaskType[] = ['assignment', 'lab', 'study', 'examprep', 'club', 'course', 'personal'];
export const TYPE_LABEL: Record<ItemType, string> = {
  assignment: 'Assignment', lab: 'Lab write-up', study: 'Study block', examprep: 'Exam prep',
  club: 'Club work', course: 'Course / program', personal: 'Personal', exam: 'Exam',
  routine: 'Routine', block: 'Blocked time', event: 'Event',
};

/** A piece of work that needs placing. */
export interface Task {
  id: string;
  title: string;
  subject?: string;
  type: TaskType;
  priority: Priority;
  estimateMin: number;
  doneMin: number;            // progress logged so far
  actualMin?: number;         // total real time once done
  earliestStart?: string;     // floating datetime
  deadline?: string;          // floating datetime
  splittable: boolean;
  preferredTime: TimeOfDay;
  effort: Effort;
  status: 'open' | 'done' | 'dropped';
  createdAt: string;
  doneAt?: string;
  notes?: string;
}

/** A concrete interval on the timeline. */
export interface Ev {
  id: string;
  title: string;
  type: ItemType;
  subject?: string;
  start: string;
  end: string;
  kind: 'fixed' | 'chunk' | 'block';  // chunk = scheduler-placed part of a Task
  taskId?: string;
  priority: Priority;
  status: Status;
  actualMin?: number;
  notes?: string;
}

export interface SeriesException {
  deleted?: boolean;
  start?: string; // HH:mm
  end?: string;
  status?: Status;
  actualMin?: number;
}

export interface Series {
  id: string;
  title: string;
  type: ItemType;
  subject?: string;
  startTime: string; // HH:mm
  endTime: string;
  freq: 'daily' | 'weekdays' | 'weekly' | 'days';
  days?: number[];   // 0=Sun..6, for 'days' and 'weekly'
  startDate: string;
  until?: string;
  count?: number;
  priority: Priority;
  exceptions: Record<string, SeriesException>;
}

export interface Exam {
  id: string;
  subject: string;
  title: string;
  start: string;
  end: string;
  targetHours: number;
}

export type SlotRole = 'college' | 'commute' | 'meal' | 'club' | 'study' | 'assignment' | 'other';
export interface TemplateSlot {
  id: string;
  label: string;
  days: number[];
  start: string;
  end: string;
  role: SlotRole;
}
/** Roles that are only hints for placement, not busy time. */
export const HINT_ROLES: SlotRole[] = ['study', 'assignment'];

/** Per-date overrides: tonight's bedtime and edits to template slots. */
export interface DayOverride {
  id: string; // date
  bedtime?: string; // HH:mm, overrides normal bedtime for this night (may exceed limits)
  slots: Record<string, { deleted?: boolean; start?: string; end?: string }>;
}

export interface InboxItem { id: string; text: string; createdAt: string; }
export interface Habit { id: string; name: string; order: number; log: Record<string, boolean>; }
export interface SleepLog { id: string; /* date of the night's evening */ bedtime: string; wake: string; }

export interface SavedTemplate {
  id: string;
  name: string;
  items: { title: string; type: ItemType; start: string; end: string; subject?: string }[];
}

export interface Range { start: string; end: string; }

export interface Subject { name: string; aliases: string[]; effort: Effort; }

export interface Settings {
  id: 'settings';
  wake: string;           // HH:mm
  bedtime: string;        // normal planning bedtime
  latestBedtime: string;  // hard cap
  minSleepH: number;
  bufferMin: number;
  chunkMaxMin: number;
  minChunkMin: number;
  focusHours: Range[];
  lowEnergy: Range[];
  durationDefaults: Record<TaskType, number>;
  template: TemplateSlot[];
  subjects: Subject[];
  briefTime: string;
  wrapupTime: string;
  dailyWorkCapH: number;  // more planned work than this in a day = overloaded
  llm: { provider: 'none' | 'gemini' | 'groq'; key: string; model: string };
}

export interface State {
  tasks: Task[];
  events: Ev[];
  series: Series[];
  exams: Exam[];
  days: DayOverride[];
  inbox: InboxItem[];
  habits: Habit[];
  sleep: SleepLog[];
  templates: SavedTemplate[];
  settings: Settings;
}

export type TableName = Exclude<keyof State, 'settings'> | 'settings';
export type Op =
  | { t: 'put'; table: TableName; row: { id: string } }
  | { t: 'del'; table: TableName; id: string };

/** A single computed timeline entry from any source. */
export interface Occ {
  key: string;
  source: 'event' | 'series' | 'template' | 'exam';
  id: string;           // source row id
  date: string;         // occurrence date
  s: number;
  e: number;
  title: string;
  type: ItemType;
  subject?: string;
  priority: Priority;
  busy: boolean;        // blocks placement
  hint?: SlotRole;      // study/assignment preferred slot
  role?: SlotRole;      // template role
  status: Status;
  kind?: Ev['kind'];
  taskId?: string;
}

// ---------- Interpreter output ----------
export type QueryKind = 'today' | 'next' | 'dueWeek' | 'studyLeft' | 'onTrack' | 'free' | 'day';

export type Command =
  | { kind: 'addTask'; title: string; subject?: string; type?: TaskType; due?: string; estimateMin?: number; priority?: Priority; preferredTime?: TimeOfDay; earliestStart?: string; splittable?: boolean }
  | { kind: 'addEvent'; title: string; type?: ItemType; subject?: string; start: string; end: string; priority?: Priority }
  | { kind: 'addSeries'; title: string; type?: ItemType; subject?: string; startTime: string; endTime: string; freq: Series['freq']; days?: number[]; startDate?: string; until?: string; count?: number }
  | { kind: 'blockTime'; title: string; start: string; end: string }
  | { kind: 'markDone'; target: string; ref?: string; date?: string; all?: boolean }
  | { kind: 'markNotDone'; target: string; ref?: string; date?: string }
  | { kind: 'logTime'; target?: string; minutes: number }
  | { kind: 'query'; q: QueryKind; subject?: string; date?: string }
  | { kind: 'move'; target: string; ref?: string; date?: string; timeOfDay?: TimeOfDay; start?: string; end?: string }
  | { kind: 'cancel'; target: string; ref?: string; date?: string; scope?: 'one' | 'series' }
  | { kind: 'setPriority'; target: string; ref?: string; priority: Priority }
  | { kind: 'shiftAll'; minutes: number; date?: string }
  | { kind: 'resolve'; option: 'a' | 'b' | 'c' | 'd' }
  | { kind: 'capture'; text: string }
  | { kind: 'panic' }
  | { kind: 'planStudy'; subject?: string }
  | { kind: 'editTask'; taskId: string; patch: Partial<Omit<Task, 'id'>> }
  | { kind: 'editEvent'; eventId: string; patch: Partial<Pick<Ev, 'title' | 'type' | 'subject' | 'priority' | 'notes'>> }
  | { kind: 'editSeries'; seriesId: string; patch: Partial<Omit<Series, 'id' | 'exceptions'>> }
  | { kind: 'applyTemplate'; templateId: string; date: string }
  | { kind: 'clarify'; question: string };

// ---------- Scheduler output ----------
export interface DiffLine {
  change: 'add' | 'remove' | 'move' | 'update';
  title: string;
  before?: string; // human text
  after?: string;
}

export interface ConflictOption {
  key: 'a' | 'b' | 'c' | 'd';
  label: string;
  detail: string;
  ops: Op[];          // applied on top of the base ops
  diff: DiffLine[];
  warnings: string[];
}

export interface Conflict {
  id: string;
  title: string;      // item at risk
  reason: string;
  options: ConflictOption[];
}

export interface Proposal {
  type: 'proposal';
  understood: string;
  ops: Op[];
  diff: DiffLine[];
  warnings: string[];
  conflicts: Conflict[];
  info?: string[];
}

export interface Answer {
  type: 'answer';
  title: string;
  lines: string[];
}

export interface Question {
  type: 'question';
  question: string;
  partial?: Command;
}

export type PlanResult = Proposal | Answer | Question;
