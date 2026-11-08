'use strict';
// Every test file throws on its first failure; the process then exits non-zero.
for (const name of ['cts', 'genser', 'packet', 'simulator', 'events']) require(`./${name}.test.js`);
