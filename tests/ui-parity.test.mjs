import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const app = readFileSync('src/AppV3.tsx', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

assert.equal(main.includes("./ui-v2.css"), false, 'React entry should not load the rounded v2 shell when matching old SPR');
assert.match(app, /id="searchBlock"/, 'store shell should keep old SPR searchBlock node');
assert.match(app, /id="list"/, 'store shell should keep old SPR list node');
assert.match(app, /id="alphabetSidebar"/, 'store shell should keep old SPR alphabet sidebar node');
assert.match(app, /className="top-action-bar"/, 'store shell should render old top action bar');
assert.match(app, /门店总数：/, 'store list should show old SPR total-store summary text');
assert.match(app, /letter-group-title/, 'store list should group stores by first-letter headings');
assert.match(app, /📦 库存管理/, 'store gates should use old SPR stock label');
assert.match(app, /📊 卖进数据/, 'store gates should use old SPR report label');
assert.match(app, /🆕 新门店/, 'store gates should use old SPR new-store label');
assert.match(app, /id="liveAmountBanner"/, 'order page should render old live amount banner');
assert.match(app, /id="dateText"/, 'order page should render old visible dateText span');
assert.match(app, /order-date-action/, 'order page should use old hidden date picker trigger');
assert.match(app, /className="mix-box-toggle"/, 'mix box should use old toggle button class');
assert.match(app, /className="ios-picker"/, 'order quantities should use old select picker controls');
assert.match(app, /data-price-product/, 'price controls should keep old data-price-product hook');
assert.match(app, /className="float-submit"[^>]*>提交账单</, 'submit button should match old SPR label without live total appended');
assert.equal(app.includes('全部规格'), false, 'old SPR spec nav should not add a synthetic all-spec option');
assert.match(css, /body\.store-search-mode #searchBlock/, 'search mode CSS should target old searchBlock id');
assert.match(css, /\.mix-box-toggle/, 'CSS should contain old mix-box toggle styling');