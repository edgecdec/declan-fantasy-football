import {
  SlashCommandBuilder,
  type APIEmbed,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from 'discord.js';
import { adminRefusalReason, canAdminGuild } from './permissions';
import {
  DEFAULT_EVENT_TYPES,
  SUGGESTED_PING_TYPES,
  TRANSACTION_TYPES,
  setEventTypes,
  setPingRole,
  subscriptionsForChannel,
  setIncludeFailed,
  setMinFaab,
  subscription,
  subscriptionsForGuild,
  unwatchLeague,
  watchLeague,
  type TransactionType,
} from './subscriptions';
import {
  adminLink,
  adminWhois,
  fetchLeaderboard,
  fetchMarkets,
  fetchMe,
  placeBet,
  type LeaderboardStanding,
} from './siteApi';
import { americanOdds, meter, money, pad, padLeft, percent } from './format';

/**
 * Slash commands.
 *
 * Two rules run through all of them:
 *
 *  1. **The guild's bindings are the scope.** A command answers about leagues this server watches,
 *     never about every league the bot knows. That is the bot's equivalent of the site gating
 *     balances on league membership, and it is what stops one league's money showing up in another
 *     server's channel.
 *  2. **Personal figures need a linked account.** Standings are public within a league — the whole
 *     point of play money is the bragging rights — but "your" balance requires proving who you are.
 */

/** Discord rejects a message over 2000 characters, and a 17-team league gets close. */
const MAX_BODY = 1900;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('balances')
    .setDescription('Declan Dollars standings for a league this server watches')
    .addStringOption(o =>
      o.setName('league').setDescription('League id, if this server watches more than one'),
    ),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Your own bankroll and open exposure'),
  new SlashCommandBuilder()
    .setName('slips')
    .setDescription('Your open wagers, valued at the current line'),
  new SlashCommandBuilder()
    .setName('markets')
    .setDescription('Priced betting board for the league this channel watches')
    .addIntegerOption(o => o.setName('week').setDescription('Defaults to the current week'))
    .addStringOption(o =>
      o.setName('league').setDescription('League id, if this channel watches more than one'),
    ),
  new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Back one side of a matchup with Declan Dollars')
    .addStringOption(o =>
      o
        .setName('pick')
        .setDescription('Who you are backing')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addNumberOption(o =>
      o
        .setName('amount')
        .setDescription('Dollars to stake, e.g. 25 or 12.50')
        .setRequired(true)
        .setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Fantasy win-loss standings for a league this server watches')
    .addStringOption(o =>
      o.setName('league').setDescription('League id, if this server watches more than one'),
    ),
  new SlashCommandBuilder()
    .setName('watching')
    .setDescription('Which leagues this server is watching'),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Configure the bot (needs Manage Server)')
    .addSubcommand(s =>
      s
        .setName('watch')
        .setDescription('Post a league’s activity to a channel')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Defaults to here')),
    )
    .addSubcommand(s =>
      s
        .setName('unwatch')
        .setDescription('Stop posting a league')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true)),
    )
    .addSubcommand(s =>
      s
        .setName('events')
        .setDescription('Which transaction types to post')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true))
        .addStringOption(o =>
          o
            .setName('types')
            .setDescription('Comma-separated, or "all"')
            .setRequired(true),
        ),
    )
    .addSubcommand(s =>
      s
        .setName('failed')
        .setDescription('Post failed waiver claims too (a third of all transactions)')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true))
        .addBooleanOption(o => o.setName('include').setDescription('On or off').setRequired(true)),
    )
    .addSubcommand(s =>
      s
        .setName('minfaab')
        .setDescription('Hide waiver claims under this FAAB amount')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('0 posts everything').setRequired(true)),
    )
    .addSubcommand(s =>
      s
        .setName('pingrole')
        .setDescription('Mention one of your existing roles when an event happens')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true))
        .addStringOption(o =>
          o
            .setName('type')
            .setDescription('Which event pings this role')
            .setRequired(true)
            .addChoices(
              { name: 'trade', value: 'trade' },
              { name: 'waiver', value: 'waiver' },
              { name: 'free_agent (add/drop)', value: 'free_agent' },
              { name: 'commissioner', value: 'commissioner' },
              { name: 'chopped (elimination)', value: 'chopped' },
            ),
        )
        .addRoleOption(o =>
          o.setName('role').setDescription('An existing role — leave empty to stop pinging'),
        ),
    )
    .addSubcommand(s =>
      s
        .setName('pings')
        .setDescription('Show which roles get pinged for what')
        .addStringOption(o => o.setName('league').setDescription('Sleeper league id').setRequired(true)),
    )
    .addSubcommand(s =>
      s
        .setName('link')
        .setDescription('Link a Discord user to a Declan Dollars account')
        .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
        .addStringOption(o =>
          o.setName('username').setDescription('Sleeper username').setRequired(true),
        ),
    )
    .addSubcommand(s =>
      s
        .setName('unlink')
        .setDescription('Remove a Discord link')
        .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),
    )
    .addSubcommand(s =>
      s
        .setName('whois')
        .setDescription('Which account is a Discord user linked to?')
        .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true)),
    ),
].map(c => c.toJSON());

/**
 * Which leagues a read command covers, scoped to THIS CHANNEL first.
 *
 * A guild may bind Graham's to #graham and Silverback to #silverback; running a command in #graham
 * plainly means Graham's, and asking "which did you mean" there would be obtuse. Only when the
 * current channel has no binding does it fall back to everything the guild watches.
 *
 * Returns a LIST rather than one league, so a command can render each in its own pane instead of
 * refusing when there are several. An explicit option must still be something this guild watches —
 * otherwise passing an arbitrary id would read any league from any server, which is exactly the leak
 * the binding model exists to prevent.
 */
function resolveLeagues(
  guildId: string,
  channelId: string | null,
  explicit: string | null,
): { leagueId: string; leagueName: string | null }[] | { error: string } {
  const guildSubs = subscriptionsForGuild(guildId);
  if (guildSubs.length === 0) {
    return { error: 'This server is not watching any leagues yet. An admin can run `/admin watch`.' };
  }

  if (explicit) {
    const match = guildSubs.find(s => s.leagueId === explicit);
    if (!match) return { error: 'This server is not watching that league.' };
    return [{ leagueId: match.leagueId, leagueName: match.leagueName }];
  }

  const here = channelId ? subscriptionsForChannel(guildId, channelId) : [];
  const chosen = here.length > 0 ? here : guildSubs;
  return chosen.map(s => ({ leagueId: s.leagueId, leagueName: s.leagueName }));
}

function parseTypes(raw: string): TransactionType[] | null {
  if (raw.trim().toLowerCase() === 'all') return [...DEFAULT_EVENT_TYPES];
  const wanted = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = wanted.filter((t): t is TransactionType =>
    (TRANSACTION_TYPES as readonly string[]).includes(t),
  );
  // All-or-nothing: silently dropping a typo would leave someone believing a type is enabled.
  return valid.length === wanted.length && valid.length > 0 ? valid : null;
}

async function handleBalances(i: ChatInputCommandInteraction): Promise<void> {
  const resolved = resolveLeagues(i.guildId!, i.channelId, i.options.getString('league'));
  if ('error' in resolved) {
    await i.editReply(resolved.error);
    return;
  }

  const embeds: APIEmbed[] = [];
  const problems: string[] = [];
  for (const league of resolved) {
    const res = await fetchLeaderboard(league.leagueId, i.user.id);
    if (!res.ok) {
      // A watched league with no betting enabled is the common case, and is worth naming rather
      // than failing the whole command.
      problems.push(
        `**${league.leagueName ?? league.leagueId}** — `
        + (res.status === 404 ? 'no Declan Dollars' : res.error),
      );
      continue;
    }
    const { standings, league: meta } = res.data;
    /*
     * Names are kept SHORT here rather than padded to a wide column. The previous attempt aligned
     * three 12-character money columns and a 16-character name, which is wider than an embed code
     * block on desktop and far wider on mobile — long names wrapped and destroyed every row below.
     */
    const lines = standings.map((s: LeaderboardStanding, n: number) =>
      `${padLeft(String(n + 1), 2)} ${pad(s.displayName, 14)}`
      + `${padLeft(money(s.equityCents), 11)}`
      + (s.openCount ? ` (${s.openCount})` : ''),
    );
    embeds.push({
      title: `${meta.label} — week worth`,
      description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
      color: 0x57f287,
      footer: { text: 'ranked on live worth · (n) = open bets' },
    });
  }

  if (embeds.length === 0) {
    await i.editReply(problems.join('\n') || 'Nothing to show.');
    return;
  }
  await i.editReply({
    content: problems.length ? problems.join('\n') : undefined,
    embeds: embeds.slice(0, 10),
  });
}

/**
 * The priced board, one embed per league.
 *
 * Rendered as embed FIELDS rather than an aligned monospace table. Discord lays fields out itself,
 * so a long manager name cannot wrap and break the rows beneath it — which is exactly what happened
 * to the first version of this, where `KarrasKarras` and `Coldst2EvaDoIt` overflowed the block.
 */
async function handleMarkets(i: ChatInputCommandInteraction): Promise<void> {
  const resolved = resolveLeagues(i.guildId!, i.channelId, i.options.getString('league'));
  if ('error' in resolved) {
    await i.editReply(resolved.error);
    return;
  }
  const week = i.options.getInteger('week');

  const embeds: APIEmbed[] = [];
  const problems: string[] = [];
  for (const league of resolved) {
    const res = await fetchMarkets(league.leagueId, week ?? undefined);
    if (!res.ok) {
      problems.push(
        `**${league.leagueName ?? league.leagueId}** — `
        + (res.status === 404 ? 'no Declan Dollars' : res.error),
      );
      continue;
    }
    const { markets, league: meta, week: shown } = res.data;
    if (markets.length === 0) {
      problems.push(`**${meta.label}** — nothing priced for week ${shown} yet.`);
      continue;
    }

    embeds.push({
      title: `${meta.label} — week ${shown}`,
      // Closest matchups first, as the API returns them.
      fields: markets.slice(0, 25).map(m => ({
        name: `${m.nameA ?? 'A'}  vs  ${m.nameB ?? 'B'}`,
        value:
          `\`${meter(m.probA)}\`  **${Math.round(m.probA * 100)}%**\n`
          + `${americanOdds(m.priceA)} / ${americanOdds(m.priceB)}`
          + (m.status === 'open' ? '' : `  ·  _${m.status}_`),
        inline: false,
      })),
      color: 0x5865f2,
      footer: { text: 'bar = chance the left side wins · odds include the house vig' },
    });
  }

  if (embeds.length === 0) {
    await i.editReply(problems.join('\n') || 'Nothing to show.');
    return;
  }
  await i.editReply({
    content: problems.length ? problems.join('\n') : undefined,
    embeds: embeds.slice(0, 10),
  });
}

async function handleBalance(i: ChatInputCommandInteraction): Promise<void> {
  const res = await fetchMe(i.user.id);
  if (!res.ok) {
    await i.editReply(
      res.status === 404
        ? 'You have not linked a Declan Dollars account yet — ask an admin to run `/admin link`.'
        : `Could not read your balance: ${res.error}`,
    );
    return;
  }
  const { user, leagues } = res.data;
  if (leagues.length === 0) {
    await i.editReply(`**${user.displayName}** — no league bankrolls yet.`);
    return;
  }
  const lines = leagues.map(l =>
    `\`${l.leagueId}\` balance ${money(l.balanceCents)} · worth ${money(l.equityCents)}`
    + (l.openStakeCents ? ` · ${money(l.openStakeCents)} at risk` : ''),
  );
  await i.editReply(`**${user.displayName}**\n${lines.join('\n').slice(0, MAX_BODY)}`);
}

async function handleSlips(i: ChatInputCommandInteraction): Promise<void> {
  const res = await fetchMe(i.user.id);
  if (!res.ok) {
    await i.editReply(
      res.status === 404
        ? 'You have not linked a Declan Dollars account yet — ask an admin to run `/admin link`.'
        : `Could not read your wagers: ${res.error}`,
    );
    return;
  }
  const open = res.data.leagues.flatMap(l => l.positions.map(p => ({ ...p, leagueId: l.leagueId })));
  if (open.length === 0) {
    await i.editReply('No open wagers.');
    return;
  }
  const lines = open.map(p =>
    `${p.pick ?? 'pick'} · ${money(p.stakeCents)} to win ${money(p.toWinCents)}`
    + ` · ${percent(p.winProbability)} · worth ${money(p.valueCents)}`,
  );
  await i.editReply(`**Your open wagers**\n${lines.join('\n').slice(0, MAX_BODY)}`);
}

/**
 * Fantasy win-loss, straight from Sleeper.
 *
 * Not proxied through the site, which has no such endpoint — the website computes this client-side
 * from `rosters[].settings.wins`. A route for it would be a pointless hop.
 */
async function handleStandings(i: ChatInputCommandInteraction): Promise<void> {
  const leagues = resolveLeagues(i.guildId!, i.channelId, i.options.getString('league'));
  if ('error' in leagues) {
    await i.editReply(leagues.error);
    return;
  }
  // One league per reply keeps the Sleeper calls bounded; the first is the channel's own binding.
  const resolved = leagues[0];

  try {
    const [rosters, users] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${resolved.leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${resolved.leagueId}/users`).then(r => r.json()),
    ]);
    type Roster = {
      owner_id: string | null;
      settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number };
    };
    type User = { user_id: string; display_name: string };
    const nameOf = new Map((users as User[]).map(u => [u.user_id, u.display_name]));

    const table = (rosters as Roster[])
      .map(r => ({
        name: (r.owner_id && nameOf.get(r.owner_id)) || 'unknown',
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        ties: r.settings?.ties ?? 0,
        // Sleeper splits points into whole and decimal parts.
        points: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
      }))
      .sort((a, b) => b.wins - a.wins || b.points - a.points);

    const lines = [`${pad('manager', 18)}${padLeft('W-L', 7)}${padLeft('points', 10)}`];
    for (const t of table) {
      const record = t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
      lines.push(pad(t.name, 18) + padLeft(record, 7) + padLeft(t.points.toFixed(2), 10));
    }
    const title = resolved.leagueName ?? resolved.leagueId;
    await i.editReply(`**${title}**\n${['```', ...lines, '```'].join('\n').slice(0, MAX_BODY)}`);
  } catch (err) {
    await i.editReply(`Could not read Sleeper: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

async function handleWatching(i: ChatInputCommandInteraction): Promise<void> {
  const subs = subscriptionsForGuild(i.guildId!);
  if (subs.length === 0) {
    await i.editReply('Not watching any leagues. An admin can run `/admin watch`.');
    return;
  }
  const lines = subs.map(s => {
    const pings = Object.entries(s.pingRoles);
    return `<#${s.channelId}> ← \`${s.leagueId}\`${s.leagueName ? ` (${s.leagueName})` : ''}`
      + `\n   types: ${s.eventTypes.join(', ')}`
      + `${s.includeFailed ? ' · incl. failed' : ''}${s.minFaab ? ` · min $${s.minFaab}` : ''}`
      // Shown here as well as in /admin pings, because "why did nobody get pinged" is answered by
      // seeing at a glance that nothing is configured.
      + (pings.length
        ? `\n   pings: ${pings.map(([t, r]) => `${t} → <@&${r}>`).join(', ')}`
        : '\n   pings: none');
  });
  await i.editReply(lines.join('\n').slice(0, MAX_BODY));
}

/** Best-effort league name, so a binding reads as a league rather than an 19-digit id. */
async function leagueNameOf(leagueId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string } | null;
    return body?.name ?? null;
  } catch {
    return null;
  }
}

async function handleAdmin(i: ChatInputCommandInteraction): Promise<void> {
  const member = i.member;
  const perms =
    member && typeof member.permissions !== 'string' ? member.permissions.bitfield : null;
  if (!canAdminGuild(i.user.id, perms)) {
    await i.editReply(adminRefusalReason());
    return;
  }

  const sub = i.options.getSubcommand();
  const guildId = i.guildId!;

  if (sub === 'watch') {
    const leagueId = i.options.getString('league', true).trim();
    const channel = (i.options.getChannel('channel') ?? i.channel) as TextBasedChannel | null;
    if (!channel || !('id' in channel)) {
      await i.editReply('Pick a text channel.');
      return;
    }
    const name = await leagueNameOf(leagueId);
    if (!name) {
      // A typo'd league id would otherwise bind silently and simply never post anything.
      await i.editReply(`Sleeper does not know league \`${leagueId}\`. Check the id.`);
      return;
    }
    const created = watchLeague({ guildId, channelId: channel.id, leagueId, leagueName: name });
    await i.editReply(
      `Watching **${name}** in <#${created.channelId}>.\nTypes: ${created.eventTypes.join(', ')}`
      + `\nFailed waiver claims are hidden — \`/admin failed\` to change that.`,
    );
    return;
  }

  if (sub === 'unwatch') {
    const leagueId = i.options.getString('league', true).trim();
    await i.editReply(
      unwatchLeague(guildId, leagueId)
        ? `Stopped watching \`${leagueId}\`.`
        : `This server was not watching \`${leagueId}\`.`,
    );
    return;
  }

  if (sub === 'events') {
    const leagueId = i.options.getString('league', true).trim();
    const types = parseTypes(i.options.getString('types', true));
    if (!types) {
      await i.editReply(`Unknown type. Valid: ${TRANSACTION_TYPES.join(', ')} — or \`all\`.`);
      return;
    }
    await i.editReply(
      setEventTypes(guildId, leagueId, types)
        ? `\`${leagueId}\` now posts: ${types.join(', ')}`
        : `This server is not watching \`${leagueId}\`.`,
    );
    return;
  }

  if (sub === 'failed') {
    const leagueId = i.options.getString('league', true).trim();
    const include = i.options.getBoolean('include', true);
    await i.editReply(
      setIncludeFailed(guildId, leagueId, include)
        ? `Failed waiver claims are now ${include ? 'shown' : 'hidden'} for \`${leagueId}\`.`
        : `This server is not watching \`${leagueId}\`.`,
    );
    return;
  }

  if (sub === 'minfaab') {
    const leagueId = i.options.getString('league', true).trim();
    const amount = i.options.getInteger('amount', true);
    await i.editReply(
      setMinFaab(guildId, leagueId, amount)
        ? `Hiding waiver claims under $${Math.max(0, amount)} for \`${leagueId}\`.`
        : `This server is not watching \`${leagueId}\`.`,
    );
    return;
  }

  if (sub === 'pingrole') {
    const leagueId = i.options.getString('league', true).trim();
    const type = i.options.getString('type', true) as TransactionType;
    // A role OPTION, so Discord shows a picker of roles that already exist in the server. The bot
    // never creates or manages roles — it only mentions the one it is pointed at.
    const role = i.options.getRole('role');

    if (!setPingRole(guildId, leagueId, type, role?.id ?? null)) {
      await i.editReply(`This server is not watching \`${leagueId}\`.`);
      return;
    }
    if (!role) {
      await i.editReply(`No longer pinging anyone for **${type}**.`);
      return;
    }

    /*
     * Warn when the ping would post but not notify. Discord only delivers a role mention from a bot
     * if the role is mentionable or the bot holds Mention Everyone, and our invite deliberately does
     * not include that permission. A ping that silently fails to notify is worse than no ping,
     * because nobody finds out until they miss a trade.
     */
    const mentionable = 'mentionable' in role ? Boolean(role.mentionable) : false;
    const botCanMentionAll = i.guild?.members.me?.permissions.has('MentionEveryone') ?? false;
    const willNotify = mentionable || botCanMentionAll;

    await i.editReply(
      `Pinging <@&${role.id}> for **${type}** in \`${leagueId}\`.`
      + (willNotify
        ? ''
        : `\n\n⚠️ That role is **not mentionable**, so the mention will appear but nobody will be`
          + ` notified. Either tick *Allow anyone to @mention this role* in the role settings, or`
          + ` give me the *Mention @everyone, @here and All Roles* permission.`)
      + (type === 'free_agent' || type === 'waiver'
        ? `\n\nNote: that type fired ~34 times per league-week in real data. Expect a lot of pings.`
        : ''),
    );
    return;
  }

  if (sub === 'pings') {
    const leagueId = i.options.getString('league', true).trim();
    const existing = subscription(guildId, leagueId);
    if (!existing) {
      await i.editReply(`This server is not watching \`${leagueId}\`.`);
      return;
    }
    const entries = Object.entries(existing.pingRoles);
    await i.editReply(
      entries.length === 0
        ? `No roles are pinged for \`${leagueId}\`. Suggested: ${SUGGESTED_PING_TYPES.join(', ')}.`
        : `**Pings for \`${leagueId}\`**\n`
          + entries.map(([t, r]) => `${t} → <@&${r}>`).join('\n'),
    );
    return;
  }

  if (sub === 'link') {
    const user = i.options.getUser('user', true);
    const username = i.options.getString('username', true);
    const res = await adminLink({ discordUserId: user.id, username });
    await i.editReply(
      res.ok
        ? `Linked <@${user.id}> to **${res.data.linked?.displayName ?? username}**.`
        : `Could not link: ${res.error}`,
    );
    return;
  }

  if (sub === 'unlink') {
    const user = i.options.getUser('user', true);
    const res = await adminLink({ discordUserId: user.id, unlink: true });
    await i.editReply(res.ok ? `Unlinked <@${user.id}>.` : `Could not unlink: ${res.error}`);
    return;
  }

  if (sub === 'whois') {
    const user = i.options.getUser('user', true);
    const res = await adminWhois(user.id);
    if (!res.ok) {
      await i.editReply(`Could not look up: ${res.error}`);
      return;
    }
    await i.editReply(
      res.data.linked
        ? `<@${user.id}> is **${res.data.linked.displayName}** (\`${res.data.linked.username}\`).`
        : `<@${user.id}> is not linked.`,
    );
    return;
  }

  await i.editReply('Unknown subcommand.');
}

/**
 * Autocomplete for /bet, offering one entry per SIDE of each open market.
 *
 * Five matchups become ten choices — "edgecdec (-138) vs bingocss" — with the market id and side
 * encoded in the value. That is the whole reason this is an autocomplete rather than two options: a
 * side option would have to say "a" or "b", which means nothing to anybody, and a separate market
 * option would let someone pick a market and a side that do not go together.
 *
 * Only OPEN markets are offered. A closed one would be refused by placeWager anyway, but offering it
 * invites the refusal rather than preventing it.
 */
export async function handleAutocomplete(i: AutocompleteInteraction): Promise<void> {
  if (i.commandName !== 'bet' || !i.guildId) {
    await i.respond([]);
    return;
  }

  const leagues = resolveLeagues(i.guildId, i.channelId, null);
  if ('error' in leagues) {
    await i.respond([]);
    return;
  }

  const typed = i.options.getFocused().toLowerCase();
  const choices: { name: string; value: string }[] = [];

  for (const league of leagues) {
    const res = await fetchMarkets(league.leagueId);
    if (!res.ok) continue;
    for (const m of res.data.markets) {
      if (m.status !== 'open') continue;
      const a = m.nameA ?? 'A';
      const b = m.nameB ?? 'B';
      for (const [side, mine, theirs, price] of [
        ['a', a, b, m.priceA],
        ['b', b, a, m.priceB],
      ] as const) {
        const label = `${mine} (${americanOdds(price)}) vs ${theirs}`;
        if (typed && !label.toLowerCase().includes(typed)) continue;
        // Discord caps a choice name at 100 characters and allows 25 choices.
        choices.push({ name: label.slice(0, 100), value: `${m.marketId}:${side}` });
      }
    }
  }

  await i.respond(choices.slice(0, 25));
}

async function handleBet(i: ChatInputCommandInteraction): Promise<void> {
  const pick = i.options.getString('pick', true);
  const dollars = i.options.getNumber('amount', true);

  const [marketId, side] = pick.split(':');
  if (!marketId || (side !== 'a' && side !== 'b')) {
    // Someone typed free text instead of choosing from the list.
    await i.editReply('Pick one of the suggested options rather than typing your own.');
    return;
  }

  /*
   * Rounded to whole cents HERE, before it leaves the bot. Discord hands back a float, and
   * 12.50 * 100 is 1250.0000000000002 in binary floating point — passing that on would either be
   * rejected by the route's integer check or, worse, silently become a fractional cent in a ledger
   * where everything else is an integer.
   */
  const stakeCents = Math.round(dollars * 100);

  const res = await placeBet({ discordUserId: i.user.id, marketId, side, stakeCents });
  if (!res.ok) {
    await i.editReply(
      res.status === 404 && res.error === 'not_linked'
        ? 'You have not linked a Declan Dollars account yet — ask an admin to run `/admin link`.'
        : `❌ ${res.error}`,
    );
    return;
  }

  const { toWinCents, balanceCents } = res.data;
  await i.editReply(
    `✅ **${money(stakeCents)}** on your pick to win **${money(toWinCents)}**.`
    + `\nBankroll now ${money(balanceCents)}.`,
  );
}

export async function handleInteraction(i: ChatInputCommandInteraction): Promise<void> {
  if (!i.guildId) {
    await i.reply({ content: 'Use these commands in a server, not a DM.', ephemeral: true });
    return;
  }

  /*
   * Deferred immediately. Discord kills an interaction that is not answered within three seconds,
   * and several of these make two network calls (site plus Sleeper). Ephemeral for personal money
   * so a channel does not fill with other people's balances.
   */
  /*
   * A placed bet replies privately. The public announcement is the outbox's job, so posting here as
   * well would double up — and a REFUSAL ("stake exceeds your balance") should never be public.
   */
  const personal =
    i.commandName === 'balance' || i.commandName === 'slips' || i.commandName === 'bet';
  await i.deferReply({ ephemeral: personal || i.commandName === 'admin' });

  try {
    switch (i.commandName) {
      case 'balances': return await handleBalances(i);
      case 'balance': return await handleBalance(i);
      case 'slips': return await handleSlips(i);
      case 'markets': return await handleMarkets(i);
      case 'bet': return await handleBet(i);
      case 'standings': return await handleStandings(i);
      case 'watching': return await handleWatching(i);
      case 'admin': return await handleAdmin(i);
      default:
        await i.editReply('Unknown command.');
    }
  } catch (err) {
    // An unhandled rejection here would leave the user staring at "thinking…" forever.
    console.error('[bot] command failed', i.commandName, err);
    await i
      .editReply(`Something broke running that: ${err instanceof Error ? err.message : 'unknown'}`)
      .catch(() => undefined);
  }
}
