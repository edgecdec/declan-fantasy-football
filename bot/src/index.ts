import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type APIEmbed,
  type TextChannel,
} from 'discord.js';
import playerIndex from '../../data/player_index.json';
import {
  commandDefinitions,
  handleAutocomplete,
  handleInteraction,
  handlePageButton,
} from './commands';
import { formatTransaction, type ManagerNames, type PlayerLookup } from './formatTransaction';
import { formatPlacements, formatWeekSettled, groupWindow } from './betEventStream';
import { getState, setState } from './botDb';
import { fetchBetEvents, fetchLatestEventId, type BetEvent } from './siteApi';
import { allSubscriptions, leaguesToPoll, type Subscription } from './subscriptions';
import {
  createStreamState,
  fetchTransactions,
  hasSeeded,
  pruneToWeek,
  seed,
  takeNew,
  pingRoleFor,
  wantsTransaction,
} from './transactionStream';

/**
 * The Declan Dollars bot.
 *
 * Owns no bet state. It holds a cursor, channel bindings, and an in-memory set of transaction ids —
 * nothing else. Everything about money comes from the site over HTTP, so every integrity rule in
 * `placeWager` applies unchanged and the bot can never corrupt a balance.
 *
 * NO PRIVILEGED INTENTS. Slash commands and channel posting need none of Message Content, Presence
 * or Server Members, so none are requested — fewer intents is less to justify if the app ever needs
 * verification, and less to leak.
 */

const POLL_INTERVAL_MS = 60_000;
/** Bet announcements are batched: one message per league per window. */
const BET_FLUSH_MS = 5 * 60_000;
const BET_CURSOR_KEY = 'bet_cursor';
/** A week rolls over on Tuesday; re-reading it costs one request and avoids a stale-week edge case. */
const STATE_REFRESH_MS = 15 * 60_000;

const PLAYERS = playerIndex as unknown as PlayerLookup;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const state = createStreamState();
let currentWeek = 0;
let currentSeason = '';

/**
 * Cursor into the bet outbox.
 *
 * Restored from bot.db on startup so a deploy mid-window does not drop that window's bets. With no
 * stored cursor it starts at the CURRENT latest id, never 0: starting at 0 would replay every bet
 * ever placed into the channel — the reason /api/bot/events returns nothing unless `after` is given.
 * A long outage cannot flood a channel either; groupWindow drops placements over an hour old.
 */
let betCursor = -1;

/** Manager names per league, refreshed lazily — rosters change rarely and this saves two calls a tick. */
const managerCache = new Map<string, { at: number; names: ManagerNames }>();
const MANAGER_TTL_MS = 30 * 60_000;

async function managerNames(leagueId: string): Promise<ManagerNames> {
  const cached = managerCache.get(leagueId);
  if (cached && Date.now() - cached.at < MANAGER_TTL_MS) return cached.names;

  const names: ManagerNames = new Map();
  try {
    const [rosters, users] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
    ]);
    type Roster = { roster_id: number; owner_id: string | null };
    type User = { user_id: string; display_name: string };
    const byUser = new Map((users as User[]).map(u => [u.user_id, u.display_name]));
    for (const r of rosters as Roster[]) {
      names.set(r.roster_id, (r.owner_id && byUser.get(r.owner_id)) || `Roster ${r.roster_id}`);
    }
  } catch (err) {
    console.error('[bot] could not load managers for', leagueId, err);
    // Cached anyway, briefly, so a broken league does not re-request every minute.
  }
  managerCache.set(leagueId, { at: Date.now(), names });
  return names;
}

async function refreshNflState(): Promise<void> {
  try {
    const res = await fetch('https://api.sleeper.app/v1/state/nfl');
    const body = (await res.json()) as { week?: number; season?: string };
    const week = body.week ?? 0;
    if (week && week !== currentWeek) {
      // Rollover: forget last week's ids so the Map cannot grow across a season.
      pruneToWeek(state, week);
      console.log(`[bot] week is now ${week}`);
    }
    currentWeek = week;
    currentSeason = body.season ?? currentSeason;
  } catch (err) {
    console.error('[bot] could not read NFL state', err);
  }
}

async function pollTransactions(client: Client): Promise<void> {
  if (!currentWeek) return;
  const subs = allSubscriptions();
  if (subs.length === 0) return;

  for (const leagueId of leaguesToPoll()) {
    let transactions;
    try {
      transactions = await fetchTransactions(leagueId, currentWeek);
    } catch (err) {
      console.error('[bot] transaction fetch failed for', leagueId, err);
      continue;
    }

    /*
     * The restart defence. A process that has never swept this league-week records every id and
     * posts nothing — otherwise every deploy dumps the week's history into the channel.
     */
    if (!hasSeeded(state, leagueId, currentWeek)) {
      seed(state, leagueId, currentWeek, transactions);
      console.log(`[bot] seeded ${leagueId} week ${currentWeek} with ${transactions.length} ids`);
      continue;
    }

    const fresh = takeNew(state, leagueId, currentWeek, transactions);
    if (fresh.length === 0) continue;

    const names = await managerNames(leagueId);
    // Fan out per SUBSCRIPTION: two guilds watching one league may filter differently, so the
    // decision to post belongs to the binding rather than to the league.
    for (const sub of subs.filter(s => s.leagueId === leagueId)) {
      const wanted = fresh.filter(tx => wantsTransaction(sub, tx));
      if (wanted.length === 0) continue;

      const channel = await client.channels.fetch(sub.channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        console.error('[bot] cannot post to', sub.channelId);
        continue;
      }
      for (const tx of wanted) {
        const msg = formatTransaction(tx, names, PLAYERS, sub.leagueName);
        const pingRole = pingRoleFor(sub, tx);
        try {
          await (channel as TextChannel).send({
            content: pingRole ? `<@&${pingRole}>` : undefined,
            embeds: [{
              title: msg.title,
              description: msg.lines.join('\n'),
              color: msg.colour,
              fields: msg.fields,
              timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined,
            }],
            /*
             * allowed_mentions is set explicitly, and set NARROWLY. Default behaviour would honour
             * any mention the message happens to contain; naming exactly the one role means a
             * league name or player name that looks like a mention can never notify anybody.
             *
             * Note this permits rather than guarantees: Discord still requires either the role to be
             * mentionable or the bot to hold Mention Everyone. /admin pingrole checks and says so,
             * because a ping that silently fails to notify is worse than no ping.
             */
            allowedMentions: pingRole ? { roles: [pingRole] } : { parse: [] },
          });
        } catch (err) {
          console.error('[bot] send failed', err);
        }
      }
      console.log(`[bot] posted ${wanted.length} to ${sub.channelId} (${leagueId})`);
    }
  }
}

/**
 * Registers the command set with one guild.
 *
 * PER-GUILD rather than global, and done for EVERY guild the bot is in — not just a configured one.
 *
 * Guild-scoped registration takes effect instantly; global registration can take an hour to
 * propagate. But an earlier version registered only to `DISCORD_GUILD_ID`, which works perfectly
 * until the bot is added to a second server and then presents as "the bot is here but has no
 * commands" — a failure with no error anywhere, because nothing went wrong, the commands simply were
 * never registered there. Doing it per guild on startup and on join means every server gets commands
 * immediately and there is no single privileged guild.
 *
 * The cost is one API call per guild at startup. At this scale that is nothing; if the bot ever runs
 * in hundreds of servers, global registration becomes the right trade instead.
 */
/**
 * Posts the last window's bet events to every channel watching each league.
 *
 * Runs every BET_FLUSH_MS rather than every minute, and posts AT MOST ONE placement message per
 * league per window: one message per bet turned a burst of ten bets into ten pings. The site's
 * outbox is the buffer — nothing is held in the bot's memory between windows, so there is nothing
 * to lose on a restart beyond the persisted cursor, which is written only after a window is handled.
 *
 * Fan-out is per SUBSCRIPTION, matching the transaction poller: a league watched by two guilds posts
 * to both, each in its own channel, and a guild watching nothing hears nothing.
 *
 * Bet events deliberately ignore `event_types`, which describes Sleeper TRANSACTION types and has
 * nothing to say about wagers. If bet announcements ever need muting, that is its own setting rather
 * than an overload of this one.
 */
async function flushBetEvents(client: Client): Promise<void> {
  if (betCursor < 0) {
    // The site was unreachable at startup. Retry for "now" rather than falling back to 0, which
    // would replay every bet ever placed.
    await initBetCursor();
    return;
  }

  // Page through everything since the cursor. A settled week writes several events per bet, so one
  // window can exceed a single page.
  const events: BetEvent[] = [];
  let after = betCursor;
  for (;;) {
    const res = await fetchBetEvents(after);
    if (!res.ok) {
      console.error('[bot] could not read bet events:', res.error);
      // Post what was read rather than nothing; the cursor below only covers that much.
      break;
    }
    if (res.data.events.length === 0) break;
    events.push(...res.data.events);
    after = res.data.events[res.data.events.length - 1].id;
  }
  if (events.length === 0) return;

  const { placements, digests } = groupWindow(events, Date.now());
  const subs = allSubscriptions();

  const send = async (sub: Subscription, embeds: APIEmbed[]): Promise<void> => {
    /*
     * Logged rather than skipped silently. A channel-level permission override denying View
     * Channel makes this fetch fail, and an earlier version just moved on — so a guild that had
     * bound a channel the bot could not see got no announcements and no explanation, which is
     * exactly how it was reported: "printed in one server but not another".
     */
    const channel = await client.channels.fetch(sub.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      console.error(
        `[bot] cannot post bet event to channel ${sub.channelId} in guild ${sub.guildId}`
        + ' — check the bot can View Channel and Send Messages there',
      );
      return;
    }
    // One message per embed so a digest's summary and full list are separately quotable.
    for (const embed of embeds) {
      try {
        await (channel as TextChannel).send({ embeds: [embed] });
      } catch (err) {
        console.error(`[bot] bet event send failed for ${sub.channelId}`, err);
      }
    }
  };

  for (const [leagueId, batch] of placements) {
    for (const sub of subs.filter(s => s.leagueId === leagueId)) {
      // Built per subscription because the title carries the league's display name.
      const embed = formatPlacements(batch, sub.leagueName);
      if (embed) await send(sub, [embed]);
    }
  }
  for (const event of digests) {
    for (const sub of subs.filter(s => s.leagueId === event.leagueId)) {
      const embeds = formatWeekSettled(event, sub.leagueName);
      if (embeds.length) await send(sub, embeds);
    }
  }

  /*
   * Advanced past everything read, posted or not: a silent event is still handled, and leaving it
   * behind the cursor would re-fetch it forever. Persisted so a deploy mid-window does not drop it.
   */
  betCursor = Math.max(betCursor, after);
  setState(BET_CURSOR_KEY, String(betCursor));
  const placed = [...placements.values()].reduce((n, b) => n + b.length, 0);
  console.log(
    `[bot] handled ${events.length} bet event(s) — ${placed} placement(s) in ${placements.size}`
    + ` league(s), ${digests.length} digest(s); cursor now ${betCursor}`,
  );
}

async function initBetCursor(): Promise<void> {
  const stored = Number(getState(BET_CURSOR_KEY) ?? NaN);
  if (Number.isInteger(stored) && stored >= 0) {
    betCursor = stored;
    return;
  }
  // First run: start at "now" so nothing that already happened is announced.
  const latest = await fetchLatestEventId();
  if (!latest.ok) {
    console.error('[bot] could not read the latest bet event id:', latest.error);
    return;
  }
  betCursor = latest.data.latest;
  setState(BET_CURSOR_KEY, String(betCursor));
}

async function registerCommandsForGuild(rest: REST, appId: string, guildId: string): Promise<void> {
  try {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commandDefinitions });
    console.log(`[bot] registered ${commandDefinitions.length} commands to guild ${guildId}`);
  } catch (err) {
    // One guild refusing registration (missing scope, kicked mid-startup) must not stop the others.
    console.error(`[bot] could not register commands to guild ${guildId}`, err);
  }
}

async function main(): Promise<void> {
  const appId = requireEnv('DISCORD_APP_ID');
  const rest = new REST({ version: '10' }).setToken(requireEnv('DISCORD_BOT_TOKEN'));

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('clientReady', async () => {
    console.log(`[bot] online as ${client.user?.tag}`);
    // After ready, not before: the guild list comes from the gateway, so registering up front would
    // have nothing to iterate.
    const guilds = [...client.guilds.cache.keys()];
    console.log(`[bot] in ${guilds.length} guild(s)`);
    for (const guildId of guilds) await registerCommandsForGuild(rest, appId, guildId);
  });

  // Added to a new server: register immediately so its commands work without waiting for a restart.
  client.on('guildCreate', async guild => {
    console.log(`[bot] added to guild ${guild.id} (${guild.name})`);
    await registerCommandsForGuild(rest, appId, guild.id);
  });

  client.on('interactionCreate', async interaction => {
    // Autocomplete arrives as its own interaction type and must be answered within three seconds,
    // so it is handled before the command branch rather than inside it.
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction).catch(err => {
        console.error('[bot] autocomplete failed', err);
      });
      return;
    }
    // Paging buttons arrive as their own interaction type, and must be acknowledged within three
    // seconds or Discord shows "This interaction failed" regardless of what happens after.
    if (interaction.isButton()) {
      await handlePageButton(interaction).catch(err => {
        console.error('[bot] button failed', err);
      });
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    await handleInteraction(interaction);
  });

  client.on('error', err => console.error('[bot] client error', err));

  await client.login(requireEnv('DISCORD_BOT_TOKEN'));

  await refreshNflState();
  setInterval(() => void refreshNflState(), STATE_REFRESH_MS);

  await initBetCursor();
  console.log(`[bot] bet event cursor starts at ${betCursor}, flushing every ${BET_FLUSH_MS / 1000}s`);
  setInterval(() => void flushBetEvents(client), BET_FLUSH_MS);
  // First sweep runs immediately so a restart seeds without waiting a minute, during which a real
  // transaction could land and then be treated as history.
  await pollTransactions(client);
  setInterval(() => void pollTransactions(client), POLL_INTERVAL_MS);

  console.log(`[bot] polling every ${POLL_INTERVAL_MS / 1000}s, season ${currentSeason}`);
}

main().catch(err => {
  console.error('[bot] failed to start', err);
  // Non-zero so pm2 records a failure rather than treating a dead gateway as a clean exit.
  process.exit(1);
});
