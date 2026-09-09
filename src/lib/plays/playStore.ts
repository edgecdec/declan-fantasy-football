import { getDb } from '@/lib/db';

/**
 * Storage for raw NFL plays.
 *
 * Plays are stored raw and scored on read. The same play must be re-scored in every league's
 * settings, and a league can change its scoring mid-season, so points are never persisted.
 */

export type StoredPlay = {
  playId: string;
  gameId: string;
  season: string;
  week: number;
  sequence: number | null;
  playTime: number | null;
  metadata: Record<string, unknown>;
  playStats: { player_id: string; stats: Record<string, number> }[];
  firstSeenAt: string;
};

export type RawPlay = {
  play_id: string;
  game_id?: string | null;
  sequence?: number | null;
  time?: number | null;
  metadata?: Record<string, unknown> | null;
  play_stats?: { player_id: string; stats: Record<string, number> | null }[] | null;
};

type Row = {
  play_id: string; game_id: string; season: string; week: number;
  sequence: number | null; play_time: number | null;
  metadata: string; play_stats: string; first_seen_at: string;
};

function toStored(r: Row): StoredPlay {
  const parse = <T>(s: string, fallback: T): T => {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    playId: r.play_id, gameId: r.game_id, season: r.season, week: r.week,
    sequence: r.sequence, playTime: r.play_time,
    metadata: parse<Record<string, unknown>>(r.metadata, {}),
    playStats: parse<StoredPlay['playStats']>(r.play_stats, []),
    firstSeenAt: r.first_seen_at,
  };
}

/**
 * Inserts plays not seen before, returning only those.
 *
 * The returned list is what a feed should announce; everything else is a repeat. At a 60s poll
 * against a 20-play window roughly nineteen of twenty plays are already known, so this dedupe is
 * what makes polling a small fixed window viable instead of refetching a whole week.
 *
 * An already-stored play is left ALONE rather than updated: its first_seen_at is a measurement of
 * when we observed it and must not drift. Stat corrections are handled by reconciling against the
 * authoritative stats feed, not by rewriting history here.
 */
export function insertNewPlays(
  season: string,
  week: number,
  gameId: string,
  plays: RawPlay[],
): StoredPlay[] {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM nfl_plays WHERE play_id = ?');
  const insert = db.prepare(
    `INSERT INTO nfl_plays (play_id, game_id, season, week, sequence, play_time, metadata, play_stats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const run = db.transaction(() => {
    const fresh: StoredPlay[] = [];
    for (const p of plays) {
      if (!p.play_id) continue;
      if (exists.get(p.play_id)) continue;
      const stats = (p.play_stats ?? [])
        .filter(s => s?.player_id)
        .map(s => ({ player_id: s.player_id, stats: s.stats ?? {} }));
      insert.run(
        p.play_id, p.game_id ?? gameId, season, week,
        p.sequence ?? null, p.time ?? null,
        JSON.stringify(p.metadata ?? {}), JSON.stringify(stats),
      );
      fresh.push({
        playId: p.play_id, gameId: p.game_id ?? gameId, season, week,
        sequence: p.sequence ?? null, playTime: p.time ?? null,
        metadata: p.metadata ?? {}, playStats: stats,
        firstSeenAt: new Date().toISOString(),
      });
    }
    return fresh;
  });

  return run();
}

/** Most recently OBSERVED plays, newest first — the order a live feed reads in. */
export function recentPlays(season: string, week: number, limit = 100): StoredPlay[] {
  const rows = getDb().prepare(
    `SELECT * FROM nfl_plays WHERE season = ? AND week = ?
     ORDER BY first_seen_at DESC, sequence DESC LIMIT ?`,
  ).all(season, week, limit) as Row[];
  return rows.map(toStored);
}

/** Every play of a week in game order, for replay and reconciliation. */
export function playsForWeek(season: string, week: number): StoredPlay[] {
  const rows = getDb().prepare(
    'SELECT * FROM nfl_plays WHERE season = ? AND week = ? ORDER BY sequence ASC',
  ).all(season, week) as Row[];
  return rows.map(toStored);
}

export function playCount(season: string, week: number): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) AS n FROM nfl_plays WHERE season = ? AND week = ?',
  ).get(season, week) as { n: number };
  return r.n;
}

/**
 * How far behind the feed runs, in seconds, over recently observed plays.
 *
 * This is the measurement the whole design hinged on and that could not be taken before a live
 * game: first_seen_at minus the play's own timestamp. Reported as a median so one slow poll does
 * not dominate, and bounded to discard rows captured by a backfill rather than live.
 */
export function observedLatencySeconds(season: string, week: number, sample = 50): number | null {
  const rows = getDb().prepare(
    `SELECT play_time, first_seen_at FROM nfl_plays
     WHERE season = ? AND week = ? AND play_time IS NOT NULL
     ORDER BY first_seen_at DESC LIMIT ?`,
  ).all(season, week, sample) as { play_time: number; first_seen_at: string }[];
  const deltas = rows
    // SQLite datetime('now') is UTC without a zone marker; say so explicitly or Date.parse
    // reads it as local time and the latency comes out hours wrong.
    .map(r => (Date.parse(`${r.first_seen_at.replace(' ', 'T')}Z`) - r.play_time) / 1000)
    .filter(n => Number.isFinite(n) && n > -60 && n < 3600)
    .sort((a, b) => a - b);
  if (deltas.length === 0) return null;
  return deltas[Math.floor(deltas.length / 2)];
}
