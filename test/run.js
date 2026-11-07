'use strict';
// Every test file throws on its first failure; the process then exits non-zero.
for (const name of ['cts', 'genser', 'packet', 'simulator']) require(`./${name}.test.js`);
