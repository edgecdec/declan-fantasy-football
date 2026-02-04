"""
Script to generate draft rankings from Sleeper player data AND projections.
Uses real projected points from Sleeper API where available, falling back to tier-based estimation.
"""

import json
import os
import math
import requests
import datetime

# Config
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
PLAYERS_FILE = os.path.join(DATA_DIR, 'sleeper_players.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'rankings.json')

# Point estimates by Tier (PPR approx) - Fallback
TIER_POINTS = {
    'QB': {1: 350, 2: 320, 3: 290, 4: 260, 5: 240, 6: 220, 7: 200, 8: 180},
    'RB': {1: 300, 2: 260, 3: 220, 4: 190, 5: 160, 6: 140, 7: 120, 8: 100},
    'WR': {1: 300, 2: 260, 3: 230, 4: 200, 5: 170, 6: 150, 7: 130, 8: 110},
    'TE': {1: 220, 2: 170, 3: 140, 4: 120, 5: 100, 6: 90, 7: 80, 8: 70},
    'K': {1: 150, 2: 140, 3: 135, 4: 130, 5: 125, 6: 120, 7: 115, 8: 110},
    'DEF': {1: 160, 2: 150, 3: 140, 4: 130, 5: 120, 6: 110, 7: 105, 8: 100}
}

VALID_POSITIONS = {'QB', 'RB', 'WR', 'TE', 'K', 'DEF'}

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

def generate_rankings():
    print("Loading player database...")
    try:
        with open(PLAYERS_FILE, 'r') as f:
            data = json.load(f)
            players = data.get('players', {})
            season = data.get('season', str(datetime.date.today().year))
            
            # If season is older than current year, try to fetch current year projections?
            # Or assume we want projections for the season defined in players file.
            # Let's use the season from the file, but if it's '2025' and it's 2024, maybe projections aren't out?
            # Sleeper usually has projections for upcoming season around summer.
            # We'll try to fetch for the file's season.
    except FileNotFoundError:
        print(f"Error: {PLAYERS_FILE} not found. Run update_players.py first.")
        return

    # Fetch Projections
    # Check if we should use previous season if current is empty?
    # For now, just fetch targeted season.
    projections = fetch_projections(season)
    if not projections:
        # Fallback to previous year if current empty? 
        # e.g. if 2025 empty, try 2024.
        print("Empty projections, trying previous year...")
        projections = fetch_projections(str(int(season) - 1))

    print(f"Processing {len(players)} players with {len(projections)} projections...")
    
    ranked_list = []
    
    for pid, p in players.items():
        if not p.get('active'):
            continue
            
        pos = p.get('position')
        if pos not in VALID_POSITIONS:
            continue
            
        # Get Projection Data
        proj = projections.get(pid, {})
        
        # Determine Points
        # Use PPR projection if available
        pts = proj.get('pts_ppr')
        
        # Determine ADP/Rank
        # Use adp_ppr if available, else search_rank
        adp = proj.get('adp_ppr')
        if adp is None or adp == 999:
             adp = p.get('search_rank', 9999)
        
        # If no points, we need to estimate
        # But to estimate, we need a "Tier" which is based on rank
        # So we collect all first, sort by ADP, then fill gaps
        
        ranked_list.append({
            'player_id': pid,
            'name': f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or p.get('full_name', 'Unknown'),
            'position': pos,
            'team': p.get('team') or 'FA',
            'adp': adp,
            'projected_points': pts,
            'search_rank': p.get('search_rank', 9999)
        })

    # Sort by ADP/Search Rank to determine hierarchy
    ranked_list.sort(key=lambda x: x['adp'] or 9999)
    
    final_rankings = []
    pos_counts = {p: 0 for p in VALID_POSITIONS}
    
    for i, p in enumerate(ranked_list):
        rank = i + 1
        pos = p['position']
        pos_counts[pos] += 1
        
        # Calculate fallback points if missing
        if p['projected_points'] is None:
            pos_rank = pos_counts[pos]
            pos_tier = math.ceil(pos_rank / 12)
            p['projected_points'] = estimate_points(pos, pos_tier)
            p['is_estimated'] = True
        
        final_rankings.append({
            'player_id': p['player_id'],
            'name': p['name'],
            'position': pos,
            'team': p['team'],
            'rank': rank,
            'tier': math.ceil(rank / 12),
            'projected_points': round(p['projected_points'], 1),
            'adp': round(p['adp'], 1) if p['adp'] and p['adp'] < 5000 else None,
            'is_estimated': p.get('is_estimated', False)
        })

    print(f"Generated rankings for {len(final_rankings)} players.")
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(final_rankings, f, indent=2)
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    generate_rankings()
