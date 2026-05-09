import React from 'react';
import { File as PierreFile } from '@pierre/diffs/react';
import {
  RiArrowLeftLine,
  RiClipboardLine,
  RiFileCopyLine,
  RiFolder3Fill,
  RiFolderOpenFill,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
} from '@remixicon/react';

import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { JsonTreeView } from '@/components/ui/JsonTreeView';
import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import { ensurePierreThemeRegistered } from '@/lib/shiki/appThemeRegistry';
import { getDefaultTheme } from '@/lib/theme/themes';
import { getImageMimeType, getLanguageFromExtension, isImageFile } from '@/lib/toolHelpers';
import type { FileListEntry, FileSearchResult } from '@/lib/api/types';
import { cn } from '@/lib/utils';

type MobileFilesRoute =
  | { type: 'browser'; directory: string }
  | { type: 'file'; path: string; returnDirectory: string };

const MAX_MOBILE_FILE_CHARS = 250_000;

const normalizePath = (value?: string | null): string => (value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

const getNameFromPath = (path: string): string => {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') return normalized || '/';
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
};

const getParentDirectory = (path: string): string | null => {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') return null;
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : null;
  return normalized.slice(0, index);
};

const getRelativePath = (path: string, root: string): string => {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot || normalizedPath === normalizedRoot) return getNameFromPath(normalizedPath);
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) return normalizedPath.slice(normalizedRoot.length + 1);
  return normalizedPath;
};

const formatFileSize = (size?: number): string => {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return '';
};

const getImageSrc = (path: string): string => {
  if (path.toLowerCase().endsWith('.svg')) {
    return '';
  }
  return `/api/fs/raw?${new URLSearchParams({ path }).toString()}`;
};

const isMarkdownFile = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path);
const isJsonFile = (path: string): boolean => /\.(json|jsonc)$/i.test(path);

export const MobileFilesSurface: React.FC = () => {
  const { t } = useI18n();
  const { files } = useRuntimeAPIs();
  const root = normalizePath(useEffectiveDirectory() ?? null);
  const [route, setRoute] = React.useState<MobileFilesRoute>(() => ({ type: 'browser', directory: root }));
  const [entries, setEntries] = React.useState<FileListEntry[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = React.useState(false);
  const [directoryError, setDirectoryError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [fileContent, setFileContent] = React.useState('');
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = React.useState(false);

  React.useEffect(() => {
    if (!root) return;
    setRoute((current) => {
      if (current.type === 'browser' && current.directory) return current;
      return { type: 'browser', directory: root };
    });
  }, [root]);

  const currentDirectory = route.type === 'browser' ? route.directory : route.returnDirectory;

  const loadDirectory = React.useCallback(async (directory: string) => {
    if (!directory) return;
    setIsLoadingDirectory(true);
    setDirectoryError(null);
    try {
      const result = await files.listDirectory(directory);
      setEntries(result.entries.slice().sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
    } catch (error) {
      setEntries([]);
      setDirectoryError(error instanceof Error ? error.message : t('mobile.files.error.listFailed'));
    } finally {
      setIsLoadingDirectory(false);
    }
  }, [files, t]);

  React.useEffect(() => {
    if (route.type !== 'browser') return;
    void loadDirectory(route.directory);
  }, [loadDirectory, route]);

  React.useEffect(() => {
    if (route.type !== 'browser') return;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      void files.search({ directory: route.directory, query: normalizedQuery, maxResults: 40 })
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [files, query, route]);

  React.useEffect(() => {
    if (route.type !== 'file') return;
    setFileContent('');
    setFileError(null);

    if (isImageFile(route.path) && !route.path.toLowerCase().endsWith('.svg')) {
      setIsLoadingFile(false);
      return;
    }

    if (!files.readFile) {
      setFileError(t('mobile.files.error.readUnavailable'));
      setIsLoadingFile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    void files.readFile(route.path)
      .then((result) => {
        if (cancelled) return;
        setFileContent(result.content.length > MAX_MOBILE_FILE_CHARS
          ? `${result.content.slice(0, MAX_MOBILE_FILE_CHARS)}\n\n${t('mobile.files.file.truncated')}`
          : result.content);
      })
      .catch((error) => {
        if (!cancelled) setFileError(error instanceof Error ? error.message : t('filesView.error.readFileFailed'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [files, route, t]);

  const openDirectory = (directory: string) => {
    setQuery('');
    setRoute({ type: 'browser', directory });
  };

  const openFile = (path: string) => {
    setRoute({ type: 'file', path, returnDirectory: currentDirectory || root });
  };

  const handleCopyPath = async (path: string) => {
    const result = await copyTextToClipboard(path);
    if (result.ok) toast.success(t('mobile.files.toast.pathCopied'));
    else toast.error(t('mobile.files.toast.copyFailed'));
  };

  const handleCopyContent = async () => {
    const result = await copyTextToClipboard(fileContent);
    if (result.ok) toast.success(t('mobile.files.toast.contentCopied'));
    else toast.error(t('mobile.files.toast.copyFailed'));
  };

  if (!root) {
    return <MobileFilesState message={t('mobile.files.empty.noDirectory')} />;
  }

  if (route.type === 'file') {
    return (
      <MobileFileDetail
        path={route.path}
        content={fileContent}
        error={fileError}
        isLoading={isLoadingFile}
        onBack={() => setRoute({ type: 'browser', directory: route.returnDirectory })}
        onCopyPath={() => void handleCopyPath(route.path)}
        onCopyContent={() => void handleCopyContent()}
      />
    );
  }

  const parentDirectory = getParentDirectory(route.directory);
  const directoryLabel = route.directory === root ? t('mobile.files.rootDirectory') : getNameFromPath(route.directory);
  const visibleSearchResults = query.trim() ? searchResults : [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-3 border-b border-border/50 px-3 text-foreground">
        <div className="min-w-0 flex-1 px-2">
          <h2 className="truncate typography-ui-label text-foreground">{directoryLabel}</h2>
          <p className="truncate typography-micro text-muted-foreground">{t('layout.mainTab.files')}</p>
        </div>
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('mobile.files.refreshAria')}
          onClick={() => void loadDirectory(route.directory)}
        >
          <RiRefreshLine className={cn('size-5', isLoadingDirectory && 'animate-spin')} />
        </button>
      </header>
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <div className="relative">
          <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('mobile.files.search.placeholder')} className="pl-9" />
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {directoryError ? (
          <MobileFilesState message={directoryError} />
        ) : query.trim() ? (
          <MobileSearchResults results={visibleSearchResults} isSearching={isSearching} onOpenFile={openFile} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated)]">
            {parentDirectory ? (
              <MobileFileRow
                name={t('mobile.files.parentDirectory')}
                path={parentDirectory}
                directory
                meta={getNameFromPath(parentDirectory)}
                onClick={() => openDirectory(parentDirectory)}
              />
            ) : null}
            {entries.length === 0 && !isLoadingDirectory ? (
              <div className="px-4 py-8 text-center typography-body text-muted-foreground">{t('mobile.files.empty.directory')}</div>
            ) : null}
            {entries.map((entry) => (
              <MobileFileRow
                key={entry.path}
                name={entry.name}
                path={entry.path}
                directory={entry.isDirectory}
                meta={entry.isDirectory ? undefined : formatFileSize(entry.size)}
                onClick={() => entry.isDirectory ? openDirectory(entry.path) : openFile(entry.path)}
              />
            ))}
          </div>
        )}
      </ScrollShadow>
    </div>
  );
};

const MobileFileRow: React.FC<{
  name: string;
  path: string;
  directory: boolean;
  meta?: string;
  onClick: () => void;
}> = ({ name, path, directory, meta, onClick }) => (
  <button
    type="button"
    className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-3 text-left last:border-b-0 hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    onClick={onClick}
  >
    {directory ? <RiFolder3Fill className="size-4 shrink-0 text-primary/70" /> : <FileTypeIcon filePath={path} className="size-4 shrink-0" />}
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="block truncate typography-ui-label text-foreground">{name}</span>
      {meta ? <span className="ml-auto shrink-0 typography-micro text-muted-foreground">{meta}</span> : null}
    </span>
  </button>
);

const MobileSearchResults: React.FC<{
  results: FileSearchResult[];
  isSearching: boolean;
  onOpenFile: (path: string) => void;
}> = ({ results, isSearching, onOpenFile }) => {
  const { t } = useI18n();
  const root = normalizePath(useEffectiveDirectory() ?? null);
  if (isSearching) return <MobileFilesState loading message={t('common.loading')} />;
  if (results.length === 0) return <MobileFilesState message={t('mobile.files.search.empty')} />;
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated)]">
      {results.map((result) => (
        <MobileFileRow key={result.path} name={getNameFromPath(result.path)} path={result.path} directory={false} meta={getRelativePath(result.path, root)} onClick={() => onOpenFile(result.path)} />
      ))}
    </div>
  );
};

const MobileFileDetail: React.FC<{
  path: string;
  content: string;
  error: string | null;
  isLoading: boolean;
  onBack: () => void;
  onCopyPath: () => void;
  onCopyContent: () => void;
}> = ({ path, content, error, isLoading, onBack, onCopyPath, onCopyContent }) => {
  const { t } = useI18n();
  const imageSrc = getImageSrc(path);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-3 border-b border-border/50 px-3 text-foreground">
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('header.actions.backAria')}
          onClick={onBack}
        >
          <RiArrowLeftLine className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate typography-ui-header text-foreground">{getNameFromPath(path)}</h2>
        </div>
        {!isImageFile(path) ? (
          <Button type="button" variant="ghost" size="icon" onClick={onCopyContent} aria-label={t('mobile.files.copyContentAria')}>
            <RiFileCopyLine className="size-4" />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" onClick={onCopyPath} aria-label={t('mobile.files.copyPathAria')}>
          <RiClipboardLine className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <MobileFilesState loading message={t('filesView.state.loading')} />
        ) : error ? (
          <MobileFilesState message={error} />
        ) : isImageFile(path) && imageSrc ? (
          <ScrollShadow className="h-full overflow-auto p-4">
            <img src={imageSrc} alt={getNameFromPath(path)} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
          </ScrollShadow>
        ) : isImageFile(path) ? (
          <ScrollShadow className="h-full overflow-auto p-4">
            <img src={`data:${getImageMimeType(path)};utf8,${encodeURIComponent(content)}`} alt={getNameFromPath(path)} className="mx-auto max-h-full max-w-full rounded-lg object-contain" />
          </ScrollShadow>
        ) : (
          <MobileTextFile path={path} content={content} />
        )}
      </div>
    </div>
  );
};

const MobileTextFile: React.FC<{ path: string; content: string }> = ({ path, content }) => {
  const { currentTheme, availableThemes, lightThemeId, darkThemeId } = useThemeSystem();
  const lightTheme = React.useMemo(
    () => availableThemes.find((theme) => theme.metadata.id === lightThemeId) ?? getDefaultTheme(false),
    [availableThemes, lightThemeId],
  );
  const darkTheme = React.useMemo(
    () => availableThemes.find((theme) => theme.metadata.id === darkThemeId) ?? getDefaultTheme(true),
    [availableThemes, darkThemeId],
  );

  React.useEffect(() => {
    ensurePierreThemeRegistered(lightTheme);
    ensurePierreThemeRegistered(darkTheme);
  }, [darkTheme, lightTheme]);

  const pierreTheme = React.useMemo(
    () => ({ light: lightTheme.metadata.id, dark: darkTheme.metadata.id }),
    [darkTheme.metadata.id, lightTheme.metadata.id],
  );

  if (isMarkdownFile(path)) {
    return (
      <ScrollShadow className="h-full overflow-y-auto px-4 py-4">
        <SimpleMarkdownRenderer content={content} />
      </ScrollShadow>
    );
  }
  if (isJsonFile(path)) {
    return <JsonTreeView jsonString={content} className="h-full overflow-auto" />;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScrollShadow className="min-h-0 flex-1 overflow-auto bg-[var(--syntax-base-background)]">
        <PierreFile
          file={{
            name: getNameFromPath(path),
            contents: content,
            lang: getLanguageFromExtension(path) || undefined,
          }}
          options={{
            disableFileHeader: true,
            overflow: 'wrap',
            theme: pierreTheme,
            themeType: currentTheme.metadata.variant === 'dark' ? 'dark' : 'light',
          }}
          className="block min-h-full w-full"
          style={{ minHeight: '100%' }}
        />
      </ScrollShadow>
    </div>
  );
};

const MobileFilesState: React.FC<{ message: string; loading?: boolean }> = ({ message, loading = false }) => (
  <div className="flex h-full items-center justify-center px-6 text-center">
    <div className="flex max-w-sm flex-col items-center gap-2">
      {loading ? <RiLoader4Line className="size-5 animate-spin text-muted-foreground" /> : <RiFolderOpenFill className="size-6 text-muted-foreground" />}
      <p className="typography-ui-label font-semibold text-foreground">{message}</p>
    </div>
  </div>
);
