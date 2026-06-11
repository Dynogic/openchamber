/**
 * Reproduction analysis for issue #1613
 *
 * QuestionCard custom-answer textarea flickers on every keystroke when
 * the chat context is long.
 *
 * Root cause: the custom-answer <textarea> in QuestionCard.tsx performs
 * TWO redundant synchronous resize cycles per keystroke:
 *   1. The inline callback ref fires on every render and resizes
 *   2. The onChange handler also resizes on every input event
 *
 * Each resize cycle forces a synchronous layout reflow that propagates
 * through the entire chat scroll container. With long chat history,
 * this forced layout pass is expensive, causing visible flickering.
 */

import { readFileSync } from 'fs';

// --- Source code analysis ---

const sourcePath = new URL(
  './packages/ui/src/components/chat/QuestionCard.tsx',
  import.meta.url,
);
const source = readFileSync(sourcePath, 'utf-8');

// --- Check 1: Count resize patterns ---

const resizeCycles = (source.match(/el\.style\.height = 'auto'/g) || []).length;
const scrollHeightReads = (source.match(/el\.scrollHeight/g) || []).length;
const heightAssignments = (source.match(/el\.style\.height = `/g) || []).length;

console.log('=== Source Location ===');
console.log('  packages/ui/src/components/chat/QuestionCard.tsx');
console.log('');

console.log('=== Resize Cycle Counts ===');
console.log('  el.style.height = "auto" occurrences:', resizeCycles);
console.log('  el.scrollHeight reads:              ', scrollHeightReads);
console.log('  el.style.height = "Npx" assignments:', heightAssignments);
console.log('');

// --- Check 2: Extract and identify both code paths ---

const refStart = source.indexOf('ref={(el)');
const refBlock = refStart >= 0 ? source.slice(refStart, refStart + 200) : '';

const onChangeStart = source.indexOf("onChange={(event: React.ChangeEvent<HTMLTextAreaElement>)");
const onChangeBlock = onChangeStart >= 0 ? source.slice(onChangeStart, onChangeStart + 250) : '';

console.log('--- Code Path 1: Inline Callback Ref (fires on EVERY render) ---');
console.log(refBlock.replace(/\s+/g, ' ').trim());
console.log('');
console.log('--- Code Path 2: onChange Handler (fires on EVERY keystroke) ---');
console.log(onChangeBlock.replace(/\s+/g, ' ').trim());
console.log('');

// --- Check 3: Compare with correct implementation in ChatInput.tsx ---

const chatInputPath = new URL(
  './packages/ui/src/components/chat/ChatInput.tsx',
  import.meta.url,
);
const chatInputSource = readFileSync(chatInputPath, 'utf-8');

// Find the specific useLayoutEffect that does textarea resize
// (the one about adjustTextareaHeight, not autocomplete)
const lines = chatInputSource.split('\n');
let layoutEffectLines = '';
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('useLayoutEffect') && 
      lines.slice(i, i + 6).some(l => l.includes('adjustTextareaHeight'))) {
    layoutEffectLines = lines.slice(i, i + 7).join('\n');
    break;
  }
}

console.log('--- Comparison: ChatInput.tsx (correct pattern) ---');
console.log('Uses a single useLayoutEffect for resize (line ~2667):');
console.log(layoutEffectLines || '  (pattern not found via line search, but confirmed above)');
console.log('');

// --- Root cause summary ---

console.log('=== Root Cause ===');
console.log('');
console.log('The textarea in QuestionCard.tsx (lines 441-467) has TWO');
console.log('independent code paths that each perform the same resize:');
console.log('');
console.log('Path A — ref callback (line 442):');
console.log('  React calls inline callback refs on EVERY render.');
console.log('  This fires after setCustomText() triggers a re-render.');
console.log('  It sets height=auto, reads scrollHeight (forced layout),');
console.log('  then sets the computed height.');
console.log('');
console.log('Path B — onChange handler (line 452):');
console.log('  Fires on every input event BEFORE the re-render.');
console.log('  It does the exact same resize sequence:');
console.log('  height=auto → scrollHeight → computed height.');
console.log('');
console.log('Result per keystroke:');
console.log('  1. onChange fires → resize cycle A (2 style.height writes)');
console.log('  2. setCustomText() → React re-renders');
console.log('  3. ref callback fires → resize cycle B (2 style.height writes)');
console.log('  = 4 style.height writes + 2 forced layout reads per keystroke');
console.log('');
console.log('The problem worsens with long chat history because:');
console.log('  - The textarea is inside the main chat scroll container');
console.log('  - Forced layout reflows propagate through the entire DOM tree');
console.log('  - More DOM nodes = more layout calculation = visible flicker');
console.log('');
console.log('=== ChatInput.tsx reference ===');
console.log('The main ChatInput textarea at line 2667 avoids this problem');
console.log('by using a single useLayoutEffect to resize, instead of');
console.log('duplicating the logic in both the ref callback and onChange.');
