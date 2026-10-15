import {test,expect} from '@playwright/test';
import {mockBackend,eventId} from './fixtures';
const screens=[{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:844,height:390},{width:1024,height:768},{width:1440,height:900}];
const routes=['','login/','reset-password/','create/','my-matches/','rankings/','profile/','users/','admin/',`events/?id=${eventId}`];
for(const viewport of screens){
 test(`screens fit ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await mockBackend(page);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const route of routes){
   await page.goto(route||'./');
   await expect(page.locator('main')).toBeVisible();
   await expect(page.locator('main')).not.toContainText('Cargando');
   if(route.startsWith('events'))await expect(page.getByRole('heading',{name:'Equipo A'})).toBeVisible();
   if(route==='rankings/')await expect(page.locator('.mm-ranking-list li')).toHaveCount(6);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:`horizontal overflow on ${route||'home'}`}).toBeLessThanOrEqual(1);
   if(viewport.width<1024){
    const nav=page.getByRole('navigation',{name:'Navegación móvil'});
    await expect(nav).toBeVisible();
    for(const link of await nav.getByRole('link').all()){
     const box=await link.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(44);
    }
   }
   else await expect(page.getByRole('navigation',{name:'Navegación principal'})).toBeVisible();
   await page.screenshot({path:testInfo.outputPath(`${route.split('/')[0]||'home'}.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
 });
}
test('mobile navigation, filters and create choices',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mockBackend(page);await page.goto('./');
 await page.getByRole('button',{name:/Filtros/}).click();
 await expect(page.getByRole('button',{name:/Filtros/})).toHaveAttribute('aria-expanded','true');
 await page.getByRole('navigation',{name:'Navegación móvil'}).getByRole('link',{name:'Crear',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Navegación móvil'}).getByRole('link',{name:'Crear',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:/Competitiva/}).click();
 await expect(page.getByRole('button',{name:/Competitiva/})).toHaveAttribute('aria-pressed','true');
 await page.goto(`events/?id=${eventId}`);
 await page.getByRole('link',{name:'Resultado',exact:true}).click();
 await expect(page).toHaveURL(/#resultado$/);
 await expect(page.locator('#resultado')).toBeInViewport();
});
test('guest home explains access without backend errors',async({page})=>{
 await mockBackend(page,false);await page.goto('./');
 await expect(page.locator('main')).toContainText('Entra para encontrar partidas');
 await expect(page.locator('main')).not.toContainText('RLS');
});

test('ranking empty and network failure states',async({page})=>{
 await mockBackend(page);await page.setViewportSize({width:320,height:740});
 await page.route('**/rest/v1/profiles?**',async route=>{
  if(new URL(route.request().url()).searchParams.has('limit'))await route.fulfill({json:[]});
  else await route.fallback();
 });
 await page.goto('rankings/');await expect(page.locator('main')).toContainText('Todavía no hay jugadores');
 await page.route('**/rest/v1/profiles?**',async route=>{
  if(new URL(route.request().url()).searchParams.has('limit'))await route.fulfill({status:503,json:{message:'Synthetic offline state'}});
  else await route.fallback();
 });
 await page.reload();await expect(page.locator('main').getByRole('alert')).toContainText('Comprueba tu conexión');
});
