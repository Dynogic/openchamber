/**
 * Reproduction test for issue #1613
 *
 * Verifies that the QuestionCard custom-answer textarea has two
 * independent resize code paths (ref callback + onChange handler),
 * which causes double the forced-synchronous-layout per keystroke.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const questionCardSource = readFileSync(
  resolve(__dirname, '../QuestionCard.tsx'),
  'utf-8',
);

describe('QuestionCard custom-answer textarea (issue #1613)', () => {
  test('has TWO resize code paths (ref callback + onChange) causing double reflow per keystroke', () => {
    // Count how many times the resize pattern ("height = 'auto'") appears
    const matches = questionCardSource.match(
      /el\.style\.height = 'auto'/g,
    );
    expect(matches).not.toBeNull();

    // There are exactly 2 occurrences: one in the ref callback,
    // one in the onChange handler.
    // A sane implementation would have only 1 (in a useLayoutEffect).
    expect(matches!.length).toBe(2);

    // Verify one occurrence is inside the ref callback
    const refStart = questionCardSource.indexOf('ref={(el)');
    const refBlock = questionCardSource.slice(refStart, refStart + 200);
    expect(refBlock).toContain("el.style.height = 'auto'");

    // Verify the other is inside the onChange handler
    const onChangeStart = questionCardSource.indexOf("onChange={(event: React.ChangeEvent<HTMLTextAreaElement>)");
    const onChangeBlock = questionCardSource.slice(onChangeStart, onChangeStart + 250);
    expect(onChangeBlock).toContain("el.style.height = 'auto'");
  });

  test('has 2 occurrences of scrollHeight reads (one per resize code path)', () => {
    const scrollHeightMatches = questionCardSource.match(
      /el\.scrollHeight/g,
    );
    expect(scrollHeightMatches).not.toBeNull();
    // 2 scrollHeight reads = 1 in ref callback + 1 in onChange handler
    // A single-layout-effect implementation would have only 1.
    expect(scrollHeightMatches!.length).toBe(2);
  });

  test('textarea height is set synchronously in both onChange and ref (no guard for same value)', () => {
    // The ref callback unconditionally sets both height values on every render
    expect(questionCardSource.includes("el.style.height = 'auto'")).toBe(true);
    expect(/el\.style\.height = `/.test(questionCardSource)).toBe(true);

    // There is NO guard like "if (prevHeight !== newHeight)" — every keystroke
    // forces layout unconditionally in both paths.
    const hasGuard =
      questionCardSource.includes('prevHeight') ||
      questionCardSource.includes('previousHeight');

    expect(hasGuard).toBe(false);
  });

  test('ChatInput.tsx uses correct single useLayoutEffect pattern (no duplicate resize)', () => {
    const chatInputSource = readFileSync(
      resolve(__dirname, '../ChatInput.tsx'),
      'utf-8',
    );

    // ChatInput uses useLayoutEffect (correct pattern)
    expect(chatInputSource.includes('useLayoutEffect')).toBe(true);

    // In ChatInput, the resize function is called from useLayoutEffect only,
    // not also from an inline callback ref.
    // Count occurrences of "height = 'auto'" pattern (should be 1, inside
    // the adjustTextareaHeight callback).
    const chatInputMatches = chatInputSource.match(
      /\.style\.height = 'auto'/g,
    );
    expect(chatInputMatches).not.toBeNull();
    expect(chatInputMatches!.length).toBe(1);
  });
});
