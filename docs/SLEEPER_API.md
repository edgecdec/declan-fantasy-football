# Sleeper API Reference

This document serves as a comprehensive reference for the Sleeper Fantasy Football API.
Base URL: `https://api.sleeper.app/v1`

## 1. User & Leagues

### User
- **Get User**: `GET /user/<username_or_id>`
  - Returns `user_id`, `username`, `display_name`, `avatar`.

### Leagues
- **Get User Leagues**: `GET /user/<user_id>/leagues/<sport>/<season>`
  - Returns all leagues for a specific year (e.g., `nfl`, `2025`).
- **Get League**: `GET /league/<league_id>`
  - Returns settings, scoring rules, roster positions.
- **Get Rosters**: `GET /league/<league_id>/rosters`
  - Returns all teams, including players, taxi, reserve, and owner IDs.
- **Get Users**: `GET /league/<league_id>/users`
  - Returns display names and metadata for league members.
- **Get Matchups**: `GET /league/<league_id>/matchups/<week>`
  - Returns points, starters, and matchup IDs for a specific week.
- **Get Winners Bracket**: `GET /league/<league_id>/winners_bracket`
- **Get Losers Bracket**: `GET /league/<league_id>/losers_bracket`
- **Get Transactions**: `GET /league/<league_id>/transactions/<week>`
  - Returns trades, waivers, and free agent moves for a specific week.
- **Get Traded Picks**: `GET /league/<league_id>/traded_picks`
  - Returns all future draft picks that have been traded.
- **Get State**: `GET /state/<sport>`
  - Returns current week, season, and season status (pre_draft, in_season, complete).

## 2. Drafts

- **Get User Drafts**: `GET /user/<user_id>/drafts/<sport>/<season>`
- **Get League Drafts**: `GET /league/<league_id>/drafts`
- **Get Draft**: `GET /draft/<draft_id>`
- **Get Draft Picks**: `GET /draft/<draft_id>/picks`
  - Returns every pick made in a completed draft.
- **Get Traded Picks (Draft)**: `GET /draft/<draft_id>/traded_picks`

## 3. Players

- **Get All Players**: `GET /players/nfl`
  - **Warning**: 5MB+ file. Fetch once daily.
- **Get Trending Players**: `GET /players/nfl/trending/<type>`
  - `type`: `add` or `drop`. Returns players being added/dropped most frequently.

## 4. Stats & Projections

- **Get Season Stats**: `GET /stats/nfl/regular/<season>`
- **Get Weekly Stats**: `GET /stats/nfl/regular/<season>/<week>`
- **Get Season Projections**: `GET /projections/nfl/regular/<season>`
- **Get Weekly Projections**: `GET /projections/nfl/regular/<season>/<week>`

## 5. Avatars & Assets

- **User Avatar**: `https://sleepercdn.com/avatars/<avatar_id>`
- **Player Headshot**: `https://sleepercdn.com/content/nfl/players/<player_id>.jpg`
- **Team Logo**: `https://sleepercdn.com/avatars/<avatar_id>` (if set) or generic shield.

## 6. Definitions

- **Roster ID**: The ID (1-12) representing a team within a specific league.
- **Owner ID**: The global User ID of the human managing the team.
- **Matchup ID**: An integer grouping two teams playing against each other in a specific week.
- **Playoff Type**:
  - `0`: Consolation Bracket (Winner advances/gets better rank).
  - `1`: Toilet Bowl (Loser advances/gets worse rank).