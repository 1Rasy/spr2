import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const app = readFileSync('src/AppV3.tsx', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

assert.equal(main.includes("./ui-v2.css"), false, 'React entry should not load the rounded v2 shell when matching old SPR');
assert.match(app, /className="brand-nav"/, 'order page should expose old SPR brand filter nav');
assert.match(app, /className="spec-nav"/, 'order page should expose old SPR spec filter nav');
assert.match(app, /className="mix-box-card"/, 'order page should render group-level mix box cards');
assert.match(app, /className="alphabet-sidebar/, 'store page should keep the old SPR alphabet sidebar hook');
assert.match(app, /store-search-summary/, 'store page should show employee/store summary like old SPR');
assert.match(css, /body\.store-search-mode/, 'search mode CSS should preserve old SPR focused store search behavior');
