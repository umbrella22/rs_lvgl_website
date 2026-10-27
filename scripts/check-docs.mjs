#!/usr/bin/env node
// Validate the bilingual Rspress sources before and after a production build.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(here, '..');
const docsRoot = path.join(websiteRoot, 'docs');
const locales = ['zh', 'en'];
const requiredTopics = [
  'getting-started',
  'declarative-ui',
  'components',
  'input-and-events',
  'features',
  'native-integration',
  'ui-runtime',
  'examples',
  'troubleshooting',
  'development',
];
const placeholderPattern =
  /\b(?:TODO|TBD|FIXME|lorem ipsum|coming soon)\b|待补充|待完善|占位|此处填写/i;
const errors = [];
const warnings = [];
let docCount = 0;
let linkCount = 0;
let anchorCount = 0;
let fenceCount = 0;
let builtLinkCount = 0;
const parsedCache = new Map();
const headingCache = new Map();

function rel(file) {
  return path.relative(websiteRoot, file).split(path.sep).join('/');
}

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function isFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, predicate) {
  const result = [];
  if (!(await pathExists(dir))) return result;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'public' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walk(full, predicate)));
    } else if (predicate(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function maskText(text) {
  return text.replace(/[^\n]/g, ' ');
}

function mapInlineCode(text, replace) {
  const tick = String.fromCharCode(96);
  let result = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === tick) {
      let width = 0;
      while (text[index + width] === tick) width += 1;
      const end = text.indexOf(tick.repeat(width), index + width);
      if (end !== -1) {
        result += replace(text.slice(index + width, end));
        index = end + width;
        continue;
      }
    }
    result += text[index];
    index += 1;
  }
  return result;
}

function parseFrontmatter(lines, file) {
  if (lines[0] !== '---') {
    error(rel(file) + ': missing opening frontmatter delimiter');
    return { fields: {}, bodyStart: 0 };
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    error(rel(file) + ': missing closing frontmatter delimiter');
    return { fields: {}, bodyStart: 0 };
  }
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return { fields, bodyStart: end + 1 };
}

function parseFences(lines, file) {
  const prose = [];
  const fences = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\n]*)$/);
    if (match) {
      if (open === null) {
        const info = match[2].trim();
        open = {
          marker: match[1][0],
          width: match[1].length,
          lang: (info.split(/\s+/)[0] || '').toLowerCase(),
          lines: [],
          start: index + 1,
        };
        prose.push('');
        fenceCount += 1;
        continue;
      }
      if (
        match[1][0] === open.marker &&
        match[1].length >= open.width &&
        match[2].trim() === ''
      ) {
        fences.push(open);
        open = null;
        prose.push('');
        continue;
      }
    }
    if (open !== null) {
      open.lines.push(line);
      prose.push('');
    } else {
      prose.push(line);
    }
  }
  if (open !== null) {
    error(rel(file) + ':' + open.start + ': unterminated ' + open.marker.repeat(open.width) + ' code fence');
  }
  return { prose: prose.join('\n'), fences };
}

function slugify(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[*~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

function cleanHeading(text) {
  return mapInlineCode(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
    (code) => code,
  ).trim();
}

function headingsOf(prose) {
  const headings = [];
  const seen = new Map();
  for (const line of prose.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = cleanHeading(match[2]);
    let slug = slugify(text);
    if (seen.has(slug)) {
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      slug = slug + '-' + (count + 1);
    } else {
      seen.set(slug, 0);
    }
    headings.push({ depth: match[1].length, text, slug });
  }
  return headings;
}

function parseDoc(source, file) {
  const lines = source.split(/\r?\n/);
  const { fields, bodyStart } = parseFrontmatter(lines, file);
  // Keep original line positions for every diagnostic, including fence starts.
  const body = lines.map((line, index) => (index < bodyStart ? '' : line));
  const { prose, fences } = parseFences(body, file);
  const headings = headingsOf(prose);
  return { fields, prose, fences, headings, lines };
}

async function loadDoc(file) {
  if (!parsedCache.has(file)) {
    const source = await fs.readFile(file, 'utf8');
    parsedCache.set(file, parseDoc(source, file));
  }
  return parsedCache.get(file);
}

async function resolveDocCandidate(base) {
  if (await isFile(base)) return base;
  for (const suffix of ['.md', '.mdx']) {
    if (await isFile(base + suffix)) return base + suffix;
  }
  for (const name of ['index.md', 'index.mdx']) {
    const candidate = path.join(base, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function resolveLink(rawTarget, fromFile, locale) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  if (!target) return { missing: rawTarget };
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return { external: true };
  const hashIndex = target.indexOf('#');
  const fragment = hashIndex === -1 ? '' : decodeURIComponent(target.slice(hashIndex + 1));
  const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  let clean = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  clean = decodeURIComponent(clean);
  if (!clean) return { file: fromFile, fragment };

  if (clean.startsWith('/')) {
    const publicCandidate = path.join(docsRoot, 'public', clean);
    if (await isFile(publicCandidate)) return { file: publicCandidate, fragment, public: true };
    let route = clean.replace(/^\/+/, '');
    let targetLocale = locale;
    if (route.startsWith('en/')) {
      targetLocale = 'en';
      route = route.slice(3);
    } else if (route.startsWith('zh/')) {
      targetLocale = 'zh';
      route = route.slice(3);
    }
    const base = path.join(docsRoot, targetLocale, route);
    const candidate = await resolveDocCandidate(base);
    if (candidate) return { file: candidate, fragment };
    return { missing: clean };
  }

  const base = path.resolve(path.dirname(fromFile), clean);
  const candidate = await resolveDocCandidate(base);
  if (candidate) return { file: candidate, fragment };
  return { missing: clean };
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function extractLinks(prose) {
  const links = [];
  const withoutComments = prose.replace(/<!--[\s\S]*?-->/g, maskText);
  const withoutInlineCode = mapInlineCode(withoutComments, maskText);
  const markdown = /(!?)\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  let match;
  while ((match = markdown.exec(withoutInlineCode)) !== null) {
    links.push({ target: match[3], image: match[1] === '!', line: lineOf(withoutInlineCode, match.index) });
  }
  const html = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  while ((match = html.exec(withoutInlineCode)) !== null) {
    links.push({ target: match[1], image: /\bsrc\s*=/i.test(match[0]), line: lineOf(withoutInlineCode, match.index) });
  }
  return links;
}

async function assertAnchors(targetFile, fragment, sourceFile, sourceLine) {
  if (!fragment) return;
  if (!targetFile.endsWith('.md') && !targetFile.endsWith('.mdx')) return;
  let headings = headingCache.get(targetFile);
  if (!headings) {
    const doc = await loadDoc(targetFile);
    headings = new Set(doc.headings.map((heading) => heading.slug));
    headingCache.set(targetFile, headings);
  }
  if (!headings.has(fragment)) {
    error(
      rel(sourceFile) + ':' + sourceLine + ': anchor "#' + fragment + '" not found in ' + rel(targetFile),
    );
  } else {
    anchorCount += 1;
  }
}

function forgeSlugList(doc) {
  return doc.headings.filter((heading) => heading.depth <= 3).map((heading) => heading.slug);
}

function commandLines(fences) {
  const commandPattern =
    /^(?:\$ )?(?:cargo|npm|npx|python3|rustup|brew|sudo|apt-get|xvfb-run|git|cd|export|set|mkdir|rustc|clang|pkg-config)\b/;
  const envPattern = /^[A-Z][A-Z0-9_]*=.*\b(?:cargo|npm|python3|rustup|xvfb-run)\b/;
  const result = [];
  for (const fence of fences) {
    if (!['sh', 'bash', 'shell', 'console', 'zsh'].includes(fence.lang)) continue;
    for (const raw of fence.lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      if (commandPattern.test(line) || envPattern.test(line) || /^\$ (?:cargo|npm|python3)\b/.test(line)) {
        result.push(line.replace(/^\$ /, '').replace(/\s+/g, ' '));
      }
    }
  }
  return result.sort();
}

function fenceLanguages(fences) {
  return fences.map((fence) => fence.lang).sort();
}

function compareLists(label, left, right) {
  if (JSON.stringify(left) === JSON.stringify(right)) return;
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  const onlyLeft = left.filter((value) => !rightSet.has(value));
  const onlyRight = right.filter((value) => !leftSet.has(value));
  error(
    label +
      ': command or fence parity mismatch' +
      (onlyLeft.length ? '; only zh: ' + onlyLeft.slice(0, 4).join(' | ') : '') +
      (onlyRight.length ? '; only en: ' + onlyRight.slice(0, 4).join(' | ') : ''),
  );
}

async function validateDocument(file, locale) {
  docCount += 1;
  const doc = await loadDoc(file);
  const title = doc.fields.title?.trim();
  const description = doc.fields.description?.trim();
  if (!title) error(rel(file) + ': frontmatter title is missing');
  if (!description) error(rel(file) + ': frontmatter description is missing');
  if (description && description.length < 20) {
    warn(rel(file) + ': frontmatter description is short (' + description.length + ' characters)');
  }

  const h1 = doc.headings.filter((heading) => heading.depth === 1);
  if (h1.length !== 1) {
    error(rel(file) + ': expected exactly one H1, found ' + h1.length);
  }
  if (placeholderPattern.test(doc.prose)) {
    error(rel(file) + ': placeholder wording found');
  }
  for (const fence of doc.fences) {
    if (fence.lang === 'md' || fence.lang === 'markdown') {
      warn(rel(file) + ':' + fence.start + ': nested Markdown fence; verify rendered output');
    }
  }

  for (const link of extractLinks(doc.prose)) {
    linkCount += 1;
    const resolved = await resolveLink(link.target, file, locale);
    if (resolved.external) continue;
    if (resolved.missing) {
      error(rel(file) + ':' + link.line + ': unresolved ' + (link.image ? 'asset' : 'link') + ' "' + link.target + '"');
      continue;
    }
    if (!resolved.file.startsWith(docsRoot + path.sep)) {
      error(rel(file) + ':' + link.line + ': local link leaves the documentation tree: "' + link.target + '"');
      continue;
    }
    if (link.image) {
      if (!(await isFile(resolved.file))) {
        error(rel(file) + ':' + link.line + ': image not found "' + link.target + '"');
      }
      continue;
    }
    await assertAnchors(resolved.file, resolved.fragment, file, link.line);
  }
}

async function validateLocaleParity() {
  const fileSets = {};
  for (const locale of locales) {
    fileSets[locale] = new Set(
      (await walk(path.join(docsRoot, locale), (name) => name.endsWith('.md') || name.endsWith('.mdx'))).map(
        (file) => path.relative(path.join(docsRoot, locale), file).split(path.sep).join('/'),
      ),
    );
  }
  for (const locale of locales) {
    if (!fileSets[locale].has('index.md') && !fileSets[locale].has('index.mdx')) error(locale + ': missing index.md or index.mdx');
    for (const topic of requiredTopics) {
      const wanted = 'guide/' + topic;
      if (!fileSets[locale].has(wanted + '.md') && !fileSets[locale].has(wanted + '.mdx')) error(locale + ': missing required guide ' + wanted);
    }
  }
  for (const file of fileSets.zh) {
    if (!fileSets.en.has(file)) error('locale parity: en is missing ' + file);
  }
  for (const file of fileSets.en) {
    if (!fileSets.zh.has(file)) error('locale parity: zh is missing ' + file);
  }

  for (const file of fileSets.zh) {
    if (!fileSets.en.has(file)) continue;
    const zhFile = path.join(docsRoot, 'zh', file);
    const enFile = path.join(docsRoot, 'en', file);
    const zhDoc = await loadDoc(zhFile);
    const enDoc = await loadDoc(enFile);
    compareLists(file + ' (code fence languages)', fenceLanguages(zhDoc.fences), fenceLanguages(enDoc.fences));
    compareLists(file + ' (shell commands)', commandLines(zhDoc.fences), commandLines(enDoc.fences));

    const zhHeadings = forgeSlugList(zhDoc);
    const enHeadings = forgeSlugList(enDoc);
    if (zhHeadings.length !== enHeadings.length) {
      warn(file + ': zh has ' + zhHeadings.length + ' headings (H1-H3), en has ' + enHeadings.length);
    }
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (cause) {
    error(rel(file) + ': invalid or missing JSON (' + cause.message + ')');
    return null;
  }
}

async function validateNavigation() {
  const navLinks = {};
  const sideNames = {};
  for (const locale of locales) {
    const navFile = path.join(docsRoot, locale, '_nav.json');
    const nav = await readJson(navFile);
    if (nav) {
      if (!Array.isArray(nav)) {
        error(rel(navFile) + ': nav must be an array');
      } else {
        navLinks[locale] = [];
        for (const item of nav) {
          if (!item || typeof item.text !== 'string' || typeof item.link !== 'string') {
            error(rel(navFile) + ': every nav item needs text and link');
            continue;
          }
          navLinks[locale].push(item.link);
          const resolved = await resolveLink(item.link, path.join(docsRoot, locale, 'index.md'), locale);
          if (!resolved.external && resolved.missing) {
            error(rel(navFile) + ': nav link "' + item.link + '" does not resolve');
          }
        }
      }
    }

    const metaFile = path.join(docsRoot, locale, 'guide', '_meta.json');
    const meta = await readJson(metaFile);
    if (meta) {
      if (!Array.isArray(meta)) {
        error(rel(metaFile) + ': sidebar metadata must be an array');
      } else {
        sideNames[locale] = [];
        const seen = new Set();
        for (const item of meta) {
          if (!item || typeof item.type !== 'string') {
            error(rel(metaFile) + ': every sidebar item needs a type');
            continue;
          }
          if (item.type === 'section-header') {
            if (!item.label) error(rel(metaFile) + ': section header needs a label');
            continue;
          }
          if (item.type !== 'file') {
            warn(rel(metaFile) + ': unsupported sidebar item type "' + item.type + '"');
            continue;
          }
          if (typeof item.name !== 'string' || !item.label) {
            error(rel(metaFile) + ': file sidebar item needs name and label');
            continue;
          }
          if (seen.has(item.name)) error(rel(metaFile) + ': duplicate sidebar entry "' + item.name + '"');
          seen.add(item.name);
          const page = path.join(docsRoot, locale, 'guide', item.name);
          if (!(await isFile(page + '.md')) && !(await isFile(page + '.mdx'))) {
            error(rel(metaFile) + ': sidebar entry "' + item.name + '" has no guide/' + item.name + '.md or .mdx');
          }
          sideNames[locale].push(item.name);
        }
        for (const topic of requiredTopics) {
          if (!seen.has(topic)) error(rel(metaFile) + ': required guide "' + topic + '" is not in the sidebar');
        }
      }
    }
  }
  if (navLinks.zh && navLinks.en) {
    compareLists('_nav.json links', navLinks.zh, navLinks.en);
  }
  if (sideNames.zh && sideNames.en) {
    compareLists('guide/_meta.json order', sideNames.zh, sideNames.en);
  }
}

async function validatePublicAssets() {
  for (const asset of ['logo.svg', 'favicon.svg', 'images/studio-overview.png']) {
    const file = path.join(docsRoot, 'public', asset);
    if (!(await isFile(file))) error('public asset missing: ' + rel(file));
  }
  const imageDir = path.join(docsRoot, 'public', 'images');
  if (await pathExists(imageDir)) {
    const images = (await fs.readdir(imageDir)).filter((name) => name.endsWith('.png'));
    for (const name of images) {
      if (!(await isFile(path.join(imageDir, name)))) error('image is not a file: images/' + name);
    }
  }
}

async function validateBuiltLinks(html, file, outDir, base) {
  const page = path.relative(outDir, file).split(path.sep).join('/');
  const pageUrl = new URL(base + page, 'https://docs.example');
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const checked = new Set();
  for (const match of markup.matchAll(/<a\b[^>]*?\shref=["']([^"']+)["']/gi)) {
    const href = match[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href) || checked.has(href)) continue;
    checked.add(href);
    builtLinkCount += 1;
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(href, pageUrl).pathname);
    } catch {
      error(`built link in ${page}: invalid URL "${href}"`);
      continue;
    }
    if (!pathname.startsWith(base)) {
      error(`built link in ${page}: "${href}" is outside site base "${base}"`);
      continue;
    }
    const target = path.resolve(outDir, pathname.slice(base.length));
    if (target !== outDir && !target.startsWith(outDir + path.sep)) {
      error(`built link in ${page}: "${href}" is outside the build directory`);
    } else if (!(await isFile(target)) && !(await isFile(path.join(target, 'index.html')))) {
      error(`built link in ${page}: "${href}" has no static output`);
    }
  }
}

async function validateBuiltOutput() {
  const outDir = path.join(websiteRoot, 'doc_build');
  const base = process.env.RSPRESS_BASE || '/rs_lvgl_website/';
  if (!(await pathExists(outDir))) {
    error('doc_build is missing; run "npm run build" before check-docs --built');
    return;
  }
  const pages = ['index.html', 'en/index.html'];
  for (const topic of requiredTopics) {
    pages.push('guide/' + topic + '.html', 'en/guide/' + topic + '.html');
  }
  for (const page of pages) {
    if (!(await isFile(path.join(outDir, page)))) {
      error('built page missing: doc_build/' + page);
    }
  }
  for (const asset of ['logo.svg', 'favicon.svg', 'images/studio-overview.png']) {
    if (!(await isFile(path.join(outDir, asset)))) error('built asset missing: doc_build/' + asset);
  }
  const zhIndex = await fs.readFile(path.join(outDir, 'index.html'), 'utf8').catch(() => '');
  const enIndex = await fs.readFile(path.join(outDir, 'en/index.html'), 'utf8').catch(() => '');
  if (!/lang="zh"/.test(zhIndex)) error('doc_build/index.html does not declare lang="zh"');
  if (!/lang="en"/.test(enIndex)) error('doc_build/en/index.html does not declare lang="en"');
  if (!zhIndex.includes('/en/')) error('zh home page has no English locale link');
  if (!enIndex.includes('/guide/getting-started')) {
    error('en home page does not link to the English guide');
  }
  const builtFiles = await walk(outDir, (name) => /search[_-]?index/i.test(name) || name === 'search_index.json');
  for (const locale of locales) {
    const localized = builtFiles.find((file) => file.includes('.' + locale + '.'));
    if (!localized) error('no ' + locale + ' search index found in doc_build');
    else if ((await fs.stat(localized)).size < 1000) error('search index for ' + locale + ' is unexpectedly small');
  }
  const builtGuide = await fs.readFile(path.join(outDir, 'guide/getting-started.html'), 'utf8').catch(() => '');
  const builtGuideEn = await fs.readFile(path.join(outDir, 'en/guide/getting-started.html'), 'utf8').catch(() => '');
  if (!builtGuide.includes(`hreflang="en" href="${base}en/guide/getting-started.html"`)) {
    error('zh getting-started page has no English alternate link');
  }
  if (!builtGuideEn.includes(`hreflang="zh" href="${base}guide/getting-started.html"`)) {
    error('en getting-started page has no Chinese alternate link');
  }

  for (const locale of locales) {
    const files = await walk(
      path.join(docsRoot, locale),
      (name) => name.endsWith('.md') || name.endsWith('.mdx'),
    );
    for (const file of files) {
      const relative = path.relative(path.join(docsRoot, locale), file).split(path.sep).join('/');
      let route = relative.replace(/\.mdx?$/, '');
      if (route === 'index') route = '';
      else if (route.endsWith('/index')) route = route.slice(0, -'index'.length);
      else route += '.html';
      if (route === '') route = 'index.html';
      else if (!route.endsWith('.html')) route += 'index.html';
      const builtPath = path.join(outDir, locale === 'en' ? 'en' : '', route);
      const html = await fs.readFile(builtPath, 'utf8').catch(() => null);
      if (html === null) {
        error('built page missing for ' + locale + '/' + relative);
        continue;
      }
      await validateBuiltLinks(html, builtPath, outDir, base);
      const h1Count = (html.match(/<h1[ >]/g) || []).length;
      if (h1Count !== 1) error('built page ' + locale + '/' + relative + ' has ' + h1Count + ' H1 elements');
      if (!html.includes('<meta name="description"')) {
        error('built page ' + locale + '/' + relative + ' has no description meta tag');
      }
      const doc = await loadDoc(file);
      for (const heading of doc.headings) {
        if (!html.includes('id="' + heading.slug + '"')) {
          error('built anchor missing for ' + locale + '/' + relative + ': #' + heading.slug);
        }
      }
    }
  }
}

await validateLocaleParity();
for (const locale of locales) {
  const files = await walk(
    path.join(docsRoot, locale),
    (name) => name.endsWith('.md') || name.endsWith('.mdx'),
  );
  for (const file of files) {
    await validateDocument(file, locale);
  }
}
await validateNavigation();
await validatePublicAssets();
if (process.argv.includes('--built')) {
  await validateBuiltOutput();
  console.log('Checked ' + builtLinkCount + ' generated internal links against static output.');
}

console.log(
  'Checked ' + docCount + ' documents, ' + fenceCount + ' code fences, ' + linkCount + ' links and ' + anchorCount + ' in-page anchors.',
);
if (warnings.length) {
  console.log('\nWarnings (' + warnings.length + '):');
  for (const warning of warnings) console.log('  - ' + warning);
}
if (errors.length) {
  console.error('\nErrors (' + errors.length + '):');
  for (const item of errors) console.error('  - ' + item);
  process.exit(1);
}
console.log('Documentation checks passed.');
