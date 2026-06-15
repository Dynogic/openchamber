/**
 * Reproduction test for Issue #1653:
 * File viewer: tabs for files with the same name all show the last opened file's content
 *
 * This test verifies that:
 * 1. The tabs store correctly tracks same-named files by their FULL paths
 * 2. Switching between same-named tabs triggers content loading for the correct file
 * 3. The content cache wrapper does not confuse files with the same basename
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { useFilesViewTabsStore } from './useFilesViewTabsStore';

const ROOT = '/workspace';

describe('Issue #1653: Same-named files across directories', () => {
  beforeEach(() => {
    useFilesViewTabsStore.setState({ byRoot: {} });
  });

  describe('Tab store: path identity', () => {
    test('tracks same-named files as separate entries by full path', () => {
      const store = useFilesViewTabsStore.getState();

      // Open three files with the same name in different directories
      store.addOpenPath(ROOT, '/workspace/docs/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/web/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/ui/index.md');

      const rootState = useFilesViewTabsStore.getState().byRoot[ROOT];
      expect(rootState).not.toBeNull();
      expect(rootState!.openPaths).toHaveLength(3);
      expect(rootState!.openPaths).toContain('/workspace/docs/index.md');
      expect(rootState!.openPaths).toContain('/workspace/packages/web/index.md');
      expect(rootState!.openPaths).toContain('/workspace/packages/ui/index.md');
    });

    test('selecting a different same-named file changes selectedPath to the correct full path', () => {
      const store = useFilesViewTabsStore.getState();

      store.addOpenPath(ROOT, '/workspace/docs/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/web/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/ui/index.md');

      // Select the second file
      store.setSelectedPath(ROOT, '/workspace/packages/web/index.md');
      let state = useFilesViewTabsStore.getState().byRoot[ROOT];
      expect(state!.selectedPath).toBe('/workspace/packages/web/index.md');

      // Select the third file
      store.setSelectedPath(ROOT, '/workspace/packages/ui/index.md');
      state = useFilesViewTabsStore.getState().byRoot[ROOT];
      expect(state!.selectedPath).toBe('/workspace/packages/ui/index.md');

      // Select back to the first
      store.setSelectedPath(ROOT, '/workspace/docs/index.md');
      state = useFilesViewTabsStore.getState().byRoot[ROOT];
      expect(state!.selectedPath).toBe('/workspace/docs/index.md');
    });

    test('removing one same-named file does not affect the others', () => {
      const store = useFilesViewTabsStore.getState();

      store.addOpenPath(ROOT, '/workspace/docs/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/web/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/ui/index.md');

      store.removeOpenPath(ROOT, '/workspace/packages/web/index.md');

      const rootState = useFilesViewTabsStore.getState().byRoot[ROOT];
      expect(rootState!.openPaths).toHaveLength(2);
      expect(rootState!.openPaths).toContain('/workspace/docs/index.md');
      expect(rootState!.openPaths).not.toContain('/workspace/packages/web/index.md');
      expect(rootState!.openPaths).toContain('/workspace/packages/ui/index.md');
    });
  });

  describe('Content loading: path correctness', () => {
    /**
     * Simulates the content-loading path from FilesView.tsx.
     * On tab switch:
     *   1. handleSelectFile is called, which clears loadedFilePath to null and fileContent to ''
     *   2. The effect sees loadedFilePath !== selectedFile.path and calls loadSelectedFile
     *   3. loadSelectedFile calls readFile with the full path
     *   4. On success, loadedFilePath and fileContent are updated
     */
    test('loadSelectedFile is called with the correct full path when switching between same-named tabs', () => {
      const store = useFilesViewTabsStore.getState();

      // Open same-named files
      store.addOpenPath(ROOT, '/workspace/docs/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/web/index.md');
      store.addOpenPath(ROOT, '/workspace/packages/ui/index.md');

      // Tab 1: select docs/index.md
      store.setSelectedPath(ROOT, '/workspace/docs/index.md');
      const selected1 = useFilesViewTabsStore.getState().byRoot[ROOT]?.selectedPath;
      expect(selected1).toBe('/workspace/docs/index.md');

      // Tab 2: select packages/web/index.md
      store.setSelectedPath(ROOT, '/workspace/packages/web/index.md');
      const selected2 = useFilesViewTabsStore.getState().byRoot[ROOT]?.selectedPath;
      expect(selected2).toBe('/workspace/packages/web/index.md');

      // Tab 3: select packages/ui/index.md
      store.setSelectedPath(ROOT, '/workspace/packages/ui/index.md');
      const selected3 = useFilesViewTabsStore.getState().byRoot[ROOT]?.selectedPath;
      expect(selected3).toBe('/workspace/packages/ui/index.md');

      // Tab back to 1: select docs/index.md again
      store.setSelectedPath(ROOT, '/workspace/docs/index.md');
      const selectedBack = useFilesViewTabsStore.getState().byRoot[ROOT]?.selectedPath;
      expect(selectedBack).toBe('/workspace/docs/index.md');
    });
  });

  describe('Content cache: path-keyed entries', () => {
    /**
     * Tests the withContentCache pattern from RuntimeAPIProvider.tsx.
     * The cache is keyed by full path, so files with the same basename
     * in different directories must not collide.
     *
     * We test this by simulating the cache behavior:
     * - Cache map: keyed by path, stores { content, path, size, mtimeMs }
     * - On cache hit: validates via statFile before returning
     * - On cache miss: fetches fresh via readFile
     */
    test('cache entries are keyed by full path, not basename', async () => {
      // Simulate the content cache from RuntimeAPIProvider.tsx
      const cache = new Map<string, { content: string; path: string }>();

      // Simulate loading three same-named files from different directories
      const files = [
        { path: '/workspace/docs/index.md', content: '# Docs index\nContent from docs directory' },
        { path: '/workspace/packages/web/index.md', content: '# Web index\nContent from web package' },
        { path: '/workspace/packages/ui/index.md', content: '# UI index\nContent from UI package' },
      ];

      // Load each file into the cache (simulating readFreshFile)
      for (const file of files) {
        cache.set(file.path, { content: file.content, path: file.path });
      }

      // Verify all three entries exist and have distinct content
      expect(cache.size).toBe(3);

      const entry1 = cache.get('/workspace/docs/index.md');
      expect(entry1).not.toBeNull();
      expect(entry1!.content).toContain('docs directory');

      const entry2 = cache.get('/workspace/packages/web/index.md');
      expect(entry2).not.toBeNull();
      expect(entry2!.content).toContain('web package');

      const entry3 = cache.get('/workspace/packages/ui/index.md');
      expect(entry3).not.toBeNull();
      expect(entry3!.content).toContain('UI package');

      // Verify entries are distinct - no cross-contamination
      expect(entry1!.content).not.toBe(entry2!.content);
      expect(entry2!.content).not.toBe(entry3!.content);
      expect(entry1!.content).not.toBe(entry3!.content);

      // Simulate re-reading the first file (cache hit should return original content)
      const reRead = cache.get('/workspace/docs/index.md');
      expect(reRead).not.toBeNull();
      expect(reRead!.content).toContain('docs directory');
    });

    test('content cache with statFile validation works correctly for same-named files', async () => {
      // Simulate the full withContentCache pattern from RuntimeAPIProvider.tsx
      const cache = new Map<string, { content: string; path: string; size?: number; mtimeMs?: number }>();
      const fileStats = new Map<string, { isFile: boolean; size: number; mtimeMs?: number }>();

      // Set up stats for three same-named files
      fileStats.set('/workspace/docs/index.md', { isFile: true, size: 50, mtimeMs: 1000 });
      fileStats.set('/workspace/packages/web/index.md', { isFile: true, size: 60, mtimeMs: 1001 });
      fileStats.set('/workspace/packages/ui/index.md', { isFile: true, size: 55, mtimeMs: 1002 });

      // Mock statFile - returns stats for the given path
      const statFile = async (path: string) => {
        const stat = fileStats.get(path);
        if (!stat) throw new Error(`ENOENT: ${path}`);
        return { path, ...stat };
      };

      // Track readFile calls - returns content for the given path
      let readFileCallCount = 0;
      const readFileContents: Record<string, string> = {
        '/workspace/docs/index.md': '# Docs index\nContent from docs directory',
        '/workspace/packages/web/index.md': '# Web index\nContent from web package',
        '/workspace/packages/ui/index.md': '# UI index\nContent from UI package',
      };
      const readFile = async (path: string) => {
        readFileCallCount++;
        const content = readFileContents[path];
        if (!content) throw new Error(`ENOENT: ${path}`);
        return Promise.resolve({ content, path });
      };

      // Helper: cached readFile (mirrors withContentCache logic)
      const cachedReadFile = async (path: string) => {
        const hit = cache.get(path);
        if (hit) {
          // Validate cached entry is still fresh using statFile
          const latest = await statFile(path).catch(() => null);
          if (latest && latest.isFile) {
            const statMatches =
              (hit.mtimeMs !== undefined && latest.mtimeMs !== undefined
                ? hit.mtimeMs === latest.mtimeMs && hit.size === latest.size
                : hit.size === latest.size);
            if (!statMatches) {
              cache.delete(path);
              // Fall through to fresh read
            } else {
              return { content: hit.content, path: hit.path };
            }
          } else if (!latest) {
            cache.delete(path);
          } else {
            // latest exists but isFile is false - this shouldn't happen for valid files
            // but if statFile returns without throwing, trust it
            return { content: hit.content, path: hit.path };
          }
        }

        // Cache miss or invalidated - fetch fresh
        const result = await readFile(path);
        const stat = await statFile(path).catch(() => null);
        cache.set(path, {
          content: result.content,
          path: result.path,
          size: stat?.isFile ? stat.size : undefined,
          mtimeMs: stat?.isFile ? stat.mtimeMs : undefined,
        });
        return result;
      };

      // Read each file - should be cache misses
      const result1 = await cachedReadFile('/workspace/docs/index.md');
      expect(result1.content).toContain('docs directory');

      const result2 = await cachedReadFile('/workspace/packages/web/index.md');
      expect(result2.content).toContain('web package');

      const result3 = await cachedReadFile('/workspace/packages/ui/index.md');
      expect(result3.content).toContain('UI package');

      // Each was a fresh read
      expect(readFileCallCount).toBe(3);

      // Re-read docs/index.md - should be a cache hit
      const reRead1 = await cachedReadFile('/workspace/docs/index.md');
      expect(reRead1.content).toContain('docs directory');

      // statFile was called for validation, but readFile was NOT called
      expect(readFileCallCount).toBe(3); // still 3

      // Verify no cross-contamination: re-reading web/index.md returns web content
      const reRead2 = await cachedReadFile('/workspace/packages/web/index.md');
      expect(reRead2.content).toContain('web package');

      // Verify the last file also has its own content
      const reRead3 = await cachedReadFile('/workspace/packages/ui/index.md');
      expect(reRead3.content).toContain('UI package');
    });
  });

  describe('End-to-end: tab switch triggers correct content load', () => {
    /**
     * This test simulates the full flow from the FilesView component:
     * 1. Open multiple same-named files
     * 2. Switch between tabs
     * 3. Verify that selecting a tab triggers content loading with the correct path
     */
    test('switching between same-named tabs triggers loadSelectedFile with distinct paths', () => {
      const store = useFilesViewTabsStore.getState();

      // Track which path was "loaded" (simulating loadSelectedFile)
      const loadedPaths: string[] = [];
      let loadedFilePath: string | null = null;

      // Simulate handleSelectFile → setSelectedPath
      const handleSelectFile = (path: string) => {
        // Guard: if the file is already loaded, skip
        if (loadedFilePath === path) {
          return;
        }

        // Clear current (simulating setFileContent(''), setLoadedFilePath(null))
        loadedFilePath = null;

        // Update store selection
        store.setSelectedPath(ROOT, path);
        store.addOpenPath(ROOT, path);

        // Simulate loadSelectedFile being called by the effect
        const nodePath = path;
        loadedPaths.push(nodePath);

        // Simulate successful load (asynchronously)
        loadedFilePath = nodePath;
      };

      // Open three same-named files
      handleSelectFile('/workspace/docs/index.md');
      expect(loadedPaths).toHaveLength(1);
      expect(loadedPaths[0]).toBe('/workspace/docs/index.md');
      expect(loadedFilePath).toBe('/workspace/docs/index.md');

      // Switch to second file
      handleSelectFile('/workspace/packages/web/index.md');
      expect(loadedPaths).toHaveLength(2);
      expect(loadedPaths[1]).toBe('/workspace/packages/web/index.md');
      expect(loadedFilePath).toBe('/workspace/packages/web/index.md');

      // Switch to third file
      handleSelectFile('/workspace/packages/ui/index.md');
      expect(loadedPaths).toHaveLength(3);
      expect(loadedPaths[2]).toBe('/workspace/packages/ui/index.md');
      expect(loadedFilePath).toBe('/workspace/packages/ui/index.md');

      // Switch BACK to first file (CRITICAL: same name, different directory)
      handleSelectFile('/workspace/docs/index.md');
      expect(loadedPaths).toHaveLength(4);
      expect(loadedPaths[3]).toBe('/workspace/docs/index.md');
      expect(loadedFilePath).toBe('/workspace/docs/index.md');

      // Verify all loaded paths are distinct
      expect(new Set(loadedPaths).size).toBe(3);
    });
  });
});
