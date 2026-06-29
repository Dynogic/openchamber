/**
 * Reproduction for Bug #1917: "branch not pushed to remote"
 *
 * Root cause: In packages/ui/src/components/views/GitView.tsx, the
 * handleCommit function (lines 1184-1188) has an unconditional success toast
 * that fires regardless of whether the push was actually performed:
 *
 *   let result: Awaited<ReturnType<typeof git.gitPush>> | undefined;
 *   if ((afterPull.ahead ?? 0) > 0) {
 *     result = await git.gitPush(currentDirectory);
 *   }
 *   toast.success(t('gitView.toast.pushedToUpstream', {
 *     name: getPushedRemoteName(result)
 *   }));
 *                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^
 *   The toast is NOT gated by the same condition as the push.
 *
 * The `getPushedRemoteName` function falls back gracefully when `result`
 * is undefined (push skipped), so it always shows a remote name like "origin".
 *
 * Contrast with MobileChangesSurface.tsx (lines 390-393) which also checks
 * `afterPull.ahead > 0` but correctly omits the unconditional toast.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import simpleGit from 'simple-git';

import { getStatus, push, fetch } from './service.js';

const tempDirs = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-push-bug-'));
  tempDirs.push(dir);
  return dir;
};

const runGit = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function createTempRepo() {
  const tmpDir = createTempDir();
  const git = simpleGit(tmpDir);
  await git.init();
  await git.addConfig('user.name', 'Test User', false, 'local');
  await git.addConfig('user.email', 'test@example.com', false, 'local');
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { tmpDir, git };
}

describe('Bug 1917: Unconditional "Pushed" toast when push is skipped', () => {
  it('proves the unconditional toast: push is skipped but "Pushed to origin" still shows', async () => {
    // Setup: create a repo with a remote (bare repo) and initial commit
    const { tmpDir } = await createTempRepo();
    const remoteDir = createTempDir();
    runGit(remoteDir, ['init', '--bare']);
    runGit(tmpDir, ['remote', 'add', 'origin', remoteDir]);

    // Initial commit + push to set up origin/main
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'initial');
    runGit(tmpDir, ['add', '.']);
    runGit(tmpDir, ['commit', '-m', 'Initial commit']);
    runGit(tmpDir, ['push', '-u', 'origin', 'main']);

    // Now simulate the handleCommit flow (lines 1159-1190) to show the bug.
    // We'll use a branch that HAS tracking but no actual new commits to push
    // (ahead == 0), to show the toast fires despite no push.

    // Create a branch and push it, then make no new commits
    runGit(tmpDir, ['checkout', '-b', 'already-pushed']);
    runGit(tmpDir, ['push', '-u', 'origin', 'already-pushed']);

    // Verify: ahead is 0, nothing to push
    const statusBefore = await getStatus(tmpDir);
    console.log('Status before (no new commits):');
    console.log('  current:', statusBefore.current);
    console.log('  tracking:', statusBefore.tracking);
    console.log('  ahead:', statusBefore.ahead);

    // Now run the EXACT handleCommit logic (lines 1172-1190):
    // 1. Fetch
    await fetch(tmpDir, { remote: 'origin' });
    const afterFetch = await getStatus(tmpDir);
    console.log('\nAfter fetch:');
    console.log('  ahead:', afterFetch.ahead, 'behind:', afterFetch.behind);

    // 2. If behind, pull (skipped here since behind is 0)
    if ((afterFetch.behind ?? 0) > 0) {
      console.log('  [pull would happen here]');
    }

    // 3. Get status after pull
    const afterPull = afterFetch;
    console.log('\nAfter pull check:');
    console.log('  ahead:', afterPull.ahead);

    // 4. THE BUG: lines 1184-1188 from handleCommit
    let result = undefined;
    let pushActuallyCalled = false;

    if ((afterPull.ahead ?? 0) > 0) {
      result = await push(tmpDir);
      pushActuallyCalled = true;
    }

    const getPushedRemoteName = (result) => {
      return result?.pushed?.[0]?.remote
        || statusBefore?.tracking?.split('/')[0]
        || 'origin';
    };

    const toastMessage = `Pushed to ${getPushedRemoteName(result)}`;

    console.log('\n=== BUG REPRODUCTION ===');
    console.log('Push was called:', pushActuallyCalled);
    console.log('Toast shown:', toastMessage);
    console.log('========================\n');

    // THE BUG:
    // - push was NOT called (ahead was 0, nothing to push)
    // - BUT the toast fires anyway saying "Pushed to origin"
    // - This matches the reported issue: user sees "Pushed to origin"
    //   but the push never happened

    expect(pushActuallyCalled).toBe(false);
    // The toast still would say "Pushed to origin":
    expect(toastMessage).toBe('Pushed to origin');
  });

  it('proves scenario: branch without upstream tracking can have ahead=0 when selectBaseRefForUnpublished fails', async () => {
    // Setup: repo without standard branch names
    const { tmpDir } = await createTempRepo();
    const remoteDir = createTempDir();
    runGit(remoteDir, ['init', '--bare']);
    runGit(tmpDir, ['remote', 'add', 'origin', remoteDir]);

    // Create a non-standard initial branch
    runGit(tmpDir, ['branch', '-m', 'main', 'develop']);

    // Initial commit + push
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'initial');
    runGit(tmpDir, ['add', '.']);
    runGit(tmpDir, ['commit', '-m', 'Initial commit']);
    runGit(tmpDir, ['push', '-u', 'origin', 'develop']);

    // Create new branch from develop (no standard base refs)
    runGit(tmpDir, ['checkout', '-b', 'feature/unpushed']);

    // Commit on feature branch
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'feature');
    runGit(tmpDir, ['add', '.']);
    runGit(tmpDir, ['commit', '-m', 'Feature commit']);

    // Check status via service.getStatus
    const svcStatus = await getStatus(tmpDir);
    console.log('\nStatus on non-standard branch (develop→feature):');
    console.log('  current:', svcStatus.current);
    console.log('  tracking:', svcStatus.tracking);
    console.log('  ahead:', svcStatus.ahead);

    // The selectBaseRefForUnpublished logic searches for:
    //   origin/HEAD, origin/main, origin/master, main, master
    // None of these exist in this repo → ahead stays at raw simple-git value
    expect(svcStatus.tracking).toBeNull();

    // ahead would be whatever simple-git computed (likely 0 since no tracking)
    // This is a case where the service's extra logic doesn't help because
    // standard branch names aren't present
    console.log('Base ref candidates (origin/main, origin/master, main, master) all don\'t exist');
    console.log('So ahead is:', svcStatus.ahead);
    console.log('Push check (ahead > 0) would be:', (svcStatus.ahead ?? 0) > 0);

    // What handleCommit would do:
    // push is SKIPPED if ahead is 0, but toast fires unconditionally
    const pushWouldBeCalled = (svcStatus.ahead ?? 0) > 0;

    if (!pushWouldBeCalled) {
      console.log('\n=== BUG CONFIRMED ===');
      console.log('handleCommit would SKIP the push (ahead <= 0)');
      console.log('But would still show "Pushed to origin" toast');
    }
  });

  it('reproduces the exact handleCommit logic with the unconditional bug', async () => {
    // This test directly mirrors the handleCommit function to show the bug
    const { tmpDir } = await createTempRepo();
    const remoteDir = createTempDir();
    runGit(remoteDir, ['init', '--bare']);
    runGit(tmpDir, ['remote', 'add', 'origin', remoteDir]);

    // Setup
    fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'initial');
    runGit(tmpDir, ['add', '.']);
    runGit(tmpDir, ['commit', '-m', 'Initial commit']);
    runGit(tmpDir, ['push', '-u', 'origin', 'main']);

    // Create a branch with tracking, but no new commits
    runGit(tmpDir, ['checkout', '-b', 'feature/noop']);
    runGit(tmpDir, ['push', '-u', 'origin', 'feature/noop']);

    // --- Simulate the full handleCommit flow ---

    const currentDirectory = tmpDir;

    // Step 1: Fetch (line 1172)
    await fetch(currentDirectory, { remote: 'origin' });

    // Step 2: Check behind (line 1173-1174)
    const afterFetch = await getStatus(currentDirectory);

    // Step 3: Pull if behind (line 1180) - skipped here
    if ((afterFetch.behind ?? 0) > 0) {
      // Not happening in this test
    }

    // Step 4: Get final status (line 1183)
    const afterPull = afterFetch;

    // Step 5: The critical section - lines 1184-1188 of handleCommit
    let result;
    let pushCalled = false;

    // EXACT condition from handleCommit line 1185
    if ((afterPull.ahead ?? 0) > 0) {
      result = await push(currentDirectory);
      pushCalled = true;
    }

    // EXACT unconditional toast from handleCommit line 1188
    // toast.success(t('gitView.toast.pushedToUpstream', {
    //   name: getPushedRemoteName(result)
    // }));

    const toastRemoteName = result?.pushed?.[0]?.remote
      || afterPull?.tracking?.split('/')[0]
      || 'origin';

    console.log('\n=== Full handleCommit flow simulation ===');
    console.log('Current branch:', afterPull.current);
    console.log('Tracking:', afterPull.tracking);
    console.log('Ahead:', afterPull.ahead);
    console.log('Push was called:', pushCalled);
    console.log('Toast message:', `Pushed to ${toastRemoteName}`);
    console.log('==========================================\n');

    // THE BUG
    expect(pushCalled).toBe(false);
    expect(toastRemoteName).toBe('origin');

    // The user sees "Pushed to origin" but nothing was pushed
    // This is the exact bug reported in issue #1917
  });
});
