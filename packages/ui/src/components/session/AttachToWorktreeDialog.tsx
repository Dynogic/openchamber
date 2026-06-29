import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/icon/Icon';
import { cn, formatPathForDisplay } from '@/lib/utils';
import { normalizeProjectPath } from '@/lib/projectResolution';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useI18n } from '@/lib/i18n';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import type { WorktreeMetadata } from '@/types/worktree';

type AttachToWorktreeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  onConfirm: (targetDirectory: string) => void;
  onDetach: () => void;
  submitting?: boolean;
  hasOverride: boolean;
};

type WorktreeOption = {
  metadata: WorktreeMetadata;
  normalizedPath: string;
  displayPath: string;
  label: string;
};

function buildWorktreeOptions(
  session: Session | null,
  projects: ReturnType<typeof useProjectsStore.getState>['projects'],
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
  homeDirectory: string | undefined,
): WorktreeOption[] {
  if (!session) return [];

  const sessionDirectory = normalizeProjectPath(
    (session as Session & { directory?: string | null }).directory ?? null,
  );
  const project = resolveProjectForSessionDirectory(
    projects,
    availableWorktreesByProject,
    sessionDirectory,
  );
  if (!project) return [];

  const projectPath = normalizeProjectPath(project.path);
  if (!projectPath) return [];

  const worktrees = availableWorktreesByProject.get(projectPath) ?? [];

  return worktrees
    .map((metadata) => {
      const normalized = normalizeProjectPath(metadata.path);
      if (!normalized) return null;
      return {
        metadata,
        normalizedPath: normalized,
        displayPath: formatPathForDisplay(normalized, homeDirectory),
        label: metadata.label || metadata.branch || metadata.name || normalized,
      } satisfies WorktreeOption;
    })
    .filter((option): option is WorktreeOption => option !== null);
}

export function AttachToWorktreeDialog(props: AttachToWorktreeDialogProps) {
  const { t } = useI18n();
  const { open, onOpenChange, session, onConfirm, onDetach, submitting = false, hasOverride } = props;

  const projects = useProjectsStore((state) => state.projects);
  const availableWorktreesByProject = useSessionUIStore(
    (state) => state.availableWorktreesByProject,
  );
  const homeDirectory =
    typeof window !== 'undefined' ? window.__OPENCHAMBER_HOME__ : undefined;

  const options = React.useMemo(
    () =>
      buildWorktreeOptions(
        open ? session : null,
        projects,
        availableWorktreesByProject,
        homeDirectory,
      ),
    [open, session, projects, availableWorktreesByProject, homeDirectory],
  );

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath(options[0]?.normalizedPath ?? null);
  }, [open, options]);

  const canConfirm = selectedPath !== null && !submitting;

  const handleSubmit = React.useCallback(() => {
    if (!canConfirm || !selectedPath) return;
    onConfirm(selectedPath);
  }, [canConfirm, selectedPath, onConfirm]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleSubmit]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!submitting) onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-md overflow-visible">
        <DialogHeader>
          <DialogTitle>{t('sessions.sidebar.attachToWorktree.title')}</DialogTitle>
          <DialogDescription>
            {t('sessions.sidebar.attachToWorktree.description')}
          </DialogDescription>
        </DialogHeader>

        {options.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
            {options.map((option) => {
              const isSelected = selectedPath === option.normalizedPath;
              return (
                <button
                  key={option.normalizedPath}
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedPath(option.normalizedPath)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors',
                    'border border-[var(--interactive-border)]',
                    isSelected
                      ? 'bg-[var(--interactive-selection)]'
                      : 'hover:bg-[var(--interactive-hover)]',
                  )}
                >
                  <Icon name="git-branch" className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate typography-ui-label text-foreground">
                      {option.label}
                    </div>
                    <div className="truncate typography-meta text-muted-foreground">
                      {option.displayPath}
                    </div>
                  </div>
                  {isSelected ? (
                    <Icon name="check" className="h-4 w-4 flex-shrink-0 text-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Icon name="git-branch" className="h-8 w-8 text-muted-foreground" />
            <p className="typography-ui-label text-muted-foreground">
              {t('sessions.sidebar.attachToWorktree.noWorktrees')}
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {hasOverride ? (
            <Button variant="ghost" size="sm" onClick={onDetach} disabled={submitting}>
              {t('sessions.sidebar.attachToWorktree.detach')}
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('sessions.sidebar.dialogs.cancel')}
            </Button>
            {options.length > 0 ? (
              <Button size="sm" onClick={handleSubmit} disabled={!canConfirm || !options.length}>
                {submitting
                  ? t('common.loading')
                  : t('sessions.sidebar.attachToWorktree.confirm')}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
