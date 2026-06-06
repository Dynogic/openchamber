/**
 * Reproduction test for GitHub issue #1551
 *
 * Bug: Session share status not updating after cancelling share.
 * The UI still shows "Shared" despite the session being unshared on the backend.
 *
 * Root cause:
 * The `unshareSession` action (in session-actions.ts) only updates the global
 * sessions store via `upsertSession`. It does NOT update the per-directory live
 * store that feeds `useAllLiveSessions()`. Meanwhile, the sidebar merge logic
 * in `SessionSidebar.tsx` (line 339–355) merges global + live sessions using
 * `mergeSessionDirectoryMetadata`, which only patches directory/project metadata
 * from the "existing" (global) session into the "incoming" (live) session — all
 * other fields (including `share`) come from the stale live session.
 *
 * Expected fix: Update the per-directory live store after unshare/share to
 * avoid the race window, OR adjust the merge to prefer the global session's
 * `share` field when the live session is stale.
 */

import { describe, expect, it } from 'bun:test'
import type { Session } from '@opencode-ai/sdk/v2'
import { mergeSessionDirectoryMetadata } from '@/stores/useGlobalSessionsStore'

// ---------------------------------------------------------------------------
// Helper — build a minimal session shape
// ---------------------------------------------------------------------------
const buildSession = (
  id: string,
  overrides: Partial<Session> & {
    directory?: string | null
    project?: { worktree?: string | null } | null
  } = {},
): Session =>
  ({
    id,
    title: `session-${id}`,
    time: { created: 100, updated: 200 },
    ...overrides,
  }) as Session

describe('Bug #1551 — stale share status after unshare', () => {
  // -----------------------------------------------------------------------
  // Reproducer 1: mergeSessionDirectoryMetadata preserves stale share field
  // -----------------------------------------------------------------------
  //
  // This is the core of the bug. After unshare:
  //   - liveSession has share.url (stale — SSE event not yet received)
  //   - globalSession has no share (correct, just updated via upsertSession)
  //
  // mergeSessionDirectoryMetadata(liveSession, globalSession) returns the
  // live session unchanged because only directory/project fields are merged.
  // The share field from the stale live session is preserved, so the UI
  // still shows "Shared".
  it('mergeSessionDirectoryMetadata preserves share from live session (stale)', () => {
    // Simulate live session that still has share (SSE event hasn't arrived yet)
    const liveSession = buildSession('ses_1', {
      directory: '/repo/app',
      share: { url: 'https://example.com/share/abc123' },
    })

    // Simulate global session that was just updated by unshareSession (no share)
    const globalSession = buildSession('ses_1', {
      directory: '/repo/app',
      // Note: share field is absent — session was unshared
    })

    const merged = mergeSessionDirectoryMetadata(liveSession, globalSession)

    // BUG: The merged result still has share because mergeSessionDirectoryMetadata
    // only patches directory/project fields. share is NOT part of that merge.
    expect(merged.share?.url).toBe('https://example.com/share/abc123')
    // ^ The stale share URL survived the merge; the UI will show "Shared".
  })

  // -----------------------------------------------------------------------
  // Reproducer 2: Correct behavior after live store IS updated
  // -----------------------------------------------------------------------
  //
  // For contrast: once the SSE event arrives and updates the live session,
  // both sources agree and the merge is correct.
  it('merge is correct when both live and global agree (share removed)', () => {
    const liveSession = buildSession('ses_1', {
      directory: '/repo/app',
      // share absent — SSE event arrived
    })

    const globalSession = buildSession('ses_1', {
      directory: '/repo/app',
    })

    const merged = mergeSessionDirectoryMetadata(liveSession, globalSession)
    expect(merged.share).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Reproducer 3: mergeSessionDirectoryMetadata only cares about directory
  //               fields — all other fields are from "incoming" (live)
  // -----------------------------------------------------------------------
  it('other non-directory fields also survive from the live session', () => {
    const liveSession = buildSession('ses_1', {
      directory: '/repo/app',
      title: 'stale-title',
      // share is present in live
      share: { url: 'https://example.com/share/old' },
    })

    const globalSession = buildSession('ses_1', {
      directory: '/repo/app',
      title: 'updated-title',
      // share is absent in global
    })

    const merged = mergeSessionDirectoryMetadata(liveSession, globalSession)

    // Directory fields are preserved from global (they're the same anyway)
    // But title and share come from the live session
    expect(merged.title).toBe('stale-title')
    expect(merged.share?.url).toBe('https://example.com/share/old')
  })

  // -----------------------------------------------------------------------
  // Reproducer 4: Simulating the full sidebar merge logic
  // -----------------------------------------------------------------------
  //
  // The SessionSidebar.tsx `sessions` memo:
  //
  //   const sessions = React.useMemo(() => {
  //     const liveById = new Map(liveSessions.map(s => [s.id, s]));
  //     const merged = globalActiveSessions.map((session) => {
  //       const liveSession = liveById.get(session.id);
  //       return liveSession ? mergeSessionDirectoryMetadata(liveSession, session) : session;
  //     });
  //     ...
  //   }, [globalActiveSessions, knownSessionDirectories, liveSessions]);
  //
  // This shows that after unshareSession updates globalActiveSessions,
  // the liveSessions (stale) take priority via mergeSessionDirectoryMetadata.
  it('simulated sidebar merge shows stale share after unshare', () => {
    // Before unshare — both global and live have share
    const liveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        share: { url: 'https://example.com/share/abc123' },
        time: { created: 100, updated: 200 },
      }),
    ]

    const globalActiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        share: { url: 'https://example.com/share/abc123' },
        time: { created: 100, updated: 200 },
      }),
    ]

    // Simulate the sidebar merge logic
    const liveById = new Map(liveSessions.map((s) => [s.id, s]))
    const mergedBefore = globalActiveSessions.map((session) => {
      const liveSession = liveById.get(session.id)
      return liveSession ? mergeSessionDirectoryMetadata(liveSession, session) : session
    })
    expect(mergedBefore[0]?.share?.url).toBe('https://example.com/share/abc123')
    // ✓ Correct — both sources agree, share is shown

    // --- Now simulate unshare ---
    // The global store gets updated immediately by unshareSession action
    const updatedGlobalActiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        // share REMOVED — unshareSession returned this from the server
        time: { created: 100, updated: 201 },
      }),
    ]

    // BUT liveSessions is still stale (SSE event hasn't arrived yet)
    const staleLiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        share: { url: 'https://example.com/share/abc123' }, // ← stale!
        time: { created: 100, updated: 200 },
      }),
    ]

    // Re-run the sidebar merge
    const liveById2 = new Map(staleLiveSessions.map((s) => [s.id, s]))
    const mergedAfter = updatedGlobalActiveSessions.map((session) => {
      const liveSession = liveById2.get(session.id)
      return liveSession ? mergeSessionDirectoryMetadata(liveSession, session) : session
    })

    // BUG: Even though global was correctly updated (no share),
    // the merged result still has share because liveSession is stale
    expect(mergedAfter[0]?.share?.url).toBe('https://example.com/share/abc123')
    // ^ The merged result shows "Shared" despite the session being unshared!
    // The context menu in SessionNodeItem checks `!resolvedSession.share`
    // and will show "Copy link" / "Unshare" instead of "Share".
  })

  // -----------------------------------------------------------------------
  // Reproducer 5: Even when the SSE event arrives after a delay, there is a
  //               window where the UI shows incorrect state.
  // -----------------------------------------------------------------------
  it('corrects after SSE event updates live store', () => {
    // Initial state: both global and live have share
    const staleLiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        share: { url: 'https://example.com/share/abc123' },
        time: { created: 100, updated: 200 },
      }),
    ]
    const globalActiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        // share removed — just updated
        time: { created: 100, updated: 201 },
      }),
    ]

    // During the race window (SSE hasn't arrived yet) → stale
    const liveById = new Map(staleLiveSessions.map((s) => [s.id, s]))
    const merged = globalActiveSessions.map((session) => {
      const liveSession = liveById.get(session.id)
      return liveSession ? mergeSessionDirectoryMetadata(liveSession, session) : session
    })
    expect(merged[0]?.share?.url).toBe('https://example.com/share/abc123')

    // --- Later: SSE event arrives, live store is updated ---
    const updatedLiveSessions: Session[] = [
      buildSession('ses_1', {
        directory: '/repo/app',
        // share now absent — SSE event was processed
        time: { created: 100, updated: 201 },
      }),
    ]

    // Re-run merge
    const liveById2 = new Map(updatedLiveSessions.map((s) => [s.id, s]))
    const mergedCorrect = globalActiveSessions.map((session) => {
      const liveSession = liveById2.get(session.id)
      return liveSession ? mergeSessionDirectoryMetadata(liveSession, session) : session
    })
    expect(mergedCorrect[0]?.share).toBeUndefined()
    // ✓ Eventually correct — but there was a user-visible window of staleness
  })
})
