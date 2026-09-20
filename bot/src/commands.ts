import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from 'discord.js';
import { adminRefusalReason, canAdminGuild } from './permissions';
import {
  DEFAULT_EVENT_TYPES,
  TRANSACTION_TYPES,
  setEventTypes,
  setIncludeFailed,
  setMinFaab,
  subscription,
  subscriptionsForGuild,
  unwatchLeague,
  watchLeague,
  type TransactionType,
} from './subscriptions';
import { adminLink, adminWhois, fetchLeaderboard, fetchMe } from './siteApi';
import { money, padLeft, pad, percent, signedMoney } from './format';

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
 * Resolves which league a read command is about.
 *
 * An explicit option must still be one this guild watches — otherwise passing an arbitrary id would
 * read any league's balances from any server, which is precisely the leak the binding model exists
 * to prevent.
 */
function resolveLeague(
  guildId: string,
  explicit: string | null,
): { leagueId: string; leagueName: string | null } | { error: string } {
  const subs = subscriptionsForGuild(guildId);
  if (subs.length === 0) {
    return { error: 'This server is not watching any leagues yet. An admin can run `/admin watch`.' };
  }
  if (explicit) {
    const match = subs.find(s => s.leagueId === explicit);
    if (!match) return { error: 'This server is not watching that league.' };
    return { leagueId: match.leagueId, leagueName: match.leagueName };
  }
  if (subs.length > 1) {
    const list = subs.map(s => `\`${s.leagueId}\`${s.leagueName ? ` — ${s.leagueName}` : ''}`);
    return { error: `This server watches several leagues. Pick one:\n${list.join('\n')}` };
  }
  return { leagueId: subs[0].leagueId, leagueName: subs[0].leagueName };
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
  const resolved = resolveLeague(i.guildId!, i.options.getString('league'));
  if ('error' in resolved) {
    await i.editReply(resolved.error);
    return;
  }

  const res = await fetchLeaderboard(resolved.leagueId, i.user.id);
  if (!res.ok) {
    // A league with no betting enabled is the common case here, and worth saying plainly.
    await i.editReply(
      res.status === 404
        ? 'That league does not have Declan Dollars enabled.'
        : `Could not read standings: ${res.error}`,
    );
    return;
  }

  const { standings, league } = res.data;
  const lines = [
    `${pad('manager', 16)}${padLeft('worth', 12)}${padLeft('balance', 12)}${padLeft('open', 9)}`,
  ];
  for (const s of standings) {
    lines.push(
      pad(s.isMe ? `${s.displayName} *` : s.displayName, 16)
        + padLeft(money(s.equityCents), 12)
        + padLeft(money(s.balanceCents), 12)
        + padLeft(s.openCount ? money(s.openStakeCents) : '—', 9),
    );
  }
  // Ranked on live worth, matching the website: a balance alone ranks whoever has bet least
  // highest mid-slate, because a stake leaves the balance at placement.
  const body = ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY);
  await i.editReply(`**${league.label}** — ranked on live worth\n${body}`);
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
  const resolved = resolveLeague(i.guildId!, i.options.getString('league'));
  if ('error' in resolved) {
    await i.editReply(resolved.error);
    return;
  }

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
  const lines = subs.map(s =>
    `<#${s.channelId}> ← \`${s.leagueId}\`${s.leagueName ? ` (${s.leagueName})` : ''}`
    + `\n   types: ${s.eventTypes.join(', ')}`
    + `${s.includeFailed ? ' · incl. failed' : ''}${s.minFaab ? ` · min $${s.minFaab}` : ''}`,
  );
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
  const personal = i.commandName === 'balance' || i.commandName === 'slips';
  await i.deferReply({ ephemeral: personal || i.commandName === 'admin' });

  try {
    switch (i.commandName) {
      case 'balances': return await handleBalances(i);
      case 'balance': return await handleBalance(i);
      case 'slips': return await handleSlips(i);
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
