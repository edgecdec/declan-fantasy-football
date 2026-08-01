"""
Script to generate redraft rankings from Sleeper player data AND projections.

Sleeper's own season-projections endpoint already breaks points out by format
(pts_std / pts_half_ppr / pts_ppr) and gives format-specific ADP (adp_std /
adp_half_ppr / adp_ppr), so -- unlike dynasty trade value -- we don't need a
third-party API for this. Tight End Premium isn't broken out by Sleeper, but
it's just an extra points-per-catch bonus for TEs, and the projection already
gives each TE's raw catch count (`rec`), so it's computed directly here.

Outputs one file per (ppr, tep) combination into data/redraft/ -- numQbs/
Superflex isn't a separate axis here (unlike dynasty) because redraft "value"
comes from our own VBD math at runtime, which already raises QB replacement
demand for a superflex draft's actual roster settings.
"""

import json
import os
import math
import requests
import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
PLAYERS_FILE = os.path.join(DATA_DIR, 'sleeper_players.json')
OUTPUT_DIR = os.path.join(DATA_DIR, 'redraft')

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

PPR_OPTIONS = [
    ('ppr0', 'pts_std', 'adp_std'),
    ('ppr0_5', 'pts_half_ppr', 'adp_half_ppr'),
    ('ppr1', 'pts_ppr', 'adp_ppr'),
]
# Representative extra points per TE catch for each tier (FantasyCalc's own
# thresholds are te+ = 0.5-1.0, te++ = "start 2 TE or >1.0" -- picking the
# midpoint/a representative high value for each bucket).
TEP_OPTIONS = [('te_none', 0), ('te_plus', 0.75), ('te_plus_plus', 1.25)]


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


def build_variant(players, projections, pts_field, adp_field, tep_bonus):
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

        adp = proj.get(adp_field)
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

    # Rank/tier follow real-world ADP, same as before -- ADP already reflects
    # actual draft-day positional value (e.g. QBs going later despite comparable
    # raw points), which raw projected_points alone doesn't capture. The TEP
    # bonus still shows up in projected_points (and therefore in VBD "Value"
    # once the app computes it), it just doesn't reorder the whole board.
    ranked_list.sort(key=lambda x: x['adp'] or 9999)
    pos_counts = {p: 0 for p in VALID_POSITIONS}
    for p in ranked_list:
        pos_counts[p['position']] += 1
        if p['projected_points'] is None:
            tier = math.ceil(pos_counts[p['position']] / 12)
            p['projected_points'] = estimate_points(p['position'], tier)

    final_rankings = []
    for i, p in enumerate(ranked_list):
        rank = i + 1
        final_rankings.append({
            'player_id': p['player_id'],
            'name': p['name'],
            'position': p['position'],
            'team': p['team'],
            'rank': rank,
            'tier': math.ceil(rank / 12),
            'projected_points': round(p['projected_points'], 1),
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
    for ppr_slug, pts_field, adp_field in PPR_OPTIONS:
        for tep_slug, tep_bonus in TEP_OPTIONS:
            key = f"{ppr_slug}_{tep_slug}"
            print(f"Building {key} ({pts_field}, TE bonus +{tep_bonus}/catch)...")
            rankings = build_variant(players, projections, pts_field, adp_field, tep_bonus)

            out_file = os.path.join(OUTPUT_DIR, f"redraft_{key}.json")
            with open(out_file, 'w') as f:
                json.dump(rankings, f, indent=2)
            print(f"  -> {len(rankings)} players saved to {out_file}")
            manifest.append(key)

    manifest_file = os.path.join(OUTPUT_DIR, 'manifest.json')
    with open(manifest_file, 'w') as f:
        json.dump(sorted(manifest), f, indent=2)
    print(f"Generated {len(manifest)} redraft rankings variants. Manifest saved to {manifest_file}")


if __name__ == "__main__":
    generate_rankings()
