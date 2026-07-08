import { defineConfig, type UserConfig } from 'tsdown';
import MagicString from 'magic-string';

type Plugin = UserConfig['plugins'];

const exclusions = (): Plugin => {
  return {
    name: 'exclude-api-routes',
    transform: (code: string, id: string) => {
      const pattern = /app\.use\(\s*['"`]\/api['"`][\s\S]*?\);\n?/g;

      if (!pattern.test(code)) return null;
      pattern.lastIndex = 0;

      const s = new MagicString(code);
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(code))) {
        s.remove(match.index, match.index + match[0].length);
      }

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: id }),
      };
    },
  };
};

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist/ws',
  sourcemap: true,
  clean: true,
  format: ['esm'],
  plugins: [exclusions()],
});
