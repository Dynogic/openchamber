import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionWorktreeStore } from '@/sync/session-worktree-store';
import { getAttachedSessionDirectory } from '@/sync/session-worktree-contract';
import { useSessionDirectory } from '@/sync/sync-context';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

/**
 * Hook that resolves the effective working directory for tabs (Git, Diff, Files, Terminal).
 *
 * Priority order:
 * 1. Worktree metadata path (for worktree sessions) — skipped when `ignoreWorktree` is true
 * 2. Session directory (for active sessions)
 * 3. Draft session directoryOverride (when creating a new session)
 * 4. Fallback directory from DirectoryStore
 *
 * @param options.ignoreWorktree — Skip worktree metadata/attachment resolution.
 *   Use this for the terminal so it stays in the project root even when a
 *   session is attached to a worktree for git viewing.
 */
export const useEffectiveDirectory = (options?: { ignoreWorktree?: boolean }): string | undefined => {
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    const currentSessionDirectory = useSessionDirectory(currentSessionId);
    const worktreeAttachment = useSessionWorktreeStore((s) => currentSessionId ? s.getAttachment(currentSessionId) : undefined);
    const worktreeMap = useSessionUIStore((s) => s.worktreeMetadata);
    const virtualWorktreeDirectory = useSessionUIStore((s) => s.virtualWorktreeDirectory);
    const fallbackDirectory = useDirectoryStore((s) => s.currentDirectory);

    // If we have an active session, use its directory
    if (currentSessionId) {
        if (!options?.ignoreWorktree) {
            // Virtual worktree override (from "Set virtual worktree" — viewing only,
            // does not move the session in the sidebar)
            const virtualDir = virtualWorktreeDirectory.get(currentSessionId);
            if (virtualDir) {
                return virtualDir;
            }
            // Real worktree attachment (session created in a worktree)
            const attachmentDirectory = getAttachedSessionDirectory(worktreeAttachment);
            if (attachmentDirectory) {
                return attachmentDirectory;
            }
            const worktreeMetadata = worktreeMap.get(currentSessionId);
            if (worktreeMetadata?.path) {
                return worktreeMetadata.path;
            }
        }
        if (currentSessionDirectory) {
            return currentSessionDirectory;
        }
    }

    // If a draft session is open, use its directoryOverride
    if (newSessionDraft?.open && (newSessionDraft.bootstrapPendingDirectory || newSessionDraft.directoryOverride)) {
        return (newSessionDraft.bootstrapPendingDirectory || newSessionDraft.directoryOverride) ?? undefined;
    }

    // Fall back to the global directory
    return fallbackDirectory ?? undefined;
};
