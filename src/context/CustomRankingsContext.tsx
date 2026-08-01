'use client';

import * as React from 'react';
import { Player } from '@/services/draft/vbdService';
import { parseAndMatchRankingsCsv } from '@/services/draft/rankingsCsv';
import rankingsData from '../../data/rankings.json';

const DEFAULT_RANKINGS = rankingsData as Player[];
const STORAGE_KEY = 'declanalytics_custom_ranking_sets';
const ACTIVE_KEY = 'declanalytics_active_ranking_set';
export const DEFAULT_DYNASTY_VARIANT = '1qb|ppr1|te_none';

// Lazily code-split each dynasty scenario so a page only ever downloads the one
// variant it actually needs, instead of bundling all 18 into every page's JS.
// Keys mirror dynastyVariantKey()'s "numQbs|ppr|tep" format; the import paths
// underneath are the underscore-joined filenames generate_dynasty_rankings.py writes.
const DYNASTY_LOADERS: Record<string, () => Promise<{ default: Player[] }>> = {
  '1qb|ppr0|te_none': () => import('../../data/dynasty/dynasty_1qb_ppr0_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr0|te_plus': () => import('../../data/dynasty/dynasty_1qb_ppr0_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr0|te_plus_plus': () => import('../../data/dynasty/dynasty_1qb_ppr0_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr0_5|te_none': () => import('../../data/dynasty/dynasty_1qb_ppr0_5_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr0_5|te_plus': () => import('../../data/dynasty/dynasty_1qb_ppr0_5_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr0_5|te_plus_plus': () => import('../../data/dynasty/dynasty_1qb_ppr0_5_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr1|te_none': () => import('../../data/dynasty/dynasty_1qb_ppr1_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr1|te_plus': () => import('../../data/dynasty/dynasty_1qb_ppr1_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '1qb|ppr1|te_plus_plus': () => import('../../data/dynasty/dynasty_1qb_ppr1_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0|te_none': () => import('../../data/dynasty/dynasty_2qb_ppr0_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0|te_plus': () => import('../../data/dynasty/dynasty_2qb_ppr0_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0|te_plus_plus': () => import('../../data/dynasty/dynasty_2qb_ppr0_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0_5|te_none': () => import('../../data/dynasty/dynasty_2qb_ppr0_5_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0_5|te_plus': () => import('../../data/dynasty/dynasty_2qb_ppr0_5_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr0_5|te_plus_plus': () => import('../../data/dynasty/dynasty_2qb_ppr0_5_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr1|te_none': () => import('../../data/dynasty/dynasty_2qb_ppr1_te_none.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr1|te_plus': () => import('../../data/dynasty/dynasty_2qb_ppr1_te_plus.json') as unknown as Promise<{ default: Player[] }>,
  '2qb|ppr1|te_plus_plus': () => import('../../data/dynasty/dynasty_2qb_ppr1_te_plus_plus.json') as unknown as Promise<{ default: Player[] }>,
};

export type RankingSet = {
  id: string;
  name: string;
  uploadedAt: number;
  players: Player[];
  matchedCount: number;
  totalRows: number;
};

export type UploadResult = {
  matchedCount: number;
  totalRows: number;
  unmatchedNames: string[];
};

interface CustomRankingsContextType {
  rankingSets: RankingSet[];
  activeId: string; // 'default' | 'dynasty' | a RankingSet id
  activeName: string;
  activePlayers: Player[];
  dynastyVariant: string;
  dynastyLoading: boolean;
  setDynastyVariant: (key: string) => void;
  uploadCsv: (file: File) => Promise<UploadResult>;
  selectRankingSet: (id: string) => void;
  deleteRankingSet: (id: string) => void;
}

const CustomRankingsContext = React.createContext<CustomRankingsContextType | undefined>(undefined);

export function CustomRankingsProvider({ children }: { children: React.ReactNode }) {
  const [rankingSets, setRankingSets] = React.useState<RankingSet[]>([]);
  const [activeId, setActiveId] = React.useState('default');
  const [dynastyVariant, setDynastyVariant] = React.useState(DEFAULT_DYNASTY_VARIANT);
  const [dynastyPlayers, setDynastyPlayers] = React.useState<Player[]>([]);
  const [dynastyLoading, setDynastyLoading] = React.useState(false);

  React.useEffect(() => {
    try {
      const rawSets = localStorage.getItem(STORAGE_KEY);
      if (rawSets) setRankingSets(JSON.parse(rawSets));
      const rawActive = localStorage.getItem(ACTIVE_KEY);
      if (rawActive) setActiveId(rawActive);
    } catch (e) {
      console.error('Failed to load custom rankings from storage', e);
    }
  }, []);

  React.useEffect(() => {
    const loader = DYNASTY_LOADERS[dynastyVariant];
    if (!loader) return;

    let cancelled = false;
    setDynastyLoading(true);
    loader()
      .then(mod => { if (!cancelled) setDynastyPlayers(mod.default); })
      .catch(e => console.error(`Failed to load dynasty variant ${dynastyVariant}`, e))
      .finally(() => { if (!cancelled) setDynastyLoading(false); });

    return () => { cancelled = true; };
  }, [dynastyVariant]);

  const persist = (sets: RankingSet[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
    } catch (e) {
      console.error('Failed to save custom rankings (storage full?)', e);
    }
  };

  const uploadCsv = async (file: File): Promise<UploadResult> => {
    const text = await file.text();
    const { players, matchedCount, totalRows, unmatchedNames } = parseAndMatchRankingsCsv(text, DEFAULT_RANKINGS);

    if (matchedCount === 0) {
      throw new Error('No players could be matched. Check that your CSV has "name" and "position" columns.');
    }

    const set: RankingSet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name.replace(/\.csv$/i, ''),
      uploadedAt: Date.now(),
      players,
      matchedCount,
      totalRows,
    };

    setRankingSets(prev => {
      const next = [...prev, set];
      persist(next);
      return next;
    });
    setActiveId(set.id);
    localStorage.setItem(ACTIVE_KEY, set.id);

    return { matchedCount, totalRows, unmatchedNames };
  };

  const selectRankingSet = (id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
  };

  const deleteRankingSet = (id: string) => {
    setRankingSets(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
    setActiveId(prev => {
      if (prev !== id) return prev;
      localStorage.setItem(ACTIVE_KEY, 'default');
      return 'default';
    });
  };

  const activeSet = rankingSets.find(s => s.id === activeId);
  const resolvedActiveId = activeSet ? activeId : (activeId === 'dynasty' ? 'dynasty' : 'default');
  const activePlayers = activeSet ? activeSet.players : (resolvedActiveId === 'dynasty' ? dynastyPlayers : DEFAULT_RANKINGS);
  const activeName = activeSet ? activeSet.name : (resolvedActiveId === 'dynasty' ? 'Dynasty Rankings' : 'Default Rankings');

  return (
    <CustomRankingsContext.Provider
      value={{
        rankingSets,
        activeId: resolvedActiveId,
        activeName,
        activePlayers,
        dynastyVariant,
        dynastyLoading,
        setDynastyVariant,
        uploadCsv,
        selectRankingSet,
        deleteRankingSet,
      }}
    >
      {children}
    </CustomRankingsContext.Provider>
  );
}

export function useCustomRankings() {
  const context = React.useContext(CustomRankingsContext);
  if (context === undefined) {
    throw new Error('useCustomRankings must be used within a CustomRankingsProvider');
  }
  return context;
}
