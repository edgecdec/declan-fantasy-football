import { SleeperDraft } from '@/services/sleeper/sleeperService';

/**
 * Ordering and formatting for a list of drafts, keyed on when they start.
 *
 * `SleeperDraft.start_time` is epoch milliseconds and is the SCHEDULED start for a
 * draft that hasn't run yet — so it is genuinely useful for "what's coming up next" —
 * but it is frequently absent. On one real account 6 of 23 drafts for the season had
 * no time set, so "no date" is a normal case to render, not an error.
 */

/** Statuses whose draft is still ahead of us. */
export const YET_TO_DRAFT_STATUSES = new Set(['pre_draft', 'paused']);

/**
 * Primary sort key. A live draft is the most urgent thing on the page, then a paused
 * one, then whatever is scheduled next, and finished drafts last.
 */
const STATUS_ORDER: Record<string, number> = {
  drafting: 0,
  paused: 1,
  pre_draft: 2,
  complete: 3,
};

export function draftStatusRank(status: string): number {
  return STATUS_ORDER[status] ?? 99;
}

/**
 * Sorts drafts by status, then by start time within a status.
 *
 * Upcoming drafts go soonest-first, which is the whole point — the one you need to be
 * ready for is at the top. Finished drafts go most-recent-first instead, since for
 * those "latest" is the useful end. A draft with no scheduled time sorts after every
 * dated one in its group rather than being treated as time zero, which would park
 * undated leagues at the top and bury the draft actually happening tonight.
 */
export function compareDraftsBySchedule(a: SleeperDraft, b: SleeperDraft): number {
  const rank = draftStatusRank(a.status) - draftStatusRank(b.status);
  if (rank !== 0) return rank;

  const ta = a.start_time ?? null;
  const tb = b.start_time ?? null;

  if (ta === null && tb === null) {
    return (a.metadata?.name ?? '').localeCompare(b.metadata?.name ?? '');
  }
  if (ta === null) return 1;
  if (tb === null) return -1;

  return a.status === 'complete' ? tb - ta : ta - tb;
}

export type DraftTimeLabel = {
  /** Absolute local time, e.g. "Mon, Sep 8, 6:00 PM". */
  absolute: string;
  /** "in 3 days" / "tomorrow" / "2 hours ago". Null when it adds nothing. */
  relative: string | null;
  /** Starts within the next day — worth drawing the eye to. */
  imminent: boolean;
  /** Scheduled time has passed but the draft still hasn't started. */
  overdue: boolean;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Coarsest sensible unit, so we say "in 3 days" rather than "in 4,320 minutes". */
function relativeLabel(deltaMs: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(deltaMs);
  if (abs < MS_PER_HOUR) return rtf.format(Math.round(deltaMs / MS_PER_MINUTE), 'minute');
  if (abs < MS_PER_DAY) return rtf.format(Math.round(deltaMs / MS_PER_HOUR), 'hour');
  return rtf.format(Math.round(deltaMs / MS_PER_DAY), 'day');
}

/**
 * Formats a draft's start time for display, in the reader's own timezone.
 *
 * Returns null when there is no time to show, so a caller can render "no time set"
 * rather than a fake date. `now` is injectable to keep this testable.
 */
export function formatDraftTime(
  draft: SleeperDraft,
  now: number = Date.now(),
): DraftTimeLabel | null {
  const start = draft.start_time;
  if (start == null || !Number.isFinite(start) || start <= 0) return null;

  const date = new Date(start);
  const thisYear = new Date(now).getFullYear() === date.getFullYear();
  const absolute = date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: thisYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const delta = start - now;
  const done = draft.status === 'complete' || draft.status === 'drafting';

  return {
    absolute,
    // For a draft already run the date says it; a relative age only adds noise.
    relative: done ? null : relativeLabel(delta),
    imminent: !done && delta > 0 && delta <= MS_PER_DAY,
    overdue: !done && delta <= 0,
  };
}
