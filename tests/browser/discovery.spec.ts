import {test,expect} from '@playwright/test';
import {mockBackend,eventId} from './fixtures';
const match=`events/?id=${eventId}`;
const next=`/events/?id=${eventId}`;

test('guest introduction reuses primary action and registration goes to the correct tab',async({page})=>{
 await mockBackend(page,false);let queries=0;page.on('request',r=>{if(r.url().includes('/rest/v1/events'))queries++});
 await page.goto('./');await expect(page.getByRole('heading',{name:'Cuatro personas. Dos parejas. Una mesa.'})).toBeVisible();
 await expect(page.locator('main').getByRole('link',{name:'Crear partida',exact:true})).toHaveCount(1);
 await expect(page.locator('main').getByRole('link',{name:'Buscar partida',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Registrarse',exact:true}).click();
 await expect(page.getByRole('button',{name:'Crear cuenta',exact:true})).toBeVisible();expect(queries).toBe(0);
});
test('guest match link preserves its destination without fetching or enrolling',async({page})=>{
 await mockBackend(page,false);let writes=0;page.on('request',r=>{if(r.url().includes('/rest/')&&r.method()==='POST')writes++});
 await page.goto(match);await expect(page).toHaveURL(new RegExp('login/\\?next='));
 expect(new URL(page.url()).searchParams.get('next')).toBe(next);expect(writes).toBe(0);
});
test('email login resumes the match and never enrols the recipient',async({page})=>{
 await mockBackend(page);let writes=0;
 await page.route('**/auth/v1/token?**',async route=>{
  const session=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token'))!)!));
  await route.fulfill({json:session});
 });
 page.on('request',r=>{if(r.url().includes('/rest/')&&r.method()==='POST'&&!r.url().includes('get_my_presence_token_status'))writes++});
 await page.goto(`login/?next=${encodeURIComponent(next)}`);
 await page.getByLabel('Email',{exact:true}).fill('synthetic@example.test');await page.getByLabel('Contraseña',{exact:true}).fill('synthetic-pass');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));
 await expect(page.getByRole('heading',{name:'Equipo A'})).toBeVisible();expect(writes).toBe(0);
});
test('Google keeps its configured callback and resumes the stored match on return',async({page})=>{
 await mockBackend(page);
 await page.route('**/auth/v1/authorize?**',async route=>{
  expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe('http://127.0.0.1:4173/musmatch/');
  await route.fulfill({contentType:'text/html',body:'<h1>Isolated Google handoff</h1>'});
 });
 await page.goto(`login/?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:'Continuar con Google'}).click();
 await expect(page.getByRole('heading',{name:'Isolated Google handoff'})).toBeVisible();
 await page.goto('./');await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));
 expect(await page.evaluate(()=>sessionStorage.getItem('musmatch-auth-return'))).toBeNull();
});
test('OAuth return to search opens filters without leaving the home loading forever',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>sessionStorage.setItem('musmatch-auth-return',JSON.stringify({path:'/?buscar=1#partidas',expires:Date.now()+60000})));
 await page.goto('./');await expect(page.locator('#filtros')).toBeVisible();await expect(page.locator('main')).not.toContainText('Cargando');
});
test('forged OAuth return cannot navigate outside the app',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>sessionStorage.setItem('musmatch-auth-return',JSON.stringify({path:'https://evil.test/',expires:Date.now()+60000})));
 await page.goto('./');await expect(page.locator('main')).toContainText('Mostrando');await expect(page).toHaveURL(/\/musmatch\/$/);
});
test('native sharing exposes only generic invitation and canonical match URL',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>Object.defineProperty(navigator,'share',{value:async(data:ShareData)=>{(window as unknown as {shared:ShareData}).shared=data}}));
 await page.goto(`${match}#resultado`);await page.getByRole('button',{name:'Compartir partida',exact:true}).click();
 const shared=await page.evaluate(()=>(window as unknown as {shared:ShareData}).shared);
 expect(shared.url).toBe(`http://127.0.0.1:4173/musmatch/${match}`);expect(shared.title).toBe('MusMatch');
 for(const secret of ['Cafetería','Vitoria','Jugador','ABCD12','2030','correo'])expect(JSON.stringify(shared)).not.toContain(secret);
 const whatsapp=page.getByRole('link',{name:/WhatsApp/});const url=new URL((await whatsapp.getAttribute('href'))!);
 expect(url.origin).toBe('https://wa.me');expect(url.searchParams.get('text')).toContain(shared.url!);expect(url.searchParams.get('text')).not.toContain('Cafetería');
 await expect(whatsapp).toHaveAttribute('rel','noopener noreferrer');
});
test('share without native API copies scoped URL, excluding unrelated queries and fragments',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{value:undefined});
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as unknown as {copied:string}).copied=text}}});
 });
 await page.goto(`${match}&token=do-not-share#presencia`);await page.getByRole('button',{name:'Compartir partida',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {copied:string}).copied)).toBe(`http://127.0.0.1:4173/musmatch/${match}`);
 await expect(page.locator('.mm-share').getByRole('status')).toContainText('Enlace copiado');
});
test('denied clipboard gives a selectable manual link and native errors remain recoverable',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{value:async()=>{throw Error('Synthetic failure')}});
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied')}}});
 });
 await page.goto(match);await page.getByRole('button',{name:'Compartir partida',exact:true}).click();await expect(page.locator('.mm-share').getByRole('status')).toContainText('No se pudo compartir');
 await page.getByRole('button',{name:'Copiar enlace',exact:true}).click();const input=page.getByLabel('Enlace de la partida',{exact:true});await expect(input).toHaveValue(`http://127.0.0.1:4173/musmatch/${match}`);
 await input.focus();expect(await input.evaluate(e=>(e as HTMLInputElement).selectionEnd)).toBe((await input.inputValue()).length);
});
test('cancelling the share sheet is not reported as an error',async({page})=>{
 await mockBackend(page);await page.addInitScript(()=>Object.defineProperty(navigator,'share',{value:async()=>{throw new DOMException('Cancelled','AbortError')}}));
 await page.goto(match);await page.getByRole('button',{name:'Compartir partida',exact:true}).click();await expect(page.locator('.mm-share [role=status]')).toBeEmpty();
});
test('FAQ works with keyboard and describes actual ELO, disputes and installation',async({page})=>{
 await mockBackend(page,false);await page.goto('help/');
 const summary=page.locator('#elo summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.locator('#elo')).toHaveAttribute('open','');
 await expect(page.locator('#elo')).toContainText('factor K de 32');await expect(page.locator('#elo')).toContainText('0 %');
 await page.locator('#resultados summary').click();await expect(page.locator('#resultados')).toContainText('sin confirmarse automáticamente');
 await page.locator('#instalar summary').click();await expect(page.locator('#instalar')).toContainText('Safari');
});
test('unknown deep URL serves the themed Pages 404 with working recovery links',async({page})=>{
 await mockBackend(page,false);const response=await page.goto('does-not-exist/deep/');expect(response?.status()).toBe(404);
 await expect(page.getByRole('heading',{name:'Esta carta no está en la mesa'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Volver al inicio',exact:true})).toHaveAttribute('href','/musmatch/');
 await page.getByRole('link',{name:'Buscar partidas',exact:true}).click();await expect(page).toHaveURL(/musmatch\/\?buscar=1#partidas/);
});
for(const width of [320,390,768,1440])test(`public help, legal, guest and sharing fit ${width}px`,async({page},testInfo)=>{
 await mockBackend(page,false);await page.setViewportSize({width,height:844});
 for(const route of ['./','help/','privacy/','terms/','404.html']){
  await page.goto(route);await expect(page.locator('main')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  if(width<1024){const nav=await page.locator('.mm-bottom-nav').boundingBox();const footer=await page.locator('footer').boundingBox();expect(footer!.y+footer!.height).toBeLessThanOrEqual(nav!.y);}
  await page.evaluate(()=>{window.scrollTo(0,0);(document.activeElement as HTMLElement)?.blur()});
  await page.screenshot({path:testInfo.outputPath(`${route.replace(/[^a-z]/g,'')||'guest'}.png`),fullPage:true});
 }
 await mockBackend(page);await page.goto(match);await expect(page.locator('.mm-share')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('missing username preserves the match through profile completion',async({page})=>{
 await mockBackend(page);let completed=false;
 await page.route('**/rest/v1/profiles?**',async route=>{
  if(route.request().method()==='PATCH'){completed=true;await route.fulfill({status:204});return;}
  const u=new URL(route.request().url());
  if(u.searchParams.get('select')==='username'&&!completed){await route.fulfill({json:{username:null}});return;}
  await route.fallback();
 });
 await page.goto(match);await expect(page).toHaveURL(/profile\/\?next=/);
 const username=page.getByLabel(/Username/).first();await username.fill('JugadorRetorno');
 await page.getByRole('button',{name:/Guardar/}).click();await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));expect(completed).toBe(true);
});


test('restricted match errors expose no raw backend content or share action',async({page})=>{
 await mockBackend(page);await page.route('**/rest/v1/events?**',route=>route.fulfill({status:403,json:{message:'internal address PRIVATE-SECRET'}}));
 await page.goto(match);await expect(page.locator('main').getByRole('alert')).toContainText('tus permisos');
 await expect(page.locator('main')).not.toContainText('PRIVATE-SECRET');await expect(page.getByRole('button',{name:'Compartir partida',exact:true})).toHaveCount(0);
});
