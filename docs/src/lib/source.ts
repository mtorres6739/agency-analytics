import { docs, meta } from '@/.source';
import { InferPageType, loader } from 'fumadocs-core/source';
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server';
import { icons } from 'lucide-react';
import { createElement } from 'react';
import { i18n } from './i18n';

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  i18n,
  // it assigns a URL to your pages
  baseUrl: '/docs',
  // resolve string `icon` names from meta.json to lucide-react icons
  icon(icon) {
    if (icon && icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }
  },
  source: toFumadocsSource(docs, meta),
});

export type Page = InferPageType<typeof source>;
