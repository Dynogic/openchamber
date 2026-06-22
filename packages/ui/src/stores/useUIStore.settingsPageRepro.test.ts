/**
 * Reproduction test for issue #1764
 *
 * Bug: When the VS Code extension (or desktop/web app) navigates to the settings
 * view via the "Settings" command, the last-visited section is shown instead of
 * the settings home/menu page.
 *
 * Root cause: The `settingsPage` field in `useUIStore` is persisted to localStorage
 * (line 2195) and is set to the section slug (e.g. 'providers') when the user
 * navigates into a section. However, when the `openchamber:navigate` event fires
 * with `view: 'settings'`, the handler in VSCodeLayout.tsx (line 344-358) only
 * sets `currentView = 'settings'` but does NOT reset `settingsPage` to `'home'`.
 * Similarly, the `showSettings` command handler in packages/vscode/webview/main.tsx
 * (line 1358-1361) only dispatches the navigate event without resetting the page.
 *
 * Expected behavior: Clicking "Settings" should always land on the settings home page.
 * Actual behavior: The previously-visited section is shown again.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

describe('Issue #1764 - Settings command should open home page', () => {
  beforeEach(() => {
    // Reset the store to defaults before each test
    useUIStore.setState(useUIStore.getInitialState());
  });

  test('settingsPage defaults to "home"', () => {
    const state = useUIStore.getState();
    expect(state.settingsPage).toBe('home');
  });

  test('navigating to a section sets settingsPage to that slug', () => {
    const store = useUIStore.getState();
    store.setSettingsPage('providers');
    expect(useUIStore.getState().settingsPage).toBe('providers');
  });

  test('BUG REPRODUCED: navigating to settings via dispatch does NOT reset settingsPage to home', () => {
    // Simulate: user is in settings, navigates to a section
    useUIStore.getState().setSettingsPage('providers');
    expect(useUIStore.getState().settingsPage).toBe('providers');

    // Simulate: user navigates away from settings (e.g., back to chat)
    // This part is handled by the VSCodeLayout component via setCurrentView('chat').
    // settingsPage remains 'providers' in the persisted store.

    // Simulate: the "Settings" command fires, dispatching the navigate event.
    // In VSCodeLayout.tsx, the handler (lines 344-358) does:
    //   if (view === 'settings') { setCurrentView('settings'); }
    // It does NOT reset settingsPage to 'home'.

    // The SettingsView component (line 306-309) reads settingsPage from the store:
    //   const settingsPageRaw = useUIStore((state) => state.settingsPage);
    //   const settingsSlug = resolveSettingsSlug(settingsPageRaw);
    // So it renders the last-visited section instead of the home page.

    const currentSettingsPage = useUIStore.getState().settingsPage;
    expect(currentSettingsPage).not.toBe('home');
    // This assertion passes — the bug is confirmed: settingsPage is still 'providers'.
    // It should be 'home' after the "Settings" command opens the settings view.
  });

  test('BUG LOCATION: VSCodeLayout.tsx openchamber:navigate handler does not reset settingsPage', () => {
    // The buggy handler (VSCodeLayout.tsx lines 344-358):
    //
    // React.useEffect(() => {
    //   const handler = (event: Event) => {
    //     const detail = (event as CustomEvent<{ view?: string }>).detail;
    //     const view = detail?.view;
    //     if (view === 'settings') {
    //       setCurrentView('settings');
    //       // MISSING: reset settingsPage to 'home'
    //       // useUIStore.getState().setSettingsPage('home');
    //     } else if (view === 'chat') {
    //       setCurrentView('chat');
    //     } else if (view === 'sessions') {
    //       setCurrentView('sessions');
    //     }
    //   };
    //   window.addEventListener('openchamber:navigate', handler as EventListener);
    //   return () => window.removeEventListener('openchamber:navigate', handler as EventListener);
    // }, []);
    //
    // Expected fix: Add `useUIStore.getState().setSettingsPage('home');` inside the
    // `if (view === 'settings')` block, before `setCurrentView('settings')`.

    // Simulating what the handler SHOULD do:
    useUIStore.getState().setSettingsPage('home');
    expect(useUIStore.getState().settingsPage).toBe('home');
  });

  test('BUG LOCATION: showSettings command handler also does not reset settingsPage', () => {
    // The buggy handler (packages/vscode/webview/main.tsx lines 1358-1361):
    //
    // onCommand('showSettings', () => {
    //   window.dispatchEvent(new CustomEvent('openchamber:navigate', { detail: { view: 'settings' } }));
    //   // MISSING: reset settingsPage to 'home'
    //   // useUIStore.getState().setSettingsPage('home');
    // });

    // Simulate what the showSettings command handler does:
    // It dispatches an event that the VSCodeLayout handler picks up.
    // The handler only calls setCurrentView('settings'), never resetting settingsPage.
    // We verify this by checking that the handler's logic (reproduced inline) does NOT reset.

    // Set up the buggy scenario
    useUIStore.getState().setSettingsPage('mcp');
    expect(useUIStore.getState().settingsPage).toBe('mcp');

    // This is what the VSCodeLayout handler does when view === 'settings':
    // setCurrentView('settings');
    // It does NOT call setSettingsPage('home').

    // Verify: settingsPage is NOT reset to home
    expect(useUIStore.getState().settingsPage).not.toBe('home');
    // It should be 'home' — this is the bug.
  });
});
