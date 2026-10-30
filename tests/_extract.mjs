// Shared helper: pulls the raw <script type="module"> source out of index.html
// so unit tests can isolate and exercise specific pure functions without
// loading the whole app (which imports pdf.js from a CDN and touches the DOM
// extensively). This keeps tests build-less, matching the project's own rules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'index.html');

export function getModuleSource() {
  const html = readFileSync(indexPath, 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not find <script type="module"> in index.html');
  return m[1];
}

// Extracts one top-level function/const declaration by name from the module
// source, by brace/paren counting from its first occurrence. Good enough for
// the small, self-contained pure functions we unit test (isFresh, similarity
// helpers, hashing, etc.) — not meant to parse arbitrary JS.
export function extractDeclaration(source, name) {
  const startRe = new RegExp(`(^|\\n)\\s*(async function\\s+${name}\\s*\\(|function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`);
  const m = startRe.exec(source);
  if (!m) throw new Error(`Declaration "${name}" not found`);
  const isArrow = /const\s+\w+\s*=/.test(m[2]);
  const declStart = m.index + m[0].lastIndexOf(m[2]);

  if (isArrow) {
    // Find the top-level terminating ';' by tracking paren/brace/bracket
    // depth from the '=' onward — depth must return to 0 before a ';' ends it.
    let i = declStart;
    let depth = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ';' && depth <= 0) { i++; break; }
    }
    return source.slice(m.index, i).trim();
  }

  // function form: find the first '{' then balance braces to find its match.
  let i = declStart;
  while (source[i] !== '{') i++;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(m.index, i).trim();
}
