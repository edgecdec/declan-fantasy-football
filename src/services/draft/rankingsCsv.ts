import { Player } from '@/services/draft/vbdService';

export type CsvMatchResult = {
  players: Player[];
  matchedCount: number;
  totalRows: number;
  unmatchedNames: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'player', 'player name', 'full name'],
  position: ['position', 'pos'],
  team: ['team', 'tm', 'nfl team'],
  rank: ['rank', 'overall rank', 'ovr', 'ecr', 'overall'],
  tier: ['tier'],
  projected_points: ['projected_points', 'projected points', 'points', 'proj', 'fpts', 'projection', 'pts'],
  adp: ['adp'],
  value: [
    'value', 'trade value', 'trade_value', 'dynasty value', 'dynasty_value',
    'value_1qb_ppr', 'ktc value', 'ktc_value', 'superflex value', 'sf value',
    '1qb value', 'redraft value', 'startup value', 'market value', 'trade_value_1qb',
  ],
};

const POSITION_ALIASES: Record<string, string> = {
  DST: 'DEF',
  'D/ST': 'DEF',
  PK: 'K',
};

const DEF_STRIP_PATTERN = /\b(d\/st|dst|defense|special teams|d st)\b/g;

/** Parses raw CSV text into rows of string cells, honoring quoted fields. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
  }

  return rows;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['.]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePosition(pos: string): string {
  const upper = pos.trim().toUpperCase();
  return POSITION_ALIASES[upper] || upper;
}

function detectColumns(headerRow: string[]): Record<string, number> {
  const normalizedHeaders = headerRow.map(h => h.trim().toLowerCase());
  const columns: Record<string, number> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalizedHeaders.findIndex(h => aliases.includes(h));
    if (idx !== -1) columns[field] = idx;
  }

  // Ranking exports label their value column all sorts of ways ("KTC Value",
  // "Superflex Trade Value", "1QB Value ($)", ...) -- fall back to a substring
  // match so we don't silently drop a value column just because its exact
  // header text isn't in our alias list.
  if (columns.value === undefined) {
    const idx = normalizedHeaders.findIndex(h => h.includes('value'));
    if (idx !== -1) columns.value = idx;
  }

  return columns;
}

type BaseIndex = {
  byNamePos: Map<string, Player>;
  byName: Map<string, Player[]>;
  defByAbbrev: Map<string, Player>;
  defByNickname: Map<string, Player>;
};

function buildMatchIndex(base: Player[]): BaseIndex {
  const byNamePos = new Map<string, Player>();
  const byName = new Map<string, Player[]>();
  const defByAbbrev = new Map<string, Player>();
  const defByNickname = new Map<string, Player>();

  for (const p of base) {
    const n = normalizeName(p.name);
    byNamePos.set(`${n}|${p.position}`, p);
    const arr = byName.get(n) || [];
    arr.push(p);
    byName.set(n, arr);

    if (p.position === 'DEF') {
      if (p.team) defByAbbrev.set(p.team.toLowerCase(), p);
      defByAbbrev.set(p.player_id.toLowerCase(), p);
      const nickname = n.split(' ').pop();
      if (nickname) defByNickname.set(nickname, p);
    }
  }

  return { byNamePos, byName, defByAbbrev, defByNickname };
}

function matchDefense(rawName: string, team: string | undefined, index: BaseIndex): Player | undefined {
  const stripped = normalizeName(rawName.replace(DEF_STRIP_PATTERN, ''));
  if (index.byNamePos.has(`${stripped}|DEF`)) return index.byNamePos.get(`${stripped}|DEF`);

  const candidateAbbrev = (team || '').trim().toLowerCase();
  if (candidateAbbrev && index.defByAbbrev.has(candidateAbbrev)) return index.defByAbbrev.get(candidateAbbrev);

  // Team code embedded in the name itself, e.g. "SF DST" or "PHI"
  const abbrevMatch = rawName.match(/\b[A-Za-z]{2,3}\b/);
  if (abbrevMatch && index.defByAbbrev.has(abbrevMatch[0].toLowerCase())) {
    return index.defByAbbrev.get(abbrevMatch[0].toLowerCase());
  }

  const nickname = stripped.split(' ').pop();
  if (nickname && index.defByNickname.has(nickname)) return index.defByNickname.get(nickname);

  return undefined;
}

function matchRow(name: string, position: string | undefined, team: string | undefined, index: BaseIndex): Player | undefined {
  const normPos = position ? normalizePosition(position) : undefined;

  if (normPos === 'DEF') {
    const match = matchDefense(name, team, index);
    if (match) return match;
  }

  const n = normalizeName(name);
  if (normPos) {
    const exact = index.byNamePos.get(`${n}|${normPos}`);
    if (exact) return exact;
  }

  const candidates = index.byName.get(n);
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  if (team) {
    const teamMatch = candidates.find(c => c.team?.toLowerCase() === team.trim().toLowerCase());
    if (teamMatch) return teamMatch;
  }

  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a rankings CSV and matches each row to a known player (via the bundled
 * default rankings, used purely as a name/position -> Sleeper player_id lookup)
 * so drafted-player filtering keeps working against Sleeper's player_ids.
 */
export function parseAndMatchRankingsCsv(csvText: string, baseRankings: Player[]): CsvMatchResult {
  const rows = parseCsvText(csvText);
  if (rows.length < 2) {
    throw new Error('CSV appears to be empty.');
  }

  const columns = detectColumns(rows[0]);
  if (columns.name === undefined) {
    throw new Error('Could not find a "name" column in the CSV.');
  }

  const index = buildMatchIndex(baseRankings);
  const players: Player[] = [];
  const unmatchedNames: string[] = [];
  const dataRows = rows.slice(1);

  dataRows.forEach((row, i) => {
    const name = (row[columns.name] || '').trim();
    if (!name) return;

    const position = columns.position !== undefined ? row[columns.position]?.trim() : undefined;
    const team = columns.team !== undefined ? row[columns.team]?.trim() : undefined;
    const rank = columns.rank !== undefined ? parseNumber(row[columns.rank]) : undefined;
    const tier = columns.tier !== undefined ? parseNumber(row[columns.tier]) : undefined;
    const projectedPoints = columns.projected_points !== undefined ? parseNumber(row[columns.projected_points]) : undefined;
    const adp = columns.adp !== undefined ? parseNumber(row[columns.adp]) : undefined;
    const customValue = columns.value !== undefined ? parseNumber(row[columns.value]) : undefined;

    const matched = matchRow(name, position, team, index);
    if (!matched) {
      unmatchedNames.push(name);
      return;
    }

    const finalRank = rank ?? i + 1;
    players.push({
      player_id: matched.player_id,
      name: matched.name,
      position: matched.position,
      team: matched.team,
      rank: finalRank,
      tier: tier ?? Math.ceil(finalRank / 12),
      projected_points: projectedPoints,
      adp,
      custom_value: customValue,
    });
  });

  // A "value" column only means something if every matched player has one --
  // otherwise some players would show a raw trade value (thousands) next to
  // others showing a computed VBD score (tens), which aren't comparable. If
  // coverage isn't complete, drop custom_value for the whole set so everyone
  // falls back to the same VBD calculation instead of mixing scales.
  if (columns.value !== undefined && players.some(p => p.custom_value === undefined)) {
    for (const p of players) delete p.custom_value;
  }

  players.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  return {
    players,
    matchedCount: players.length,
    totalRows: dataRows.filter(r => (r[columns.name] || '').trim()).length,
    unmatchedNames,
  };
}
