import { defineConfig, mergeConfig, type Plugin } from 'vite';
import path from 'path';
import base from './vite.config';

/** Dev only: swaps the Supabase client for the in-memory preview (preview/README.md). */
const mockSupabase: Plugin = {
  name: 'basak-preview-supabase',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer || importer.includes('/preview/')) return null;
    if (/(^|\/)supabase(\.ts)?$/.test(source) && /\/src\/lib\//.test(importer + '') && source.startsWith('.')) {
      const resolved = path.resolve(path.dirname(importer), source.endsWith('.ts') ? source : `${source}.ts`);
      if (resolved.endsWith(path.join('src', 'lib', 'supabase.ts'))) return path.resolve(__dirname, 'preview/mock.ts');
    }
    if (/lib\/supabase$/.test(source) && source.startsWith('.')) {
      const resolved = path.resolve(path.dirname(importer), `${source}.ts`);
      if (resolved.endsWith(path.join('src', 'lib', 'supabase.ts'))) return path.resolve(__dirname, 'preview/mock.ts');
    }
    return null;
  },
};

export default mergeConfig(base, defineConfig({ plugins: [mockSupabase], server: { hmr: false } }));
