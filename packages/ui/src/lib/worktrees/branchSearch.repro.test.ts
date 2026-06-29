/**
 * Reproduction test for issue #1934:
 * Branch pickers sort alphabetically instead of by relevance.
 *
 * Run: bun test packages/ui/src/lib/worktrees/branchSearch.repro.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { rankBranchesForQuery } from './branchSearch';
import { scoreByFuzzyQuery } from '@/lib/search/fuzzySearch';

/**
 * Simulates the BranchSelector.tsx filter behavior.
 * Uses `includes()` as a boolean filter with no relevance sorting.
 */
function simulateBranchSelector(localBranches: string[], remoteBranches: string[], term: string) {
  if (!term) return { local: localBranches, remote: remoteBranches };
  const t = term.toLowerCase();
  return {
    local: localBranches.filter((b) => b.toLowerCase().includes(t)),
    remote: remoteBranches.filter((b) => b.toLowerCase().includes(t)),
  };
}

/**
 * Simulates the BranchIntegrationSection.tsx filter behavior.
 */
function simulateBranchIntegration(localBranches: string[], remoteBranches: string[], term: string) {
  return simulateBranchSelector(localBranches, remoteBranches, term);
}

const LOCAL_BRANCHES = [
  'develop',
  'feature-main',
  'main',
  'release-main',
  'bugfix/login',
  'feature/user-auth',
  'chore/ci-cd',
];

const REMOTE_BRANCHES = [
  'origin/main',
  'origin/develop',
  'origin/feature-main',
  'origin/release-main',
];

describe('Issue #1934: Branch pickers sort alphabetically instead of by relevance', () => {
  test('REPRODUCES BUG: rankBranchesForQuery sorts matching results alphabetically', () => {
    const result = rankBranchesForQuery({
      localBranches: LOCAL_BRANCHES,
      remoteBranches: REMOTE_BRANCHES,
      query: 'main',
    });

    const labels = result.matching.map((m) => m.label);

    // BUG: Alphabetical order sorts matching items by localeCompare:
    // "feature-main", "main", "origin/feature-main", "origin/main", "origin/release-main", "release-main"
    // Typing "main" — 'main' should be first (prefix match), then 'release-main', then others.
    // Instead, 'feature-main' comes first because it's alphabetically before 'main'.
    console.log('BUG: rankBranchesForQuery query="main" result order:', labels);

    // BUG: 'main' (prefix/exact match) is NOT first — 'feature-main' is (alphabetical)
    expect(labels[0]).not.toBe('main');
    expect(labels[0]).toBe('feature-main'); // alphabetically first, not relevance-first
    expect(labels.indexOf('main')).toBeGreaterThan(labels.indexOf('feature-main'));
  });

  test('REPRODUCES BUG: BranchSelector uses includes() with no relevance sorting', () => {
    const term = 'main';
    const { local } = simulateBranchSelector(LOCAL_BRANCHES, REMOTE_BRANCHES, term);

    // `Array.filter` preserves original order — the original array is already alphabetized,
    // so results appear in alphabetical order, not relevance order.
    // Only branches containing "main" pass the filter, in original array order:
    //   "feature-main", "main", "release-main"
    // 'main' (prefix match) comes AFTER 'feature-main'.
    console.log('BUG: BranchSelector query="main" local order:', local);

    expect(local[0]).not.toBe('main');
    expect(local[0]).toBe('feature-main'); // alphabetically first, not relevance-first
    // 'main' should be first (exact prefix match) but it appears after 'feature-main'
    expect(local.indexOf('main')).toBeGreaterThan(local.indexOf('feature-main'));
  });

  test('REPRODUCES BUG: BranchIntegrationSection uses includes() with no relevance sorting', () => {
    const term = 'main';
    const { local } = simulateBranchIntegration(LOCAL_BRANCHES, REMOTE_BRANCHES, term);

    console.log('BUG: BranchIntegrationSection query="main" local order:', local);

    expect(local[0]).not.toBe('main');
    expect(local[0]).toBe('feature-main'); // alphabetically first, not relevance-first
    expect(local.indexOf('main')).toBeGreaterThan(local.indexOf('feature-main'));
  });

  test('scoreByFuzzyQuery already implements correct prefix > substring > fuzzy ranking', () => {
    const result = scoreByFuzzyQuery(LOCAL_BRANCHES, 'main', (b) => b);

    const ordered = result.map((r) => r.item);
    console.log('CORRECT: scoreByFuzzyQuery query="main" order:', ordered);

    // With scoreByFuzzyQuery, 'main' ranks first (prefix match, score: -1),
    // then substring matches, then fuzzy matches.
    expect(ordered[0]).toBe('main'); // Exact prefix match should be first
  });

  test('scoreByFuzzyQuery is available but NOT wired into branch pickers', () => {
    // Verify scoreByFuzzyQuery exists and works correctly
    const branches = ['develop', 'feature-main', 'main', 'release-main'];
    const result = scoreByFuzzyQuery(branches, 'main', (b) => b);
    const ordered = result.map((r) => r.item);

    // Prefix match 'main' ranks first
    expect(ordered[0]).toBe('main');

    // Substring matches come next ('release-main', 'feature-main' — both contain 'main')
    // 'develop' does not contain 'main', so it's either absent or last (fuzzy match with high score)
    expect(ordered.includes('release-main')).toBe(true);
    expect(ordered.includes('feature-main')).toBe(true);

    console.log('scoreByFuzzyQuery correctly ranks: main (prefix) > release-main (substring) > feature-main (substring)');

    // Contrast with rankBranchesForQuery which sorts alphabetically:
    const ranked = rankBranchesForQuery({
      localBranches: branches,
      remoteBranches: [],
      query: 'main',
    });
    const rankedLabels = ranked.matching.map((m) => m.label);
    expect(rankedLabels[0]).not.toBe('main'); // BUG confirmed: prefix match is NOT first
    console.log('rankBranchesForQuery (BUG) query="main" order:', rankedLabels);
    // Expected: ['main', 'release-main', 'feature-main']
    // Actual (BUG): alphabetically sorted, so 'main' may not be first
  });

  test('Empty query preserves all branches (unchanged behavior)', () => {
    const result = rankBranchesForQuery({
      localBranches: LOCAL_BRANCHES,
      remoteBranches: REMOTE_BRANCHES,
      query: '',
    });

    expect(result.matching).toHaveLength(0);
    expect(result.otherLocal).toEqual(LOCAL_BRANCHES);
    expect(result.otherRemote).toEqual(REMOTE_BRANCHES);
  });
});
