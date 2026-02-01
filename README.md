# 🏈 Fantasy Football Analytics Suite

### [👉 Live Website: fantasy-football-full-website.vercel.app](https://fantasy-football-full-website.vercel.app/)

A comprehensive suite of tools to analyze your Sleeper Fantasy Football leagues, tracking everything from historical ownership to "luck" and roster health.

---

## 🚀 Features

### 📈 **Portfolio Tracker**
**"The Stock Market for your Players"**
- View your total exposure to every player across all your leagues.
- **Historical View**: Go back in time to see who you owned in Week 1 vs Week 14.
- **Start vs Bench**: See if you are actually starting the players you own, or just hoarding them.
- **Trends Graph**: Visualize your ownership percentage over the course of the season.

### 🍀 **League Luck Analyzer (Expected Wins)**
**"Did I lose because I'm bad, or because I'm unlucky?"**
- Calculates **"All-Play" Wins**: Your record if you played every team every week.
- **League Median Support**: Correctly handles leagues where the top half gets a win.
- **Advanced Stats**: Toggles to show Points For, Points Against, and Differential.
- **Dashboard**: See your aggregate "Luck" (Actual Wins - Expected Wins) across all leagues.

### 🏆 **Season Performance Review**
**"The Medal Count"**
- Analyzes Playoff Brackets to determine your **True Final Rank**.
- **Smart Detection**: Distinguishes between "Consolation Brackets" (Winner = Best) and "Toilet Bowls" (Winner = Worst).
- **Medal Tracker**: Tracks Golds (1st), Silvers (2nd), and Bronzes (3rd).
- **Percentiles**: Normalizes your finish based on league size (e.g., 5th/10 is better than 5th/6).

### 🏛️ **Legacy League Analyzer**
**"The Historian"**
- Tracks the entire history of a specific league (e.g., 2021-2025).
- **Head-to-Head Matrix**: See your all-time record against every other owner.
- **Rivalry Tracker**: See who you have outscored the most (and least) over the years.

### 🚑 **Roster Medic**
**"The Check-Up"**
- Scans all your 2025 leagues for critical issues.
- **Alerts**:
  - Empty Starting Slots.
  - Injured Players in Starting Lineup.
  - IR-Eligible players clogging up bench spots.
  - Open Roster Spots.

### 🏈 **Player Database**
- Searchable, sortable list of all 11,000+ NFL players.
- Filters for Position and Team.
- View 2025 Season Stats (Standard, Half-PPR, PPR).

---

## 🛠️ Tech Stack
- **Framework**: Next.js 14 (App Router)
- **UI**: Material UI (MUI)
- **Visualization**: Recharts
- **Data**: Sleeper API (Client-Side + GitHub Actions Pipeline)
- **Hosting**: Vercel

## 🔄 Data Pipeline
The application uses a **GitHub Action** to automatically fetch the latest player database and stats from Sleeper every morning at 8:00 AM UTC, ensuring the Player Database is always up to date without slamming Sleeper's API limits from the client.