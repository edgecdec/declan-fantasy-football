/**
 * The bot's client for `/api/bot/*`.
 *
 * All Declan Dollars reads and writes go over HTTP rather than by opening `data/betting.db`. The
 * design doc proposed readonly SQLite for reads, and this is a deliberate departure: the valuation
 * logic (`valueOpenPositionsForAccounts`) would otherwise have to be re-derived here, and two
 * implementations of "what is this position worth" is exactly how the website and the bot start
 * quoting different balances. Volume is a handful of slash commands a week, so the HTTP hop costs
 * nothing that matters.
 *
 * The bot therefore never holds a handle on the database that records money. Its own SQLite file
 * holds channel bindings and nothing else.
 */

/**
 * Same host, so this is a loopback call — the site and the bot are two pm2 apps on one box.
 * Defaults to the site's port rather than 3000, because that is what it listens on in production.
 */
function baseUrl(): string {
  if (process.env.SITE_BASE_URL) return process.env.SITE_BASE_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.SITE_PORT ?? process.env.PORT ?? 3004}`;
}

function secret(): string {
  const value = process.env.BOT_SERVICE_SECRET;
  if (!value) {
    // Fails loudly at the call site rather than sending an unauthenticated request and reporting a
    // confusing 401 as if the site were broken.
    throw new Error('BOT_SERVICE_SECRET is not set — the bot cannot talk to the site');
  }
  return value;
}

export type SiteResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<SiteResult<T>> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        'x-bot-secret': secret(),
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    /*
     * A dead site must not take the bot down with it. The gateway connection is the expensive thing
     * to lose — reconnecting drops any in-flight interaction — so a failed read becomes an error
     * message in the channel instead of an unhandled rejection.
     */
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'site unreachable',
    };
  }
}

export type LeaderboardStanding = {
  accountId: string;
  displayName: string;
  isMe: boolean;
  claimed: boolean;
  balanceCents: number;
  equityCents: number;
  liveValueCents: number;
  unrealisedPnlCents: number;
  openStakeCents: number;
  openCount: number;
  won: number;
  lost: number;
  voided: number;
  /** Settled profit: what resolved bets actually returned, minus what they staked. */
  bettingNetCents: number;
  settledCount: number;
  totalStakedCents: number;
  roi: number | null;
};

export type LeaderboardResponse = {
  league: { leagueId: string; season: string; label: string };
  startBalanceCents: number;
  standings: LeaderboardStanding[];
  openPositions: {
    bettor: string;
    pick: string;
    stakeCents: number;
    price: number;
    toWinCents: number;
    week: number;
    winProbability: number | null;
    valueCents: number | null;
  }[];
};

export function fetchLeaderboard(
  leagueId: string,
  discordUserId?: string,
): Promise<SiteResult<LeaderboardResponse>> {
  const params = new URLSearchParams({ leagueId });
  if (discordUserId) params.set('discordUserId', discordUserId);
  return call<LeaderboardResponse>(`/api/bot/leaderboard?${params}`);
}

export type MarketRow = {
  marketId: string;
  matchupId: number;
  nameA: string | null;
  nameB: string | null;
  probA: number;
  priceA: number;
  priceB: number;
  status: string;
  remainingMinutes: number;
};

export type MarketsResponse = {
  league: { leagueId: string; season: string; label: string };
  week: number;
  markets: MarketRow[];
};

export function fetchMarkets(leagueId: string, week?: number): Promise<SiteResult<MarketsResponse>> {
  const params = new URLSearchParams({ leagueId });
  if (week) params.set('week', String(week));
  return call<MarketsResponse>(`/api/bot/markets?${params}`);
}

export type MeResponse = {
  user: { username: string; displayName: string; isAdmin: boolean; discordUserId: string | null };
  leagues: {
    leagueId: string;
    season: string;
    balanceCents: number;
    openStakeCents: number;
    liveValueCents: number;
    equityCents: number;
    unrealisedPnlCents: number;
    openExposureCents: number;
    positions: {
      wagerId: string;
      pick?: string;
      stakeCents: number;
      toWinCents: number;
      winProbability: number;
      valueCents: number;
    }[];
  }[];
  negativeExposureCapCents: number;
};

export function fetchMe(discordUserId: string): Promise<SiteResult<MeResponse>> {
  return call<MeResponse>(`/api/bot/me?discordUserId=${encodeURIComponent(discordUserId)}`);
}

export type BetEvent = {
  id: number;
  type: string;
  leagueId: string;
  season: number;
  week: number;
  refId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Resolved server-side, since the bot has no access to the accounts table. */
  bettorName: string | null;
};

export function fetchBetEvents(
  after: number,
): Promise<SiteResult<{ events: BetEvent[]; latest: number }>> {
  return call<{ events: BetEvent[]; latest: number }>(`/api/bot/events?after=${after}`);
}

/** The starting cursor: "where are we now", so a fresh bot never replays history. */
export function fetchLatestEventId(): Promise<SiteResult<{ latest: number }>> {
  return call<{ latest: number }>('/api/bot/events');
}

export type HistoryBet = {
  wagerId: string;
  bettor: string;
  pick: string;
  opponent: string | null;
  stakeCents: number;
  price: number;
  toWinCents: number;
  status: string;
  settledAt: string | null;
  week: number;
  netCents: number;
};

export function fetchHistory(
  leagueId: string,
  limit = 100,
): Promise<SiteResult<{ league: { leagueId: string; label: string }; bets: HistoryBet[] }>> {
  return call(`/api/bot/history?leagueId=${encodeURIComponent(leagueId)}&limit=${limit}`);
}

export type LuckTeam = {
  name: string;
  teamName: string | null;
  actualWins: number;
  expectedWins: number;
  luck: number;
  pointsFor: number;
  pointsAgainst: number;
};

export function fetchLuck(leagueId: string): Promise<SiteResult<{
  league: { leagueId: string; name: string; season: string };
  weeksCounted: number;
  teams: LuckTeam[];
}>> {
  return call(`/api/bot/luck?leagueId=${encodeURIComponent(leagueId)}`);
}

export function placeBet(args: {
  discordUserId: string;
  marketId: string;
  side: 'a' | 'b';
  stakeCents: number;
}): Promise<SiteResult<{
  wagerId: string;
  balanceCents: number;
  toWinCents: number;
  account: { username: string; displayName: string };
}>> {
  return call('/api/bot/wager', { method: 'POST', body: JSON.stringify(args) });
}

export function adminLink(args: {
  discordUserId: string;
  username?: string;
  unlink?: boolean;
}): Promise<SiteResult<{ linked?: { username: string; displayName: string }; unlinked?: string }>> {
  return call('/api/bot/admin/link', { method: 'POST', body: JSON.stringify(args) });
}

export function adminWhois(
  discordUserId: string,
): Promise<SiteResult<{ linked: { username: string; displayName: string } | null }>> {
  return call(`/api/bot/admin/link?discordUserId=${encodeURIComponent(discordUserId)}`);
}
