import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBetEvent, formatWeekSettled } from '../bot/src/betEventStream';
import type { BetEvent } from '../bot/src/siteApi';

/**
 * Announcing bets in a channel.
 *
 * Mostly about restraint. Every event in the outbox is real, but only some are worth a message, and
 * the two that are not — market_settled and line_moved — would between them post far more than
 * everything else combined.
 */

const event = (over: Partial<BetEvent> = {}): BetEvent => ({
  id: 1,
  type: 'wager_placed',
  leagueId: 'L1',
  season: 2026,
  week: 2,
  refId: 'w1',
  payload: {
    accountId: 'acct-1',
    stakeCents: 100,
    toWinCents: 25,
    legs: [{ marketId: 'm1', side: 'a', price: -393, nameA: 'AggressiveIyAvg', nameB: 'Coldst2EvaDoIt' }],
  },
  createdAt: '2026-09-20 06:00:00',
  bettorName: 'edgecdec',
  ...over,
});

test('a placement names the bettor, the pick, the price and the payout', () => {
  const embed = formatBetEvent(event(), 'edgecdec')!;
  assert.match(embed.title!, /Bet placed/);
  assert.match(embed.description!, /edgecdec/);
  assert.match(embed.description!, /\$1\.00/);
  // The SIDE that was backed, not just whichever name came first.
  assert.match(embed.description!, /AggressiveIyAvg/);
  assert.match(embed.description!, /-393/);
  assert.match(embed.description!, /\$0\.25/);
});

test('backing side b names side b', () => {
  const e = event({
    payload: {
      accountId: 'a',
      stakeCents: 500,
      toWinCents: 1495,
      legs: [{ marketId: 'm1', side: 'b', price: 299, nameA: 'AggressiveIyAvg', nameB: 'Coldst2EvaDoIt' }],
    },
  });
  const embed = formatBetEvent(e, 'someone')!;
  assert.match(embed.description!, /Coldst2EvaDoIt/);
  assert.ok(!/AggressiveIyAvg/.test(embed.description!), 'must not name the side they did not back');
  assert.match(embed.description!, /\+299/);
});

test('per-wager settlement events are SILENT — the digest replaces them', () => {
  /*
   * These used to post individually, which turned one week into twenty messages reading
   * "collected $56.50" with no indication of which matchup. They are still written to the outbox as
   * the audit trail; the readable version of a week is the single week_settled digest.
   */
  for (const type of ['wager_won', 'wager_lost', 'wager_void', 'market_settled', 'line_moved']) {
    assert.equal(
      formatBetEvent(event({ type, payload: { accountId: 'a', payoutCents: 125 } }), 'edgecdec'),
      null,
      `${type} must not post on its own`,
    );
  }
});

test('an unknown bettor degrades to "Someone" rather than undefined', () => {
  const embed = formatBetEvent(event(), null)!;
  assert.match(embed.description!, /Someone/);
  assert.ok(!/undefined|null/.test(embed.description!));
});

test('a payload missing its amounts is skipped rather than posting a broken message', () => {
  // Better to say nothing than to announce a bet of $0.00 to win $0.00.
  assert.equal(formatBetEvent(event({ payload: { accountId: 'a' } }), 'x'), null);
  assert.equal(formatBetEvent(event({ type: 'wager_won', payload: { accountId: 'a' } }), 'x'), null);
});

test('a placement with no legs still announces, without inventing a pick', () => {
  const embed = formatBetEvent(
    event({ payload: { accountId: 'a', stakeCents: 200, toWinCents: 180 } }),
    'edgecdec',
  )!;
  assert.match(embed.description!, /\$2\.00/);
  assert.match(embed.description!, /a matchup/);
});

test('a placement shows the MODEL probability, not the price-implied one', () => {
  /*
   * -124 implies 55.4% once the vig is included, but the model said 53.0%. Announcing the implied
   * figure would overstate the chance by about half the vig — quietly wrong in the house's favour,
   * which is the worst direction for a number in a betting channel.
   */
  const embed = formatBetEvent(
    event({
      payload: {
        accountId: 'a',
        stakeCents: 10000,
        toWinCents: 8065,
        legs: [{ marketId: 'm', side: 'a', price: -124, nameA: 'cemisme', nameB: 'kermason', probability: 0.53 }],
      },
    }),
    'edgecdec',
  )!;
  assert.match(embed.description!, /cemisme \(53\.0%\) at -124/);
  assert.ok(!/55\.4/.test(embed.description!), 'must not show the vigged implied probability');
});

test('an event written before probabilities were stored omits it rather than inventing one', () => {
  const embed = formatBetEvent(
    event({
      payload: {
        accountId: 'a',
        stakeCents: 100,
        toWinCents: 25,
        legs: [{ marketId: 'm', side: 'a', price: -393, nameA: 'AggressiveIyAvg', nameB: 'x' }],
      },
    }),
    'edgecdec',
  )!;
  assert.match(embed.description!, /AggressiveIyAvg at -393/);
  assert.ok(!/%/.test(embed.description!), 'no percentage rather than a derived one');
});

test('a nonsensical stored probability is ignored', () => {
  for (const bad of [0, 1, 1.5, -0.2, 'half']) {
    const embed = formatBetEvent(
      event({
        payload: {
          accountId: 'a',
          stakeCents: 100,
          toWinCents: 25,
          legs: [{ marketId: 'm', side: 'a', price: -110, nameA: 'x', nameB: 'y', probability: bad }],
        },
      }),
      'edgecdec',
    )!;
    assert.ok(!/%/.test(embed.description!), `should ignore probability=${bad}`);
  }
});

const digest = (over: Record<string, unknown> = {}): BetEvent =>
  event({
    type: 'week_settled',
    refId: 'L1:2',
    payload: {
      bets: [
        {
          bettor: 'egruis', pick: 'AggressiveIyAvg', against: 'cemisme',
          stakeCents: 25000, netCents: 21008, status: 'won',
          pickScore: 141.2, againstScore: 118.6,
        },
        {
          bettor: 'TheSebasDog', pick: 'kermason', against: 'edgecdec',
          stakeCents: 50000, netCents: -50000, status: 'lost',
          pickScore: 96.4, againstScore: 130.1,
        },
        {
          bettor: 'edgecdec', pick: 'cdalton3', against: 'pullmanguy',
          stakeCents: 1000, netCents: 0, status: 'void',
          pickScore: 110.0, againstScore: 110.0,
        },
      ],
      standings: [
        { bettor: 'egruis', stakeCents: 25000, netCents: 21008, won: 1, lost: 0, voided: 0 },
        { bettor: 'edgecdec', stakeCents: 1000, netCents: 0, won: 0, lost: 0, voided: 1 },
        { bettor: 'TheSebasDog', stakeCents: 50000, netCents: -50000, won: 0, lost: 1, voided: 0 },
      ],
      champion: { bettor: 'egruis', stakeCents: 25000, netCents: 21008, won: 1, lost: 0, voided: 0 },
      loser: { bettor: 'TheSebasDog', stakeCents: 50000, netCents: -50000, won: 0, lost: 1, voided: 0 },
      totalStakedCents: 76000,
      totalNetCents: -28992,
      betCount: 3,
      bettorCount: 3,
      ...over,
    },
  });

test('the digest is exactly two embeds: summary then every bet', () => {
  const out = formatWeekSettled(digest(), "Graham's Football Fantasy");
  assert.equal(out.length, 2);
  assert.match(out[0].title!, /week 2 betting/);
  assert.match(out[1].title!, /every bet/);
});

test('the summary names a champion and a loser', () => {
  const [summary] = formatWeekSettled(digest(), 'Test League');
  assert.match(summary.description!, /egruis/);
  assert.match(summary.description!, /\$210\.08/);
  assert.match(summary.description!, /TheSebasDog/);
  assert.match(summary.description!, /\$500\.00/);
  // Every bettor appears in the table with a record.
  assert.match(summary.description!, /1-0/);
  assert.match(summary.description!, /0-1/);
});

test('every listed bet NAMES ITS MATCHUP and score — the original complaint', () => {
  const [, detail] = formatWeekSettled(digest(), 'Test League');
  assert.match(detail.description!, /egruis\*\*.* on AggressiveIyAvg vs cemisme/);
  assert.match(detail.description!, /141\.2-118\.6/);
  // The winning pick's own score comes FIRST. Emitting the market's a/b order made a winning bet on
  // side b read as a bet on the loser.
  assert.match(detail.description!, /on AggressiveIyAvg vs cemisme \(141\.2-118\.6\)/);
  assert.match(detail.description!, /on kermason vs edgecdec \(96\.4-130\.1\)/);
  assert.match(detail.description!, /TheSebasDog\*\*.* on kermason vs edgecdec/);
  // And the outcome of each.
  assert.match(detail.description!, /\+210\.08/);
  assert.match(detail.description!, /-500\.00/);
});

test('a week where everybody lost claims no champion', () => {
  const [summary] = formatWeekSettled(
    digest({
      champion: null,
      standings: [{ bettor: 'a', stakeCents: 100, netCents: -100, won: 0, lost: 1, voided: 0 }],
    }),
    'Test League',
  );
  assert.match(summary.description!, /Nobody finished the week up/);
  assert.ok(!/👑 \*\*/.test(summary.description!), 'must not crown the least-bad result');
});

test('a push counts as zero, not as a loss', () => {
  const [summary] = formatWeekSettled(digest(), 'Test League');
  // edgecdec's only bet was void: 0-0 with a push noted, never 0-1.
  assert.match(summary.description!, /edgecdec\s+10\.00\s+0\.00\s+0-0 \(1 push\)/);
});

test('the house take is the mirror of the bettors net', () => {
  const [summary] = formatWeekSettled(digest(), 'Test League');
  // Bettors lost 289.92 between them, so the house made exactly that.
  assert.match(summary.footer!.text!, /bettors net -\$289\.92/);
  assert.match(summary.footer!.text!, /house \$289\.92/);
});

test('an empty digest posts nothing at all', () => {
  assert.deepEqual(formatWeekSettled(digest({ bets: [], standings: [] }), 'Test League'), []);
});
