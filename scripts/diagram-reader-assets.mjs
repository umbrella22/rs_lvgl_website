import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

export async function readerAssets(read) {
  const [css, js] = await Promise.all([
    read('website/docs/public/diagrams/reader.css'),
    read('website/docs/public/diagrams/reader.js'),
  ]);
  return { css, js };
}

export function readerMarkup({ css, js }) {
  return `<!-- documentation-reader:start -->
<link rel="stylesheet" href="../reader.css?v=${digest(css)}">
<script>if(new URLSearchParams(location.search).get('overview')==='1')document.documentElement.setAttribute('data-docs-overview','');</script>
<script defer src="../reader.js?v=${digest(js)}"></script>
<!-- documentation-reader:end -->
`;
}

export function normalizeDiagramWhitespace(html) {
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open, css, close) => open + css.replace(/^[\t ]+$/gm, '') + close);
}

export function adaptDiagram(html, assets) {
  if (html.includes('<!-- documentation-reader:') || html.split('</head>').length !== 2) {
    throw new Error('Expected an unmodified Archify HTML document.');
  }
  return normalizeDiagramWhitespace(html).replace('</head>', `${readerMarkup(assets)}</head>`);
}

export function originalDiagram(html, assets) {
  const markup = readerMarkup(assets);
  if (html.split(markup).length !== 2) throw new Error('Diagram reader assets changed. Run diagrams:sync.');
  return html.replace(markup, '');
}
