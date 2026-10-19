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
   if(route==='create/')expect((await page.getByLabel('Buscar nombre y municipio').boundingBox())?.width).toBeGreaterThanOrEqual(150);
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

test('Google sign-in keeps the Pages return URL and official white button',async({page})=>{
 await mockBackend(page,false);await page.setViewportSize({width:320,height:740});
 await page.route('**/auth/v1/authorize?**',async route=>{
  const url=new URL(route.request().url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4173/musmatch/');
  await route.fulfill({contentType:'text/html',body:'<h1>Isolated Google handoff</h1>'});
 });
 await page.goto('login/');
 const button=page.getByRole('button',{name:'Continuar con Google',exact:true});
 await expect(button).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(button.locator('img')).toHaveJSProperty('complete',true);
 await expect(button.locator('img')).toHaveJSProperty('naturalWidth',200);
 await button.click();
 await expect(page.getByRole('heading',{name:'Isolated Google handoff'})).toBeVisible();
});

test('rules choices reach creation RPC and match contract is visible before joining',async({page})=>{
 await mockBackend(page);await page.setViewportSize({width:390,height:844});
 let created=false;
 await page.route('**/rest/v1/rpc/create_match_v2',async route=>{
  const body=route.request().postDataJSON();
  expect(body).toMatchObject({p_rules_variant:'FOUR_KINGS',p_points_per_game:30,p_games_to_win:2,p_vacas_to_win:3,p_house_rules:'Sin deje',p_pair_mode:'NEED_PARTNER'});
  created=true;await route.fulfill({json:eventId});
 });
 await page.goto('create/');await page.getByRole('button',{name:/Necesito pareja/}).click();
 await page.getByLabel('Modalidad de mus').selectOption('FOUR_KINGS');
 await page.getByLabel('Tantos por juego').selectOption('30');
 await page.getByLabel('Juegos para ganar una vaca').selectOption('2');
 await page.getByLabel('Vacas para ganar la partida').selectOption('3');
 await page.getByLabel('Otras reglas acordadas').fill('Sin deje');
 await expect(page.getByRole('region',{name:'Reglas acordadas'})).toContainText('4 reyes / 4 ases · 30 tantos · 2 juegos por vaca · 3 vacas');
 await page.getByLabel('Ubicación',{exact:true}).fill('Mesa de prueba, Vitoria');
 await page.getByRole('checkbox',{name:/Me encargo de confirmar/}).check();
 await page.getByRole('button',{name:'Crear partida',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));expect(created).toBe(true);
 await expect(page.getByRole('region',{name:'Reglas acordadas'})).toContainText('Sin juego real');
});

test('rules filters and structured A-B score prevent invalid reports',async({page})=>{
 await mockBackend(page);await page.goto('./');
 await page.getByRole('button',{name:/Filtros/}).click();
 await page.getByLabel('Modalidad de mus').selectOption('FOUR_KINGS');
 await expect(page.locator('main')).toContainText('Mostrando 0 de 1');
 await page.getByRole('button',{name:'Limpiar filtros'}).click();
 await expect(page.locator('main')).toContainText('Mostrando 1 de 1');
 await page.getByLabel('Tantos por juego').selectOption('30');await expect(page.locator('main')).toContainText('Mostrando 0 de 1');
 let reported=false;
 await page.route('**/rest/v1/rpc/submit_team_result',async route=>{
  expect(route.request().postDataJSON()).toMatchObject({match_id:eventId,winner_team:'B',result_score:'1-3'});
  reported=true;await route.fulfill({json:'PENDING'});
 });
 await page.goto(`events/?id=${eventId}`);
 const submit=page.getByRole('button',{name:'Enviar Resultado'});
 await expect(submit).toBeDisabled();
 await page.getByLabel('Equipo A',{exact:true}).fill('3');await page.getByLabel('Equipo B',{exact:true}).fill('3');await expect(submit).toBeDisabled();
 await page.getByLabel('Equipo A',{exact:true}).fill('1');await expect(submit).toBeEnabled();
 await submit.click();await expect.poll(()=>reported).toBe(true);
});
