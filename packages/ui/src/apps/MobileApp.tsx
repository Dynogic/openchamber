import React from 'react';
import {
  RiAddLine,
  RiChat4Line,
  RiCloseLine,
  RiFileTextLine,
  RiFolder6Line,
  RiGitBranchLine,
  RiSearchLine,
  RiSettings3Line,
} from '@remixicon/react';
import type { Session } from '@opencode-ai/sdk/v2/client';

import { ChatView } from '@/components/views/ChatView';
import { SettingsView } from '@/components/views/SettingsView';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Input } from '@/components/ui/input';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { usePushVisibilityBeacon } from '@/hooks/usePushVisibilityBeacon';
import { useRouter } from '@/hooks/useRouter';
import { useWindowTitle } from '@/hooks/useWindowTitle';
import { opencodeClient } from '@/lib/opencode/client';
import type { RuntimeAPIs } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { SyncProvider, useAllLiveSessions } from '@/sync/sync-context';
import { SyncAppEffects } from './AppEffects';
import { MobileChangesSurface } from './MobileChangesSurface';
import { MobileFilesSurface } from './MobileFilesSurface';
import { useAppFontEffects } from './useAppFontEffects';

type MobileSurface = 'chat' | 'files' | 'changes' | 'settings';

const MOBILE_SETTINGS_PAGES = [
  'appearance',
  'chat',
  'notifications',
  'sessions',
  'git',
  'magic-prompts',
  'behavior',
  'mcp',
  'providers',
  'usage',
  'voice',
] as const;

type MobileAppProps = {
  apis: RuntimeAPIs;
};

const MOBILE_NAV_ITEMS: Array<{
  surface: MobileSurface;
  labelKey: 'layout.mainTab.chat' | 'layout.mainTab.files' | 'mobile.nav.changes' | 'mobile.nav.settings';
  Icon: typeof RiChat4Line;
}> = [
  { surface: 'chat', labelKey: 'layout.mainTab.chat', Icon: RiChat4Line },
  { surface: 'files', labelKey: 'layout.mainTab.files', Icon: RiFileTextLine },
  { surface: 'changes', labelKey: 'mobile.nav.changes', Icon: RiGitBranchLine },
  { surface: 'settings', labelKey: 'mobile.nav.settings', Icon: RiSettings3Line },
];

const normalizePath = (value?: string | null): string => {
  return (value || '').replace(/\\/g, '/').replace(/\/+$/g, '');
};

const getSessionDirectory = (session: Session): string => {
  const sessionWithDirectory = session as Session & { directory?: string | null; project?: { worktree?: string | null } | null };
  return normalizePath(sessionWithDirectory.directory ?? sessionWithDirectory.project?.worktree ?? null);
};

const getProjectLabel = (path: string): string => {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1]?.replace(/[-_]/g, ' ') || normalized;
};

const formatSessionTime = (session: Session): string => {
  const raw = session.time?.updated ?? session.time?.created;
  const timestamp = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
};

const MobileSessionsSheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const { t } = useI18n();
  const sessions = useAllLiveSessions();
  const projects = useProjectsStore((state) => state.projects);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const filteredSessions = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions
      .filter((session) => {
        if (!normalizedQuery) return true;
        const haystack = `${session.title ?? ''} ${session.id} ${getSessionDirectory(session)}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aTime = Number(a.time?.updated ?? a.time?.created ?? 0);
        const bTime = Number(b.time?.updated ?? b.time?.created ?? 0);
        return bTime - aTime;
      });
  }, [query, sessions]);

  const groupedProjects = React.useMemo(() => {
    const knownProjects = projects.map((project) => ({
      id: project.id,
      label: project.label?.trim() || getProjectLabel(project.path),
      path: normalizePath(project.path),
      sessions: [] as Session[],
    }));
    const unassigned = {
      id: '__unassigned__',
      label: t('mobile.sessions.unassignedProject'),
      path: '',
      sessions: [] as Session[],
    };

    for (const session of filteredSessions) {
      const directory = getSessionDirectory(session);
      const project = knownProjects.find((entry) => directory === entry.path || directory.startsWith(`${entry.path}/`));
      (project ?? unassigned).sessions.push(session);
    }

    return [...knownProjects.filter((project) => project.sessions.length > 0), ...(unassigned.sessions.length > 0 ? [unassigned] : [])];
  }, [filteredSessions, projects, t]);

  if (!open) {
    return null;
  }

  const handleSelectSession = (session: Session) => {
    void setCurrentSession(session.id, getSessionDirectory(session) || null);
    onOpenChange(false);
  };

  const handleNewSession = (project: { id: string; path: string }) => {
    openNewSessionDraft({
      selectedProjectId: project.id === '__unassigned__' ? null : project.id,
      directoryOverride: project.path || null,
      preserveDirectoryOverride: Boolean(project.path),
    });
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgb(0_0_0_/_0.45)]" role="dialog" aria-modal="true" aria-label={t('mobile.sessions.sheet.title')}>
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={t('mobile.sessions.closeSheetAria')}
        onClick={() => onOpenChange(false)}
      />
      <section className="relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border/60 bg-background text-foreground shadow-xl">
        <div className="flex shrink-0 flex-col gap-3 border-b border-border/50 px-4 pb-3 pt-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-[var(--surface-muted)]" aria-hidden />
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="typography-title text-foreground">{t('mobile.sessions.sheet.title')}</h2>
              <p className="typography-meta text-muted-foreground">{t('mobile.sessions.sheet.description')}</p>
            </div>
            <button
              type="button"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('mobile.sessions.closeSheetAria')}
              onClick={() => onOpenChange(false)}
            >
              <RiCloseLine className="size-5" />
            </button>
          </div>
          <div className="relative">
            <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('mobile.sessions.search.placeholder')}
              className="pl-9"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {groupedProjects.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="typography-body text-muted-foreground">{t('mobile.sessions.empty')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groupedProjects.map((project) => (
                <section key={project.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate typography-ui-header text-foreground">{project.label}</h3>
                      {project.path ? <p className="truncate typography-micro text-muted-foreground">{project.path}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={t('mobile.sessions.newSessionAria')}
                      onClick={() => handleNewSession(project)}
                    >
                      <RiAddLine className="size-5" />
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated)]">
                    {project.sessions.map((session, index) => {
                      const active = currentSessionId === session.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            index > 0 && 'border-t border-border/50',
                            active ? 'bg-interactive-selection text-interactive-selection-foreground' : 'hover:bg-interactive-hover',
                          )}
                          onClick={() => handleSelectSession(session)}
                        >
                          <RiChat4Line className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate typography-ui-label text-foreground">{session.title || t('mobile.sessions.untitled')}</span>
                            <span className="block truncate typography-micro text-muted-foreground">{formatSessionTime(session) || session.id}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

const MobileHeader: React.FC<{ onOpenSessions: () => void }> = ({ onOpenSessions }) => {
  const { t } = useI18n();
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const sessions = useAllLiveSessions();
  const projects = useProjectsStore((state) => state.projects);

  const currentSession = React.useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );
  const projectLabel = React.useMemo(() => {
    const directory = normalizePath(currentDirectory);
    if (!directory) return t('mobile.header.noProject');
    const project = projects.find((entry) => {
      const projectPath = normalizePath(entry.path);
      return directory === projectPath || directory.startsWith(`${projectPath}/`);
    });
    return project?.label?.trim() || getProjectLabel(project?.path || directory);
  }, [currentDirectory, projects, t]);

  const sessionLabel = currentSession?.title?.trim() || (currentSessionId ? t('mobile.sessions.untitled') : t('mobile.header.noSession'));

  return (
    <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-3 border-b border-border/50 bg-background px-3 text-foreground">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t('mobile.sessions.openSheetAria')}
        onClick={onOpenSessions}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-elevated)] text-muted-foreground">
          <RiFolder6Line className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate typography-ui-label text-foreground">{sessionLabel}</span>
          <span className="truncate typography-micro text-muted-foreground">{projectLabel}</span>
        </span>
      </button>
    </header>
  );
};

const MobileBottomNav: React.FC<{
  activeSurface: MobileSurface;
  onSurfaceChange: (surface: MobileSurface) => void;
}> = ({ activeSurface, onSurfaceChange }) => {
  const { t } = useI18n();

  return (
    <nav className="grid shrink-0 grid-cols-4 border-t border-border/50 bg-background pb-[var(--oc-safe-area-bottom,0px)]" aria-label={t('mobile.nav.aria')}>
      {MOBILE_NAV_ITEMS.map(({ surface, labelKey, Icon }) => {
        const active = activeSurface === surface;
        return (
          <button
            key={surface}
            type="button"
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-1 px-2 typography-micro transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              active
                ? 'bg-interactive-selection text-interactive-selection-foreground'
                : 'text-muted-foreground hover:bg-interactive-hover hover:text-foreground',
            )}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSurfaceChange(surface)}
          >
            <Icon className="size-5" />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
};

const MobileShell: React.FC = () => {
  const [activeSurface, setActiveSurface] = React.useState<MobileSurface>('chat');
  const [sessionsSheetOpen, setSessionsSheetOpen] = React.useState(false);

  return (
    <div className="main-content-safe-area flex h-[100dvh] flex-col bg-background text-foreground" data-page-scroll-lock="true">
      {activeSurface === 'chat' ? <MobileHeader onOpenSessions={() => setSessionsSheetOpen(true)} /> : null}
      <main className="relative min-h-0 flex-1 overflow-hidden" data-page-scroll-lock="true">
        <div className={cn('absolute inset-0', activeSurface !== 'chat' && 'invisible')}>
          <ErrorBoundary>
            <ChatView />
          </ErrorBoundary>
        </div>
        {activeSurface === 'files' ? (
          <ErrorBoundary>
            <MobileFilesSurface />
          </ErrorBoundary>
        ) : null}
        {activeSurface === 'changes' ? (
          <ErrorBoundary>
            <MobileChangesSurface />
          </ErrorBoundary>
        ) : null}
        {activeSurface === 'settings' ? (
          <ErrorBoundary>
            <SettingsView forceMobile isWindowed visiblePageSlugs={[...MOBILE_SETTINGS_PAGES]} />
          </ErrorBoundary>
        ) : null}
      </main>
      <MobileBottomNav activeSurface={activeSurface} onSurfaceChange={setActiveSurface} />
      <MobileSessionsSheet open={sessionsSheetOpen} onOpenChange={setSessionsSheetOpen} />
    </div>
  );
};

export function MobileApp({ apis }: MobileAppProps) {
  const initializeApp = useConfigStore((state) => state.initializeApp);
  const isInitialized = useConfigStore((state) => state.isInitialized);
  const isConnected = useConfigStore((state) => state.isConnected);
  const providersCount = useConfigStore((state) => state.providers.length);
  const agentsCount = useConfigStore((state) => state.agents.length);
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const loadAgents = useConfigStore((state) => state.loadAgents);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const error = useSessionUIStore((state) => state.error);
  const clearError = useSessionUIStore((state) => state.clearError);
  const setIsMobile = useUIStore((state) => state.setIsMobile);
  const refreshGitHubAuthStatus = useGitHubAuthStore((state) => state.refreshStatus);
  const setPlanModeEnabled = useFeatureFlagsStore((state) => state.setPlanModeEnabled);

  React.useEffect(() => {
    registerRuntimeAPIs(apis);
    return () => registerRuntimeAPIs(null);
  }, [apis]);

  React.useEffect(() => {
    setIsMobile(true);
  }, [setIsMobile]);

  React.useEffect(() => {
    void initializeApp();
  }, [initializeApp]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (providersCount === 0) void loadProviders();
    if (agentsCount === 0) void loadAgents();
  }, [agentsCount, isConnected, loadAgents, loadProviders, providersCount]);

  React.useEffect(() => {
    if (!isConnected) return;
    opencodeClient.setDirectory(currentDirectory);
  }, [currentDirectory, isConnected]);

  React.useEffect(() => {
    void refreshGitHubAuthStatus(apis.github, { force: true });
  }, [apis.github, refreshGitHubAuthStatus]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const res = await fetch('/health', { method: 'GET' }).catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const data = (await res.json().catch(() => null)) as null | { planModeExperimentalEnabled?: unknown };
      if (!data || cancelled) return;
      const raw = data.planModeExperimentalEnabled;
      setPlanModeEnabled(raw === true || raw === 1 || raw === '1' || raw === 'true');
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [setPlanModeEnabled]);

  React.useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => clearError(), 5000);
    return () => window.clearTimeout(timeout);
  }, [clearError, error]);

  useAppFontEffects();
  usePushVisibilityBeacon({ enabled: true });
  useWindowTitle();
  useRouter();

  return (
    <ErrorBoundary>
      <SyncProvider sdk={opencodeClient.getSdkClient()} directory={currentDirectory || ''}>
        <RuntimeAPIProvider apis={apis}>
          <TooltipProvider delayDuration={300} skipDelayDuration={150}>
            <div className="h-full bg-background text-foreground">
              <SyncAppEffects embeddedBackgroundWorkEnabled={isInitialized} />
              <MobileShell />
              <Toaster />
            </div>
          </TooltipProvider>
        </RuntimeAPIProvider>
      </SyncProvider>
    </ErrorBoundary>
  );
}
