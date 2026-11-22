// Genera la LUT de ejemplo (formato .cube) de forma reproducible.
// Uso: npx tsx scripts/make-lut.ts
import { writeFileSync } from 'node:fs';
import { makeTealOrangeLut, serializeCube } from '../packages/project/src/index.ts';

writeFileSync('apps/web/public/luts/teal-orange.cube', serializeCube(makeTealOrangeLut(17)));
console.log('LUT escrita en apps/web/public/luts/teal-orange.cube');
