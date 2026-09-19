// Browser-only generated-content fixtures: never written to PostgreSQL or used as study material.
import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
await page.goto('http://127.0.0.1:5178');await page.getByLabel('Password',{exact:true}).fill(fs.readFileSync('../.env','utf8').match(/^BEN_INITIAL_PASSWORD=(.*)$/m)[1]);await page.getByRole('button',{name:'Continue your journey'}).click();await page.getByRole('link',{name:'Continue Day 1',exact:true}).waitFor();
const original=await page.request.get('http://127.0.0.1:5178/api/days/1');const day=await original.json();
const segments=[{id:0,start:0,end:10,speaker:'Voice A · part 1',text:'Fixture Scripture segment.'},{id:1,start:10,end:20,speaker:'Voice A · part 1',text:'Fixture commentary segment.'}];
const episode={...day.episode,status:'ready',summary:'Fixture summary for browser verification only.',transcript:segments,commentary:[segments[1]],edited_commentary:[{heading:'Fixture written reflection',text:'Fixture edited commentary.',segment_ids:[1]}],outline:[{title:'Fixture outline item',segment_id:1,start:10}]};
await page.route('**/api/days/1',route=>route.fulfill({json:{...day,episode}}));
await page.goto('http://127.0.0.1:5178/day/1');await page.getByRole('tab',{name:'Commentary only',exact:true}).click();
await expect(page.locator('#study-panel')).toContainText('Fixture commentary segment.');await expect(page.locator('#study-panel')).not.toContainText('Fixture Scripture segment.');
await page.getByRole('tab',{name:'Edited commentary',exact:true}).click();await expect(page.locator('#study-panel')).toContainText('Fixture edited commentary.');
await page.getByRole('button',{name:'Listen to source',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThanOrEqual(10);
await page.getByRole('button',{name:/Fixture outline item/}).click();
await page.route('**/api/episodes/999999',route=>route.fulfill({json:{...episode,id:999999,day:null,title:'Introduction fixture (2025)',has_audio:false,audio:null}}));
await page.route('**/api/episodes/999999/notes',route=>route.fulfill({json:[]}));
await page.goto('http://127.0.0.1:5178/episode/999999');await expect(page.getByRole('heading',{name:'Introduction fixture',exact:true})).toBeVisible();await expect(page.getByRole('tab',{name:'Scripture',exact:true})).toHaveCount(0);await page.getByRole('tab',{name:'Edited commentary',exact:true}).click();await expect(page.locator('#study-panel')).toContainText('Fixture edited commentary.');await page.getByRole('link',{name:'Reader mode',exact:true}).click();await expect(page.getByRole('heading',{name:'Introduction fixture',exact:true})).toBeVisible();await expect(page.getByText('Fixture edited commentary.',{exact:true})).toBeVisible();
console.log('Generated views, Scripture exclusion, source seeking, and supplementary reader passed with isolated browser fixtures.');
await browser.close();
