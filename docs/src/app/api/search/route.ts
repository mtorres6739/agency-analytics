import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Build the search index at build time and serve it as a static, CDN-cacheable
// file. The client (RootProvider `search.options.type = 'static'`) downloads it
// once and runs Orama in the browser, so there are no per-keystroke round-trips.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  // The source declares 10 i18n languages, so search builds one index per
  // locale. Orama has no stemmer for these languages, which throws
  // `Language "<x>" is not supported` and breaks the static index export.
  // The docs are English-only, so fall back to the English tokenizer for them.
  // https://docs.orama.com/open-source/supported-languages
  localeMap: {
    zh: 'english',
    pl: 'english',
    ko: 'english',
    ja: 'english',
  },
});
