import test from 'node:test';
import assert from 'node:assert/strict';
import { luckButtonId, luckButtons, luckImageEmbed, parseLuckButtonId, renderLuckText } from '../bot/src/luckView';
import type { LuckResponse, LuckTeam } from '../bot/src/siteApi';

/**
 * /luck's sort buttons and the text table that stands in for the chart.
 *
 * The fallback must follow the buttons: a click that reorders the chart but not the text would leave
 * whoever is on the fallback looking at a "By luck" button that does nothing.
 */

const team = (name: string, actualWins: number, expectedWins: number): LuckTeam => ({
  name, teamName: null, actualWins, expectedWins, luck: actualWins - expectedWins, pointsFor: 1000, pointsAgainst: 1000,
});

const data: LuckResponse = {
  league: { leagueId: '1383248044669046784', name: "Graham's Football Fantasy", season: '2026' },
  weeksCounted: 7,
  teams: [team('cemisme', 2, 5.22), team('kermason', 6, 4.56), team('AggressiveIyAvg', 5, 3.33), team('Junebugge', 1, 1)],
};

/** Manager names in the order the text table lists them. */
const order = (e: ReturnType<typeof renderLuckText>) =>
  e.description!.split('\n').slice(2, -1).map(l => l.split(' ')[0]);

test('text fallback: expected wins by default order, luckiest first when sorted by luck', () => {
  assert.deepEqual(order(renderLuckText(data, 'xw')), ['cemisme', 'kermason', 'AggressiveIy', 'Junebugge']);
  assert.deepEqual(order(renderLuckText(data, 'luck')), ['AggressiveIy', 'kermason', 'Junebugge', 'cemisme']);
  assert.match(renderLuckText(data, 'xw').footer!.text, /^ranked by expected wins · /);
  assert.match(renderLuckText(data, 'luck').footer!.text, /^luckiest first · /);
  assert.ok(!renderLuckText(data, 'xw').footer!.text.includes('noise'));
  assert.ok(renderLuckText({ ...data, weeksCounted: 2 }, 'xw').footer!.text.includes('treat as noise'));
});

test('button ids carry the league and the sort, and nothing else parses', () => {
  const id = luckButtonId(data.league.leagueId, 'luck');
  assert.equal(id, 'lk:1383248044669046784:luck');
  assert.ok(id.length <= 100);
  assert.deepEqual(parseLuckButtonId(id), { leagueId: '1383248044669046784', sort: 'luck' });
  assert.deepEqual(parseLuckButtonId('lk:123:xw'), { leagueId: '123', sort: 'xw' });
  assert.equal(parseLuckButtonId('lk:123:edge'), null);
  assert.equal(parseLuckButtonId('mu:123:3:8:slot'), null);
  assert.equal(parseLuckButtonId('lk::luck'), null);
});

test('the active order is the disabled button, so the pair labels what is on screen', () => {
  for (const sort of ['xw', 'luck'] as const) {
    const [xw, luck] = luckButtons(data.league.leagueId, sort).toJSON().components as {
      custom_id: string; label: string; disabled?: boolean;
    }[];
    assert.equal(xw.label, 'By expected wins');
    assert.equal(luck.label, 'By luck');
    assert.equal(Boolean(xw.disabled), sort === 'xw');
    assert.equal(Boolean(luck.disabled), sort === 'luck');
    assert.deepEqual(parseLuckButtonId(luck.custom_id), { leagueId: data.league.leagueId, sort: 'luck' });
  }
});

test('the chart frame points at the attachment', () => {
  const e = luckImageEmbed(data, 'luck.png');
  assert.equal(e.title, "Graham's Football Fantasy — luck through 7 weeks");
  assert.deepEqual(e.image, { url: 'attachment://luck.png' });
});
