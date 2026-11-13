/**
 * A small reader for the `---` header at the top of SKILL.md / agent / command files.
 * It understands what those headers actually use: one-line values, quoted values,
 * folded (`>`) and literal (`|`) blocks, values that wrap onto indented lines,
 * and one level of nested keys or `- ` lists. It is not a full YAML parser.
 *
 * @param {string} text
 * @returns {{data: Record<string, any>, body: string}}
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  return { data: parseBlock(m[1].split(/\r?\n/)), body: src.slice(m[0].length) };
}

function parseBlock(lines) {
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const km = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/.exec(lines[i]);
    i++;
    if (!km) continue;
    const cont = [];
    while (i < lines.length && (/^[ \t]+\S/.test(lines[i]) || lines[i].trim() === '')) {
      cont.push(lines[i]);
      i++;
    }
    data[km[1]] = resolveValue((km[2] ?? '').trim(), cont);
  }
  return data;
}

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(n));
}

function resolveValue(head, cont) {
  const block = /^([>|])[+-]?\d*$/.exec(head);
  if (block) {
    const body = dedent(cont);
    if (block[1] === '|') return body.join('\n').trim();
    // Folded: single newlines become spaces, blank lines stay as paragraph breaks.
    return body
      .join('\n')
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  if (head === '') {
    const body = dedent(cont).filter((l) => l.trim());
    if (!body.length) return '';
    if (body.every((l) => /^-\s+/.test(l) || /^\s/.test(l))) {
      return body.filter((l) => /^-\s+/.test(l)).map((l) => unquote(l.replace(/^-\s+/, '').trim()));
    }
    if (/^[A-Za-z0-9_.-]+:(\s|$)/.test(body[0])) return parseBlock(body);
    return unquote(body.map((l) => l.trim()).join(' '));
  }

  const rest = cont.map((l) => l.trim()).filter(Boolean);
  return unquote([head, ...rest].join(' '));
}

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\(["\\/nt])/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** First real paragraph of a markdown body, used when a file has no description. */
export function firstParagraph(body) {
  const paras = String(body ?? '').split(/\r?\n\s*\r?\n/);
  for (const p of paras) {
    const t = p.trim();
    if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('<!--')) continue;
    return t.replace(/\s*\r?\n\s*/g, ' ').slice(0, 400);
  }
  return '';
}
