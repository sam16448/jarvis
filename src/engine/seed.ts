import type { Settings, State } from './types';

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const ALL = [0, 1, 2, 3, 4, 5, 6];

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    wake: '06:30',
    bedtime: '23:15',
    latestBedtime: '00:00',
    minSleepH: 6.5,
    bufferMin: 10,
    chunkMaxMin: 90,
    minChunkMin: 30,
    focusHours: [{ start: '06:30', end: '09:00' }, { start: '10:00', end: '12:30' }, { start: '19:00', end: '21:00' }],
    lowEnergy: [{ start: '16:00', end: '19:00' }, { start: '21:00', end: '23:59' }],
    durationDefaults: { assignment: 120, lab: 90, study: 90, examprep: 120, club: 60, course: 60, personal: 45 },
    template: [
      { id: 'study-am', label: 'Morning study', days: ALL, start: '06:45', end: '07:45', role: 'study' },
      { id: 'breakfast', label: 'Breakfast', days: ALL, start: '07:45', end: '08:10', role: 'meal' },
      { id: 'commute-am', label: 'Commute', days: WEEKDAYS, start: '08:15', end: '09:00', role: 'commute' },
      { id: 'college', label: 'College', days: WEEKDAYS, start: '09:00', end: '16:00', role: 'college' },
      { id: 'commute-pm', label: 'Commute', days: WEEKDAYS, start: '16:00', end: '16:45', role: 'commute' },
      { id: 'club', label: 'Club', days: WEEKDAYS, start: '16:45', end: '18:30', role: 'club' },
      { id: 'study-pm', label: 'Study slot', days: WEEKDAYS, start: '19:00', end: '20:00', role: 'study' },
      { id: 'dinner', label: 'Dinner', days: ALL, start: '20:00', end: '20:30', role: 'meal' },
      { id: 'assign-pm', label: 'Assignment slot', days: WEEKDAYS, start: '21:00', end: '22:00', role: 'assignment' },
      { id: 'study-we', label: 'Study slot', days: WEEKEND, start: '10:00', end: '12:30', role: 'study' },
      { id: 'lunch-we', label: 'Lunch', days: WEEKEND, start: '13:00', end: '13:45', role: 'meal' },
      { id: 'assign-we', label: 'Assignment slot', days: WEEKEND, start: '15:00', end: '17:00', role: 'assignment' },
    ],
    subjects: [
      { name: 'Maths', aliases: ['math', 'mathematics', 'calculus'], effort: 'hard' },
      { name: 'Physics', aliases: ['phy', 'phys'], effort: 'hard' },
      { name: 'Chemistry', aliases: ['chem'], effort: 'normal' },
      { name: 'Programming', aliases: ['coding', 'prog', 'c programming'], effort: 'hard' },
      { name: 'English', aliases: ['eng'], effort: 'light' },
      { name: 'History', aliases: ['hist'], effort: 'normal' },
    ],
    briefTime: '06:30',
    wrapupTime: '21:45',
    dailyWorkCapH: 6,
    llm: { provider: 'none', key: '', model: '' },
    voice: { enabled: true, voiceURI: '', rate: 1, address: 'boss', aiBriefs: true },
    weather: { place: '' },
  };
}

export function seedState(): State {
  return {
    tasks: [],
    events: [],
    series: [],
    exams: [], // add yours in the app ("Maths exam on Oct 28 10 to 12") or import a backup
    days: [],
    inbox: [],
    habits: [
      { id: 'h-water', name: 'Water', order: 0, log: {} },
      { id: 'h-gym', name: 'Gym', order: 1, log: {} },
      { id: 'h-meal', name: 'Meal prep', order: 2, log: {} },
    ],
    sleep: [],
    templates: [{
      id: 'tpl-exam-day', name: 'Exam-week day',
      items: [
        { title: 'Revision: hardest topic', type: 'study', start: '07:00', end: '08:30' },
        { title: 'Revision block', type: 'study', start: '09:30', end: '11:00' },
        { title: 'Practice problems', type: 'study', start: '14:00', end: '15:30' },
        { title: 'Past paper (timed)', type: 'study', start: '16:00', end: '17:30' },
        { title: 'Light review and notes', type: 'study', start: '21:00', end: '22:00' },
      ],
    }],
    settings: defaultSettings(),
  };
}
