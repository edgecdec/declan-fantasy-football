"""
Script to fetch the full player database AND last season's stats from Sleeper
API and save it to a JSON file. This is designed to be run by GitHub Actions
daily.

Season was previously hardcoded to 2025, which meant generate_rankings.py
(which reads the `season` field from this file to know which year's
projections to fetch) kept pulling 2025 projections indefinitely, even once
the 2026 season's real projections were published on Sleeper's API.
"""

import requests
import json
import os
from datetime import datetime

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'sleeper_players.json')
SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"


def compute_seasons():
    """Returns (stats_season, upcoming_season). An NFL season N is played
    Sep(N)-Feb(N+1); treat it as complete once we're past that Feb (month>=3
    of year N+1). `upcoming_season` is the one rankings/projections target."""
    now = datetime.now()
    stats_season = now.year - 1 if now.month >= 3 else now.year - 2
    upcoming_season = now.year
    return stats_season, upcoming_season


STATS_SEASON, UPCOMING_SEASON = compute_seasons()
SLEEPER_STATS_URL = f"https://api.sleeper.app/v1/stats/nfl/regular/{STATS_SEASON}"

def fetch_json(url, description):
    print(f"Fetching {description} from {url}...")
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        data = response.json()
        print(f"Successfully fetched {len(data)} records for {description}.")
        return data
    except Exception as e:
        print(f"Error fetching {description}: {e}")
        return None

def process_data(players, stats):
    print("Merging stats into player database...")
    
    # Process stats into a lookup dict for faster access
    # Stats structure from Sleeper is usually a list or dict keyed by player_id
    # If it's a list, we convert to dict. If dict, use as is.
    stats_map = {}
    if isinstance(stats, list): # Should not happen for this endpoint usually, but safety first
        for s in stats:
            stats_map[s.get('player_id')] = s
    else:
        stats_map = stats

    count_enriched = 0
    for pid, p_data in players.items():
        # Get stats for this player
        p_stats = stats_map.get(pid)
        
        if p_stats:
            # We only keep key fantasy stats to keep file size reasonable
            # Sleeper stats keys: "pts_half_ppr", "pass_yd", etc.
            p_data['stats'] = {
                'pts_std': p_stats.get('pts_std', 0),
                'pts_half_ppr': p_stats.get('pts_half_ppr', 0),
                'pts_ppr': p_stats.get('pts_ppr', 0),
                'gp': p_stats.get('gp', 0),
                'pass_yd': p_stats.get('pass_yd', 0),
                'pass_td': p_stats.get('pass_td', 0),
                'rush_yd': p_stats.get('rush_yd', 0),
                'rush_td': p_stats.get('rush_td', 0),
                'rec_yd': p_stats.get('rec_yd', 0),
                'rec_td': p_stats.get('rec_td', 0)
            }
            count_enriched += 1
        else:
            p_data['stats'] = None

    print(f"Enriched {count_enriched} players with stats.")

    return {
        "updated_at": datetime.now().isoformat(),
        # The season generate_rankings.py fetches projections for -- the
        # upcoming/current season, not the one `stats` above reflects.
        "season": str(UPCOMING_SEASON),
        "stats_season": str(STATS_SEASON),
        "players": players
    }

if __name__ == "__main__":
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

    raw_players = fetch_json(SLEEPER_PLAYERS_URL, "Players")
    raw_stats = fetch_json(SLEEPER_STATS_URL, f"{STATS_SEASON} Stats")
    
    if raw_players and raw_stats:
        final_data = process_data(raw_players, raw_stats)
        
        print(f"Saving to {OUTPUT_FILE}...")
        # sort_keys is load-bearing, not cosmetic: Sleeper's /players/nfl doesn't
        # serialize object keys in a stable order, so without it every player's
        # ~70 fields reshuffle between runs and the daily auto-commit rewrites
        # ~68% of this 825k-line file even when no player data actually changed.
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(final_data, f, indent=2, sort_keys=True)
        
        # Slim index for server-side use. The full file is ~22MB, which is fine in
        # a client bundle that already ships it but not something to parse in the
        # Next server process on a 1.9GB box.
        #
        # Scoped to fantasy positions only: 4,265 players / ~114KB instead of
        # 12,226 / ~326KB. Everything else (OL, DL, LB, DB, practice-squad bodies)
        # can never occupy a starting slot in these leagues, so it is dead weight.
        #
        # Not scoped tighter than that on purpose. Pricing only ever touches about
        # 365 players — the ~160 rostered across a league plus K/DEF for streaming —
        # but which ones changes with every trade and waiver claim, and free-agent
        # discovery needs the whole K/DEF universe rather than a snapshot. Position
        # and team are all pricing needs.
        FANTASY_POSITIONS = {'QB', 'RB', 'WR', 'TE', 'K', 'DEF'}
        index = {
            pid: {'p': p.get('position'), 't': p.get('team')}
            for pid, p in players.items()
            if p.get('position') in FANTASY_POSITIONS
        }
        index_file = os.path.join(DATA_DIR, 'player_index.json')
        print(f"Saving slim index ({len(index)} players) to {index_file}...")
        with open(index_file, 'w') as f:
            json.dump(index, f, sort_keys=True, separators=(',', ':'))

        print("Done!")
    else:
        print("Failed to update database (missing players or stats).")
        exit(1)
