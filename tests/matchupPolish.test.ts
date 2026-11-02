import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  biggestSwing, matchupAssetUrls, matchupImageHeight, playerLabel, renderMatchupImage, renderMatchupPng,
  type ImageMatchup, type ImageSlot,
} from '@/lib/betting/matchupImage';
import { initials } from '@/lib/betting/imageKit';
import {
  avatarUrl, fetchImage, fetchImages, headshotUrl, imageCacheStats, setImageFetcherForTests, sniffImageType, teamLogoUrl,
} from '@/lib/betting/imageAssets';

/**
 * The polished /matchup card and the pictures it fetches.
 *
 * Two failure modes matter more than any pixel. A picture that will not decode must not take the
 * card down — Sleeper's CDN mislabels its own files, and the first live render died on "Invalid
 * JPEG". And the fetcher must stay small on a box that already runs out of memory: a cap on
 * concurrent requests, a timeout, a size limit, and a bounded cache.
 */

/** A real 2×2 PNG, built by hand so the test needs no fixture file and no network. */
function tinyPng(): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const slot = (over: Partial<ImageSlot>): ImageSlot => ({
  slot: 'RB', playerId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF',
  points: 20, projectedPoints: 18, expectedPoints: 20, gameState: 'post', gameDetail: 'W 30-20 vs MIA', ...over,
});

const matchup = (status: ImageMatchup['status'], over: Partial<ImageMatchup> = {}): ImageMatchup => ({
  league: { name: "Graham's Football Fantasy" },
  week: 8,
  status,
  winProbability: 0.7,
  me: {
    displayName: 'edgecdec', teamName: 'CemIsntMe', avatar: 'c96b606b3fc5cc93aacb69e5d1d6a977',
    banked: 101, projected: 120, playersRemaining: 1,
    lineup: [
      slot({ slot: 'QB', points: 25, expectedPoints: 25 }),
      slot({ slot: 'RB', playerId: '9509', name: 'Rhamondre Stevenson', position: 'RB', gameState: 'in', points: 6, expectedPoints: 14,
        live: { clock: 'Q3 3:40', hasBall: true, redZone: true, where: 'vs PHI' } }),
      slot({ slot: 'DEF', playerId: 'KC', name: 'Kansas City Chiefs', position: 'DEF', team: 'KC', points: 4, expectedPoints: 4 }),
    ],
    bestBench: slot({ slot: 'BN', playerId: '1234', name: 'Bench Guy', points: 18.4, expectedPoints: 18.4 }),
  },
  opponent: {
    displayName: 'cdalton3', teamName: null, avatar: null, banked: 90, projected: 110, playersRemaining: 2,
    lineup: [
      slot({ slot: 'QB', playerId: '6904', name: 'Jalen Hurts', team: 'PHI', points: 21, expectedPoints: 21 }),
      slot({ slot: 'RB', playerId: '8150', name: 'Kyren Williams', position: 'RB', gameState: 'pre', points: 0, expectedPoints: 15, projectedPoints: 15 }),
      slot({ slot: 'DEF', name: null, playerId: null }),
    ],
    bestBench: null,
  },
  ...over,
});

test('every state renders, at the height the layout computes, with and without pictures', async () => {
  const pic = `data:image/png;base64,${tinyPng().toString('base64')}`;
  for (const status of ['not_started', 'live', 'between', 'final'] as const) {
    for (const assets of [{}, Object.fromEntries(Object.keys(matchupAssetUrls(matchup(status))).map(k => [k, pic]))]) {
      const buf = Buffer.from(await renderMatchupImage(matchup(status), 'slot', assets).arrayBuffer());
      assert.equal(sniffImageType(buf), 'image/png');
      assert.equal(buf.readUInt32BE(16), 760);
      assert.equal(buf.readUInt32BE(20), matchupImageHeight(matchup(status)), status);
    }
  }
});

test('a picture that will not decode costs the picture, not the card', async () => {
  // Labelled JPEG, is not: exactly what Sleeper's CDN serves for some files.
  const bad = { 'player:4984': `data:image/jpeg;base64,${tinyPng().toString('base64')}` };
  await assert.rejects(renderMatchupImage(matchup('final'), 'slot', bad).arrayBuffer());
  const buf = Buffer.from(await renderMatchupPng(matchup('final'), 'slot', bad));
  assert.equal(sniffImageType(buf), 'image/png');
  assert.equal(buf.readUInt32BE(20), matchupImageHeight(matchup('final')));
});

test('the bench row and the swing band only appear when there is something to show', () => {
  const none = matchup('final', {
    me: { ...matchup('final').me, bestBench: null, lineup: [slot({ expectedPoints: 10 })] },
    opponent: { ...matchup('final').opponent, lineup: [slot({ expectedPoints: 10 })] },
  });
  // 72 per lineup row, then 64 for the bench row and 50 for the swing band.
  assert.equal(matchupImageHeight(matchup('final')) - matchupImageHeight(none), 2 * 72 + 64 + 50);
});

test('biggest swing: the largest edge, called a projection before kickoff', () => {
  const rows = [{ index: 0, slot: 'QB', edge: 4 }, { index: 1, slot: 'TE', edge: -10.6 }, { index: 2, slot: 'K', edge: 1 }];
  assert.equal(biggestSwing(rows, 'live')!.row.slot, 'TE');
  assert.equal(biggestSwing(rows, 'live')!.label, 'Biggest swing');
  assert.equal(biggestSwing(rows, 'not_started')!.label, 'Biggest projected edge');
  assert.equal(biggestSwing([{ index: 0, slot: 'QB', edge: 0.01 }], 'live'), null, 'nothing to call out');
});

test('names that fit: initial and surname, defences by nickname, whitespace collapsed', () => {
  assert.equal(playerLabel('Josh Allen', 17), 'Josh Allen');
  assert.equal(playerLabel('Rhamondre Stevenson', 17), 'R. Stevenson');
  assert.equal(playerLabel('Kenneth  Walker III', 17), 'K. Walker III');
  assert.equal(playerLabel('Kansas City Chiefs', 17, 'KC', 'DEF'), 'KC Chiefs');
  assert.equal(initials('Josh Allen'), 'JA');
  assert.equal(initials('edgecdec'), 'ED');
  assert.equal(initials("D'Andre Swift"), 'DS');
});

test('asset URLs: Sleeper CDN only, plain ids only, a logo for a defence', () => {
  const urls = matchupAssetUrls(matchup('live'));
  assert.equal(urls['avatar:me'], 'https://sleepercdn.com/avatars/thumbs/c96b606b3fc5cc93aacb69e5d1d6a977');
  assert.equal(urls['avatar:opponent'], null);
  assert.equal(urls['player:4984'], 'https://sleepercdn.com/content/nfl/players/thumb/4984.jpg');
  assert.equal(urls['team:KC'], 'https://sleepercdn.com/images/team_logos/nfl/kc.png');
  assert.ok(!('player:null' in urls), 'an empty slot asks for nothing');
  assert.equal(avatarUrl('../../etc/passwd'), null);
  assert.equal(headshotUrl('1234?x=1'), null);
  assert.equal(teamLogoUrl('KC/../../x'), null);
});

test('sniffing trusts the bytes, not the label', () => {
  assert.equal(sniffImageType(tinyPng()), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<html>forbidden</html>')), null);
  assert.equal(sniffImageType(Buffer.from('RIFF....WEBP')), null);
});

const respond = (body: Buffer, type = 'image/jpeg', status = 200) =>
  new Response(new Uint8Array(body), { status, headers: { 'content-type': type } });

test('fetchImage: data URI typed by its bytes; misses, oversize and non-CDN refused; results cached', async () => {
  let calls = 0;
  setImageFetcherForTests(async input => {
    calls++;
    const url = String(input);
    if (url.includes('missing')) return respond(Buffer.from('<html/>'), 'text/html', 403);
    if (url.includes('huge')) return respond(Buffer.concat([tinyPng(), Buffer.alloc(200_000)]));
    return respond(tinyPng(), 'image/jpeg'); // mislabelled, like the real CDN
  });
  try {
    const ok = await fetchImage('https://sleepercdn.com/content/nfl/players/thumb/1.jpg');
    assert.ok(ok?.startsWith('data:image/png;base64,'), 'typed from the bytes, not the header');
    assert.equal(await fetchImage('https://sleepercdn.com/content/nfl/players/thumb/1.jpg'), ok);
    assert.equal(calls, 1, 'second request served from cache');

    assert.equal(await fetchImage('https://sleepercdn.com/content/nfl/players/thumb/missing.jpg'), null);
    assert.equal(await fetchImage('https://sleepercdn.com/content/nfl/players/thumb/missing.jpg'), null);
    assert.equal(calls, 2, 'a miss is remembered too');

    assert.equal(await fetchImage('https://sleepercdn.com/content/nfl/players/thumb/huge.jpg'), null);
    assert.equal(await fetchImage('https://example.com/evil.png'), null);
    assert.equal(calls, 3, 'a non-CDN URL is never fetched');
  } finally {
    setImageFetcherForTests(null);
  }
});

test('fetchImages: never more than four requests in flight, and a slow one times out to null', async () => {
  let inflight = 0;
  let peak = 0;
  setImageFetcherForTests(async (input, init) => {
    inflight++;
    peak = Math.max(peak, inflight);
    try {
      if (String(input).includes('slow')) {
        await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      await new Promise(r => setTimeout(r, 5));
      return respond(tinyPng(), 'image/png');
    } finally {
      inflight--;
    }
  }, { timeoutMs: 50 });
  try {
    const urls: Record<string, string> = {};
    for (let i = 0; i < 20; i++) urls[`p${i}`] = `https://sleepercdn.com/content/nfl/players/thumb/${i}.jpg`;
    urls.slow = 'https://sleepercdn.com/content/nfl/players/thumb/slow.jpg';
    const out = await fetchImages(urls);
    assert.equal(out.slow, null);
    assert.equal(Object.values(out).filter(Boolean).length, 20);
    assert.ok(peak <= 4, `peak concurrency ${peak}`);
    assert.equal(imageCacheStats().inflight, 0);
  } finally {
    setImageFetcherForTests(null);
  }
});
