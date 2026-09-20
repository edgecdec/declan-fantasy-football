/**
 * Who may reconfigure the bot, and where.
 *
 * Two independent grants, because "owns the bot" and "runs this server" are different claims and
 * conflating them gets one of them wrong:
 *
 *  - `DISCORD_ADMIN_IDS` is global. That is the bot's operator, who must be able to fix any guild.
 *  - **Manage Server in the guild you are typing in** is local. Someone who invited the bot to
 *    their own server must be able to point it at their own channels, and must NOT thereby gain any
 *    say over anyone else's.
 *
 * The alternative — adding every such person to the global allowlist — would let each of them
 * rebind or unwatch every other guild's notifications. Bindings are keyed by guild, so local
 * authority is sufficient for local configuration, and that is where the line belongs.
 *
 * Nothing here grants access to MONEY. Reading balances is gated on the guild's bindings and, for a
 * personal figure, on having linked an account; placing bets is gated by the site's own rules via
 * `/api/bot/*`. An admin of a guild is an admin of its channel routing, nothing more.
 */

/**
 * Discord's MANAGE_GUILD bit (1 << 5), as a bitmask against the member's permissions.
 *
 * Built with BigInt() rather than a `5n` literal because tsconfig.json targets below ES2020, where
 * BigInt literals are a syntax error. The app build tolerates it (ignoreBuildErrors) but
 * `npm run typecheck` does not, and that is the gate that matters.
 */
export const MANAGE_GUILD = BigInt(1) << BigInt(5);

export function globalAdminIds(): Set<string> {
  const raw = process.env.DISCORD_ADMIN_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  );
}

export function isGlobalAdmin(userId: string): boolean {
  return globalAdminIds().has(userId);
}

/**
 * May this user configure the bot in this guild?
 *
 * `permissions` is the member's permission bitfield as Discord reports it for the guild the command
 * came from. Passed in rather than read here so this stays testable and so there is no way to
 * accidentally check the permissions of the wrong guild.
 *
 * Administrator implies Manage Server on Discord's side, so no separate check is needed for it.
 */
export function canAdminGuild(userId: string, permissions: bigint | null | undefined): boolean {
  if (isGlobalAdmin(userId)) return true;
  if (permissions == null) return false;
  return (permissions & MANAGE_GUILD) === MANAGE_GUILD;
}

/**
 * Explains a refusal, so a rejected command says what would be needed.
 *
 * A bare "you can't do that" invites a DM asking why; naming the permission lets someone with
 * Manage Server realise they are in the wrong channel, or the wrong server.
 */
export function adminRefusalReason(): string {
  return 'You need **Manage Server** in this server to configure the bot.';
}
