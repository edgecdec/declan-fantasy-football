"""
Script to generate redraft rankings.

Points and rank/ADP come from Sleeper's own season-projections endpoint, which
breaks points out by format (pts_std / pts_half_ppr / pts_ppr) and gives both
format-specific ADP and real community-sourced 2QB/Superflex ADP (adp_2qb) --
e.g. Lamar Jackson: pick 3 overall in adp_2qb vs pick 22 in adp_ppr.

The displayed "Value" isn't raw projected points, though -- positions score
very differently (a top QB puts up far more raw points than a top RB without
being more valuable in a 1QB league), so points alone isn't a fair value
metric. FantasyCalc's public API also publishes REDRAFT trade values
(isDynasty=false, confirmed real via the same numQbs/ppr/tep params dynasty
uses), which already account for positional scarcity properly, the same way
its dynasty values do. FantasyCalc only tracks the ~200 most trade-relevant
players though, so remaining players' value tapers smoothly toward 0 from
the lowest real value FC gives for that scenario, ordered by our own ADP --
which is accurate: deep bench/waiver players genuinely have ~no trade value.

Tight End Premium isn't broken out by Sleeper's points fields, but it's just
an extra points-per-catch bonus for TEs, and the projection already gives
each TE's raw catch count (`rec`), so it's computed directly for the points
field (FantasyCalc's own tep param separately adjusts the Value field).

Outputs one file per (numQbs, ppr, tep) combination into data/redraft/,
mirroring the dynasty rankings matrix.
"""

import json
import os
import math
import requests
import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
PLAYERS_FILE = os.path.join(DATA_DIR, 'sleeper_players.json')
OUTPUT_DIR = os.path.join(DATA_DIR, 'redraft')
FANTASYCALC_BASE_URL = "https://api.fantasycalc.com/values/current"

VALID_POSITIONS = {'QB', 'RB', 'WR', 'TE', 'K', 'DEF'}

# Fallback point estimates by position/tier, used only for players Sleeper has no
# projection for (deep bench/fringe) -- one generic curve reused across every ppr
# bucket, since the exact PPR value barely matters that far down the board.
TIER_POINTS = {
    'QB': {1: 350, 2: 320, 3: 290, 4: 260, 5: 240, 6: 220, 7: 200, 8: 180},
    'RB': {1: 300, 2: 260, 3: 220, 4: 190, 5: 160, 6: 140, 7: 120, 8: 100},
    'WR': {1: 300, 2: 260, 3: 230, 4: 200, 5: 170, 6: 150, 7: 130, 8: 110},
    'TE': {1: 220, 2: 170, 3: 140, 4: 120, 5: 100, 6: 90, 7: 80, 8: 70},
    'K': {1: 150, 2: 140, 3: 135, 4: 130, 5: 125, 6: 120, 7: 115, 8: 110},
    'DEF': {1: 160, 2: 150, 3: 140, 4: 130, 5: 120, 6: 110, 7: 105, 8: 100}
}

NUM_QBS_OPTIONS = [1, 2]
PPR_OPTIONS = [
    ('ppr0', 'pts_std', 'adp_std', 0),
    ('ppr0_5', 'pts_half_ppr', 'adp_half_ppr', 0.5),
    ('ppr1', 'pts_ppr', 'adp_ppr', 1),
]
# Representative extra points per TE catch for each tier (FantasyCalc's own
# thresholds are te+ = 0.5-1.0, te++ = "start 2 TE or >1.0" -- picking the
# midpoint/a representative high value for each bucket).
TEP_OPTIONS = [('te_none', 0, 'none'), ('te_plus', 0.75, 'te+'), ('te_plus_plus', 1.25, 'te++')]


def estimate_points(position, tier):
    table = TIER_POINTS.get(position, {})
    if tier in table:
        return table[tier]
    base = table.get(8, 50)
    return max(10, base - (tier - 8) * 10)


def fetch_projections(season):
    url = f"https://api.sleeper.app/v1/projections/nfl/regular/{season}"
    print(f"Fetching projections from {url}...")
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Warning: Failed to fetch projections: {e}")
        return {}


def fetch_redraft_values(num_qbs, ppr, tep):
    params = {'isDynasty': 'false', 'numQbs': num_qbs, 'numTeams': 12, 'ppr': ppr, 'tep': tep}
    resp = requests.get(FANTASYCALC_BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    values = {}
    for entry in resp.json():
        sid = entry.get('player', {}).get('sleeperId')
        if sid:
            values[sid] = entry.get('value') or 0
    return values


def load_players_and_projections():
    print("Loading player database...")
    with open(PLAYERS_FILE, 'r') as f:
        data = json.load(f)
    players = data.get('players', {})
    season = data.get('season', str(datetime.date.today().year))

    projections = fetch_projections(season)
    if not projections:
        print("Empty projections, trying previous year...")
        projections = fetch_projections(str(int(season) - 1))

    print(f"Loaded {len(players)} players with {len(projections)} projections.")
    return players, projections


def build_variant(players, projections, pts_field, adp_field, tep_bonus, num_qbs, fc_values):
    ranked_list = []
    for pid, p in players.items():
        if not p.get('active'):
            continue
        pos = p.get('position')
        if pos not in VALID_POSITIONS:
            continue

        proj = projections.get(pid, {})
        pts = proj.get(pts_field)
        if pts is not None and pos == 'TE':
            pts += proj.get('rec', 0) * tep_bonus

        # adp_2qb is real community-sourced 2QB/Superflex ADP -- not split by
        # ppr (community doesn't track that granularly), so it's used as-is
        # for every ppr bucket in the 2qb variant.
        adp = proj.get('adp_2qb') if num_qbs == 2 else proj.get(adp_field)
        if adp is None or adp == 999:
            adp = p.get('search_rank', 9999)

        ranked_list.append({
            'player_id': pid,
            'name': f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or p.get('full_name', 'Unknown'),
            'position': pos,
            'team': p.get('team') or 'FA',
            'adp': adp,
            'projected_points': pts,
            'is_estimated': pts is None,
        })

    # Rank/tier follow real ADP for the scenario (1QB or 2QB) -- ADP already
    # reflects actual draft-day positional value (e.g. QBs going much earlier
    # in a 2QB league), which raw projected_points alone doesn't capture.
    ranked_list.sort(key=lambda x: x['adp'] or 9999)

    # Fallback estimate uses each player's overall-board tier (same value the
    # final `tier` field gets), not a within-position count -- positions like
    # QB in a 1QB league have very few real projections early on, so counting
    # "Nth QB seen so far" mislabels an unprojected deep-bench/rookie QB as
    # tier 1 (elite) just because few real QBs happened to precede them.
    for i, p in enumerate(ranked_list):
        if p['projected_points'] is None:
            tier = math.ceil((i + 1) / 12)
            p['projected_points'] = estimate_points(p['position'], tier)

    lowest_fc_value = min(fc_values.values()) if fc_values else 0
    # Rank of the worst player FantasyCalc actually covers, in our ADP order --
    # beyond this, taper their value down to 0 by the end of the board.
    last_fc_rank = 0
    for i, p in enumerate(ranked_list):
        if p['player_id'] in fc_values:
            last_fc_rank = i + 1
    tail_length = max(1, len(ranked_list) - last_fc_rank)

    final_rankings = []
    for i, p in enumerate(ranked_list):
        rank = i + 1
        fc_value = fc_values.get(p['player_id'])
        if fc_value is not None:
            value = fc_value
        elif rank <= last_fc_rank:
            # FC skipped this specific player but covers others around this
            # rank -- floor it at the lowest real value seen rather than 0.
            value = lowest_fc_value
        else:
            frac = (rank - last_fc_rank) / tail_length
            value = max(0, lowest_fc_value * (1 - frac))

        final_rankings.append({
            'player_id': p['player_id'],
            'name': p['name'],
            'position': p['position'],
            'team': p['team'],
            'rank': rank,
            'tier': math.ceil(rank / 12),
            'projected_points': round(p['projected_points'], 1),
            'custom_value': round(value, 1),
            'adp': round(p['adp'], 1) if p['adp'] and p['adp'] < 5000 else None,
            'is_estimated': p['is_estimated'],
        })

    return final_rankings


def generate_rankings():
    if not os.path.exists(PLAYERS_FILE):
        print(f"Error: {PLAYERS_FILE} not found. Run update_players.py first.")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    players, projections = load_players_and_projections()

    manifest = []
    for num_qbs in NUM_QBS_OPTIONS:
        for ppr_slug, pts_field, adp_field, ppr_value in PPR_OPTIONS:
            for tep_slug, tep_bonus, tep_param in TEP_OPTIONS:
                key = f"{num_qbs}qb_{ppr_slug}_{tep_slug}"
                print(f"Building {key} ({pts_field}, adp={'adp_2qb' if num_qbs == 2 else adp_field}, TE bonus +{tep_bonus}/catch)...")

                fc_values = fetch_redraft_values(num_qbs, ppr_value, tep_param)
                rankings = build_variant(players, projections, pts_field, adp_field, tep_bonus, num_qbs, fc_values)

                out_file = os.path.join(OUTPUT_DIR, f"redraft_{key}.json")
                with open(out_file, 'w') as f:
                    json.dump(rankings, f, indent=2)
                print(f"  -> {len(rankings)} players saved ({len(fc_values)} with real FantasyCalc value) to {out_file}")
                manifest.append(key)

    manifest_file = os.path.join(OUTPUT_DIR, 'manifest.json')
    with open(manifest_file, 'w') as f:
        json.dump(sorted(manifest), f, indent=2)
    print(f"Generated {len(manifest)} redraft rankings variants. Manifest saved to {manifest_file}")


if __name__ == "__main__":
    generate_rankings()
