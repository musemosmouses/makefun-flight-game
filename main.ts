// Skyhook Valley — the entry program for best-flight-game-20261126-0057.
// Node 22, standard library only. It hands the game in: copies game/ and
// screenshots/ from beside this file into /output (or MAKEFUN_OUTPUT_DIR
// outside the grader) and writes /output/dossier.json with the vendored
// make.fun library. It never deletes anything: the output directory is the
// grader's to own, and this program only creates inside it.
//
// Deterministic: the same repository always produces the same bytes — the
// dossier is built from the files as they are, with no clock and no random
// input anywhere in this program.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The grader validates the output tree: a path that is not a plain relative
// name fails the run, so dotfiles (like the .gitkeep files that keep empty
// folders in git) are skipped on every copy into /output.
const skipDotfiles = (src: string) => !src.split('/').pop()?.startsWith('.');

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true, filter: skipDotfiles });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), {
    recursive: true,
    filter: skipDotfiles,
  });
}

// The scorer's own caps (from the competition's gate): only text_max_bytes
// shapes the dossier bytes; the others refuse an entry the scorer would
// refuse (more than 4 screenshots or one over 256 KiB; more than 993 files
// in game/ or 48 MiB of game files in all, or a path under game/ over
// 1000 bytes — game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
