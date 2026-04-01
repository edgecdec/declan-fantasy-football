# Code Style and Organization Specification

## File Size and Splitting
- No file should exceed ~150 lines. If it does, extract logic into separate files.
- One component per file. One hook per file. One utility concern per file.

## Shared Logic
- Before writing any logic, search the codebase for existing implementations. Reuse before creating.
- Key shared modules:
  - `src/services/sleeper/sleeperService.ts` — all Sleeper API calls
  - `src/services/common/cacheService.ts` — in-memory response caching
  - `src/services/stats/expectedWins.ts` — luck/all-play calculations
  - `src/services/stats/leagueHistory.ts` — historical league analysis
  - `src/services/stats/positionalBenchmarks.ts` — positional scoring benchmarks
  - `src/services/draft/vbdService.ts` — value-based drafting calculations
  - `src/context/UserContext.tsx` — Sleeper username state
  - `src/constants/colors.ts` — color constants
- If you write the same pattern in two places, extract it immediately.

## Component Organization
- `src/components/common/` — reusable UI (DataTable, SmartTable, PageHeader, YearSelector, etc.)
- `src/components/layout/` — structural layout (AppLayout with sidebar nav)
- `src/components/draft/` — draft assistant components
- `src/components/analytics/` — charts and analytics cards
- `src/components/performance/` — performance review components
- `src/components/ThemeRegistry/` — MUI theme, Emotion cache, colors
- Components should accept props, not fetch their own data. Data fetching happens in page components.

## Types
- All shared TypeScript interfaces go in `src/types/`.
- Never use `any`. Define proper types.
- Never inline complex type definitions — extract to src/types/.

## Naming Conventions
- Files: camelCase for utilities (`cacheService.ts`), PascalCase for components (`DataTable.tsx`).
- Functions: camelCase (`fetchUserLeagues`, `calculateExpectedWins`).
- Types/Interfaces: PascalCase (`PlayerStats`, `LeagueData`).
- Constants: UPPER_SNAKE_CASE (`POSITIONS`, `SEASON_YEAR`).

## Imports
- Use the `@/` path alias for all internal imports.
- Group imports: external packages first, then internal modules, then types.
- Use top-level ES imports only.

## Tables and Sorting
- All data tables should have sortable columns by default. Any column with numeric or alphabetical data should be sortable by clicking the column header.
- Use MUI TableSortLabel in table headers for sort indicators (arrow up/down).
- Columns that don't benefit from sorting (e.g. action buttons, icons, static labels) can be excluded.
- Default sort should be the most useful column for the context (e.g. rank, points, efficiency).
