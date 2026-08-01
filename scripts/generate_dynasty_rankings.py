"""
Script to generate dynasty rankings across the scenarios that actually change a
player's dynasty trade value: number of guaranteed-startable QBs (1 vs Superflex/2QB),
PPR (0 / 0.5 / 1), and Tight End Premium (none / te+ / te++).

FantasyCalc's public API (api.fantasycalc.com) supports all three as real params --
isDynasty, numQbs, ppr, and tep -- confirmed by comparing live site output against
raw API responses. tep's accepted values are the literal strings "none", "te+",
"te++" (found by inspecting FantasyCalc's own client bundle; passing a number 404s).
It already includes each player's Sleeper player_id, so no name-matching is needed.

FantasyCalc doesn't value K/DEF (no dynasty trade value) in any scenario, so those
are carried over from the redraft rankings (generate_rankings.py) with
custom_value: 0 -- see rationale in that block below.
"""

import json
import math
import os
import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
REDRAFT_RANKINGS_FILE = os.path.join(DATA_DIR, 'redraft', 'redraft_1qb_ppr1_te_none.json')
OUTPUT_DIR = os.path.join(DATA_DIR, 'dynasty')
FANTASYCALC_BASE_URL = "https://api.fantasycalc.com/values/current"

NUM_QBS_OPTIONS = [1, 2]
PPR_OPTIONS = [('ppr0', 0), ('ppr0_5', 0.5), ('ppr1', 1)]
TEP_OPTIONS = [('te_none', 'none'), ('te_plus', 'te+'), ('te_plus_plus', 'te++')]


def variant_key(num_qbs: int, ppr_slug: str, tep_slug: str) -> str:
    return f"{num_qbs}qb_{ppr_slug}_{tep_slug}"


def fetch_dynasty_values(num_qbs: int, ppr: float, tep: str):
    params = {
        'isDynasty': 'true',
        'numQbs': num_qbs,
        'numTeams': 12,
        'ppr': ppr,
        'tep': tep,
    }
    resp = requests.get(FANTASYCALC_BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def build_rankings(raw, kickers_and_def):
    players = []
    for entry in raw:
        p = entry.get('player', {})
        if p.get('position') == 'PICK':
            continue
        sleeper_id = p.get('sleeperId')
        if not sleeper_id:
            continue
        players.append({
            'player_id': sleeper_id,
            'name': p.get('name'),
            'position': p.get('position'),
            'team': p.get('maybeTeam') or 'FA',
            'dynasty_value': entry.get('value') or 0,
        })

    players.sort(key=lambda x: -x['dynasty_value'])

    final_rankings = []
    for i, p in enumerate(players):
        rank = i + 1
        final_rankings.append({
            'player_id': p['player_id'],
            'name': p['name'],
            'position': p['position'],
            'team': p['team'],
            'rank': rank,
            'tier': math.ceil(rank / 12),
            # Real FantasyCalc trade value, not just a tier bucket -- without this
            # the app falls back to estimating points from tier alone, which gives
            # every player in the same tier an identical (wrong) displayed value.
            'custom_value': p['dynasty_value'],
        })

    next_rank = len(final_rankings) + 1
    for i, p in enumerate(kickers_and_def):
        rank = next_rank + i
        final_rankings.append({
            'player_id': p['player_id'],
            'name': p['name'],
            'position': p['position'],
            'team': p['team'],
            'rank': rank,
            'tier': math.ceil(rank / 12),
            # K/DEF have no real dynasty trade value in any FantasyCalc scenario,
            # but every other entry here carries custom_value -- mixing that with a
            # computed VBD score would put K/DEF on a different, incomparable scale.
            # 0 keeps them last while keeping units consistent across the set.
            'custom_value': 0,
        })

    return final_rankings


def load_kickers_and_def():
    try:
        with open(REDRAFT_RANKINGS_FILE, 'r') as f:
            redraft = json.load(f)
        return [p for p in redraft if p['position'] in ('K', 'DEF')]
    except FileNotFoundError:
        print(f"Warning: {REDRAFT_RANKINGS_FILE} not found, skipping K/DEF merge.")
        return []


def generate_dynasty_rankings():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    kickers_and_def = load_kickers_and_def()

    manifest = []
    for num_qbs in NUM_QBS_OPTIONS:
        for ppr_slug, ppr in PPR_OPTIONS:
            for tep_slug, tep_param in TEP_OPTIONS:
                key = variant_key(num_qbs, ppr_slug, tep_slug)
                print(f"Fetching {key} (numQbs={num_qbs}, ppr={ppr}, tep={tep_param})...")
                raw = fetch_dynasty_values(num_qbs, ppr, tep_param)
                rankings = build_rankings(raw, kickers_and_def)

                out_file = os.path.join(OUTPUT_DIR, f"dynasty_{key}.json")
                with open(out_file, 'w') as f:
                    json.dump(rankings, f, indent=2)
                print(f"  -> {len(rankings)} players saved to {out_file}")
                manifest.append(key)

    manifest_file = os.path.join(OUTPUT_DIR, 'manifest.json')
    with open(manifest_file, 'w') as f:
        json.dump(sorted(manifest), f, indent=2)
    print(f"Generated {len(manifest)} dynasty rankings variants. Manifest saved to {manifest_file}")


if __name__ == "__main__":
    generate_dynasty_rankings()
