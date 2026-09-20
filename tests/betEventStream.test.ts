import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBetEvent } from '../bot/src/betEventStream';
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

test('a win reports the payout and the profit separately', () => {
  const embed = formatBetEvent(
    event({ type: 'wager_won', payload: { accountId: 'a', payoutCents: 125, profitCents: 25 } }),
    'edgecdec',
  )!;
  assert.match(embed.title!, /won/i);
  assert.match(embed.description!, /\$1\.25/);
  assert.match(embed.description!, /\$0\.25 profit/);
});

test('a loss and a void both read correctly', () => {
  const lost = formatBetEvent(
    event({ type: 'wager_lost', payload: { accountId: 'a', stakeCents: 500 } }),
    'egruis',
  )!;
  assert.match(lost.title!, /lost/i);
  assert.match(lost.description!, /egruis/);
  assert.match(lost.description!, /\$5\.00/);

  const voided = formatBetEvent(
    event({ type: 'wager_void', payload: { accountId: 'a', refundedCents: 500, reason: 'tie' } }),
    'egruis',
  )!;
  assert.match(voided.title!, /void/i);
  assert.match(voided.description!, /\$5\.00\*\* back/);
  assert.match(voided.description!, /tied/);
});

test('market_settled and line_moved stay silent', () => {
  /*
   * market_settled carries no bettor and fires once per market, so it adds nothing to the per-wager
   * results beside it. line_moved rides the 60-second tick and is the highest-volume event in the
   * system — posting it unthrottled would drown everything else.
   */
  assert.equal(formatBetEvent(event({ type: 'market_settled' }), null), null);
  assert.equal(formatBetEvent(event({ type: 'line_moved' }), null), null);
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
