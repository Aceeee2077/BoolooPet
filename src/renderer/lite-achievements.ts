// ============================================================================
// Achievements and badges — the pet's trophy shelf.
//
// The catalogue is deliberately data, not code: every badge names a metric and a
// target, and both the pet that awards it and the settings panel that draws it
// read the same table. Nothing here talks to the DOM or to Tauri; the pet window
// owns the unlocked dates and lifetime counters in the config (see
// `AchievementState` in src/shared/types.ts), while the settings panel only
// renders the view this file computes.
//
// A global script like lite-affinity.ts / lite-summary.ts: loaded after lite-day.ts
// so the streak and day-count helpers can use the same local calendar as the
// heatmap, and before the page scripts that call it.
// ============================================================================

type AchievementCategory = 'interaction' | 'affinity' | 'companion' | 'care';

/**
 * What a badge is measured against.
 *
 * The first five come from numbers the pet already keeps. Everything else is a
 * lifetime counter in `AchievementState.counters` — a tap at night is not a
 * click total, and one day's heatmap square cannot answer "has this ever
 * happened?".
 */
type AchievementMetric =
  | 'clicks'
  | 'bestDayClicks'
  | 'affinity'
  | 'days'
  | 'streak'
  | 'doubleTaps'
  | 'pets'
  | 'holds'
  | 'fileDrops'
  | 'feeds'
  | 'toyCatches'
  | 'healths'
  | 'nightTaps'
  | 'earlyTaps';

/** The event metrics, i.e. the keys a counter bump may name. */
type AchievementCounter = Exclude<
  AchievementMetric,
  'clicks' | 'bestDayClicks' | 'affinity' | 'days' | 'streak'
>;

interface AchievementDefinition {
  /** Stable id; also the key in `AchievementState.unlocked`. Never rename one. */
  id: string;
  category: AchievementCategory;
  /** Badge art is one emoji, so it renders without another asset bundle. */
  icon: string;
  /** The value that unlocks it. */
  target: number;
  metric: AchievementMetric;
  /** Literal dictionary keys: verify-surface needs to see both of them. */
  nameKey: string;
  descKey: string;
  categoryKey: string;
}

/** Everything a badge can be measured against at one moment. */
interface AchievementContext {
  clicks: number;
  bestDayClicks: number;
  affinity: number;
  /** Distinct local days on which the pet was actually used. */
  days: number;
  /** Longest run of consecutive days together (not necessarily ending today). */
  streak: number;
  counters: Record<string, number>;
}

/** The pet window supplies live values while its writes are still buffered. */
interface AchievementOverrides {
  clicks?: number;
  bestDayClicks?: number;
  affinity?: number;
  days?: number;
  streak?: number;
  counters?: Record<string, number>;
}

/** One row on the badge wall. */
interface AchievementViewItem {
  definition: AchievementDefinition;
  value: number;
  target: number;
  /** 0..1, clamped. A reached target is always full even if not persisted yet. */
  progress: number;
  /** True only when the id is in the persisted shelf. */
  unlocked: boolean;
  /** Local day earned, or null while locked. */
  unlockedAt: string | null;
}

/**
 * The whole catalogue, in display order.
 *
 * Thresholds are intentionally spread out: a new install earns the first badge
 * on its first tap, the middle of the shelf takes weeks of ordinary use, and the
 * last few reward the people who keep the pet around for months.
 */
const ACHIEVEMENTS: AchievementDefinition[] = [
  // Interaction
  {
    id: 'first_click', category: 'interaction', icon: '🐾', target: 1, metric: 'clicks',
    nameKey: 'achievement.first_click.name', descKey: 'achievement.first_click.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'clicks_100', category: 'interaction', icon: '👆', target: 100, metric: 'clicks',
    nameKey: 'achievement.clicks_100.name', descKey: 'achievement.clicks_100.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'clicks_1000', category: 'interaction', icon: '🖱️', target: 1000, metric: 'clicks',
    nameKey: 'achievement.clicks_1000.name', descKey: 'achievement.clicks_1000.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'busy_day', category: 'interaction', icon: '🔥', target: 50, metric: 'bestDayClicks',
    nameKey: 'achievement.busy_day.name', descKey: 'achievement.busy_day.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'double_tap', category: 'interaction', icon: '✌️', target: 1, metric: 'doubleTaps',
    nameKey: 'achievement.double_tap.name', descKey: 'achievement.double_tap.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'gentle_pat', category: 'interaction', icon: '💛', target: 1, metric: 'pets',
    nameKey: 'achievement.gentle_pat.name', descKey: 'achievement.gentle_pat.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'patient_hold', category: 'interaction', icon: '🫶', target: 1, metric: 'holds',
    nameKey: 'achievement.patient_hold.name', descKey: 'achievement.patient_hold.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'night_owl', category: 'interaction', icon: '🌙', target: 1, metric: 'nightTaps',
    nameKey: 'achievement.night_owl.name', descKey: 'achievement.night_owl.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'early_bird', category: 'interaction', icon: '🌅', target: 1, metric: 'earlyTaps',
    nameKey: 'achievement.early_bird.name', descKey: 'achievement.early_bird.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },
  {
    id: 'file_gift', category: 'interaction', icon: '🎁', target: 1, metric: 'fileDrops',
    nameKey: 'achievement.file_gift.name', descKey: 'achievement.file_gift.desc',
    categoryKey: 'lite.achievements.category.interaction',
  },

  // Affinity — the same five levels the status bar draws.
  {
    id: 'affinity_60', category: 'affinity', icon: '💞', target: 60, metric: 'affinity',
    nameKey: 'achievement.affinity_60.name', descKey: 'achievement.affinity_60.desc',
    categoryKey: 'lite.achievements.category.affinity',
  },
  {
    id: 'affinity_200', category: 'affinity', icon: '🤝', target: 200, metric: 'affinity',
    nameKey: 'achievement.affinity_200.name', descKey: 'achievement.affinity_200.desc',
    categoryKey: 'lite.achievements.category.affinity',
  },
  {
    id: 'affinity_500', category: 'affinity', icon: '🏅', target: 500, metric: 'affinity',
    nameKey: 'achievement.affinity_500.name', descKey: 'achievement.affinity_500.desc',
    categoryKey: 'lite.achievements.category.affinity',
  },
  {
    id: 'affinity_1000', category: 'affinity', icon: '👑', target: 1000, metric: 'affinity',
    nameKey: 'achievement.affinity_1000.name', descKey: 'achievement.affinity_1000.desc',
    categoryKey: 'lite.achievements.category.affinity',
  },

  // Company
  {
    id: 'days_7', category: 'companion', icon: '📅', target: 7, metric: 'days',
    nameKey: 'achievement.days_7.name', descKey: 'achievement.days_7.desc',
    categoryKey: 'lite.achievements.category.companion',
  },
  {
    id: 'days_30', category: 'companion', icon: '🗓️', target: 30, metric: 'days',
    nameKey: 'achievement.days_30.name', descKey: 'achievement.days_30.desc',
    categoryKey: 'lite.achievements.category.companion',
  },
  {
    id: 'days_100', category: 'companion', icon: '🏡', target: 100, metric: 'days',
    nameKey: 'achievement.days_100.name', descKey: 'achievement.days_100.desc',
    categoryKey: 'lite.achievements.category.companion',
  },
  {
    id: 'streak_7', category: 'companion', icon: '🔗', target: 7, metric: 'streak',
    nameKey: 'achievement.streak_7.name', descKey: 'achievement.streak_7.desc',
    categoryKey: 'lite.achievements.category.companion',
  },

  // Care
  {
    id: 'first_feed', category: 'care', icon: '🍪', target: 1, metric: 'feeds',
    nameKey: 'achievement.first_feed.name', descKey: 'achievement.first_feed.desc',
    categoryKey: 'lite.achievements.category.care',
  },
  {
    id: 'feeder_10', category: 'care', icon: '🥣', target: 10, metric: 'feeds',
    nameKey: 'achievement.feeder_10.name', descKey: 'achievement.feeder_10.desc',
    categoryKey: 'lite.achievements.category.care',
  },
  {
    id: 'play_10', category: 'care', icon: '🪶', target: 10, metric: 'toyCatches',
    nameKey: 'achievement.play_10.name', descKey: 'achievement.play_10.desc',
    categoryKey: 'lite.achievements.category.care',
  },
  {
    id: 'health_10', category: 'care', icon: '💧', target: 10, metric: 'healths',
    nameKey: 'achievement.health_10.name', descKey: 'achievement.health_10.desc',
    categoryKey: 'lite.achievements.category.care',
  },
];

/** Every badge, newest array untouched by callers. */
function achievementDefinitions(): AchievementDefinition[] {
  return ACHIEVEMENTS.slice();
}

/** A finite, non-negative whole number, or the fallback. */
function achievementCount(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

/** The saved shelf, with malformed entries dropped instead of trusted. */
function achievementState(cfg: AppConfig | null | undefined): AchievementState {
  const state: AchievementState = { unlocked: {}, counters: {} };
  const saved = cfg?.achievements;
  if (saved?.unlocked && typeof saved.unlocked === 'object') {
    for (const [id, day] of Object.entries(saved.unlocked)) {
      if (typeof id === 'string' && typeof day === 'string' && day) state.unlocked[id] = day;
    }
  }
  if (saved?.counters && typeof saved.counters === 'object') {
    for (const [id, value] of Object.entries(saved.counters)) {
      if (typeof id === 'string') state.counters[id] = achievementCount(value);
    }
  }
  return state;
}

/** The longest run of consecutive local days in a sorted day list. */
function achievementLongestStreak(days: string[]): number {
  const unique = [...new Set(days.filter(day => typeof day === 'string' && liteDayStart(day) !== null))].sort();
  let best = 0;
  let run = 0;
  let previous = '';
  for (const day of unique) {
    run = previous && liteDayDiff(previous, day) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/**
 * Read every metric out of the config once.
 *
 * The pet passes overrides for the values it has not written yet (a burst of
 * clicks is flushed every few seconds); the settings panel simply reads the
 * config as it stands.
 */
function achievementContext(cfg: AppConfig | null | undefined, overrides: AchievementOverrides = {}): AchievementContext {
  const stats = cfg?.dailyStats ?? {};
  let bestDayClicks = 0;
  for (const entry of Object.values(stats)) {
    if (!entry || typeof entry !== 'object') continue;
    bestDayClicks = Math.max(bestDayClicks, achievementCount(entry.clicks));
  }
  const days = [...new Set((Array.isArray(cfg?.statsDays) ? cfg.statsDays : [])
    .filter(day => typeof day === 'string' && liteDayStart(day) !== null))];
  const saved = achievementState(cfg);
  const pick = (value: number | undefined, fallback: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
  return {
    clicks: pick(overrides.clicks, achievementCount(cfg?.statsClicks)),
    bestDayClicks: pick(overrides.bestDayClicks, bestDayClicks),
    affinity: pick(overrides.affinity, achievementCount(cfg?.affinity)),
    days: pick(overrides.days, days.length),
    streak: pick(overrides.streak, achievementLongestStreak(days)),
    counters: overrides.counters ? { ...overrides.counters } : saved.counters,
  };
}

/** The number a badge is currently measured against. */
function achievementValue(context: AchievementContext, metric: AchievementMetric): number {
  switch (metric) {
    case 'clicks': return context.clicks;
    case 'bestDayClicks': return context.bestDayClicks;
    case 'affinity': return context.affinity;
    case 'days': return context.days;
    case 'streak': return context.streak;
    default: return achievementCount(context.counters[metric]);
  }
}

/** A copy of the shelf with one lifetime counter raised. */
function achievementStateWithCounter(
  state: AchievementState,
  counter: AchievementCounter,
  by = 1,
): AchievementState {
  const counters = { ...state.counters };
  counters[counter] = achievementCount(counters[counter]) + achievementCount(by);
  return { unlocked: { ...state.unlocked }, counters };
}

/**
 * Mark badges earned, leaving the first date intact when one is already there.
 *
 * The pet calls this only for ids it has just found, but an id can arrive twice
 * when two events land in one batch; the date of the first award is the honest
 * one, so it wins.
 */
function achievementStateWithUnlocks(
  state: AchievementState,
  ids: string[],
  day: string,
): AchievementState {
  const unlocked = { ...state.unlocked };
  for (const id of ids) {
    if (typeof id === 'string' && id && !unlocked[id]) unlocked[id] = day;
  }
  return { unlocked, counters: { ...state.counters } };
}

/** Every badge that is due but not on the shelf yet. */
function achievementFresh(
  cfg: AppConfig | null | undefined,
  context: AchievementContext = achievementContext(cfg),
  state: AchievementState = achievementState(cfg),
): AchievementDefinition[] {
  return ACHIEVEMENTS.filter(definition =>
    !state.unlocked[definition.id] &&
    achievementValue(context, definition.metric) >= definition.target);
}

/** The badge wall: every definition with its progress and saved date. */
function achievementView(
  cfg: AppConfig | null | undefined,
  context: AchievementContext = achievementContext(cfg),
): AchievementViewItem[] {
  const state = achievementState(cfg);
  return ACHIEVEMENTS.map(definition => {
    const value = achievementValue(context, definition.metric);
    const unlockedAt = state.unlocked[definition.id] ?? null;
    return {
      definition,
      value,
      target: definition.target,
      progress: Math.max(0, Math.min(1, value / definition.target)),
      unlocked: unlockedAt !== null,
      unlockedAt,
    };
  });
}
