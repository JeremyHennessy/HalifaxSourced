const seedUrl = "https://novascotia.com/explore-nova-scotia/events/?region=29";
const userAgent = "HalifaxSourced/0.6 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const seed = await fetch(seedUrl, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(15000) });
const html = await seed.text();
const links=[];
for(const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
  try{const u=new URL(match[1],seed.url||seedUrl);if(u.hostname.replace(/^www\./,'')==='novascotia.com'&&u.pathname.startsWith('/event/')&&u.pathname!=='/event/'&&!links.includes(u.href))links.push(u.href);}catch{}
}
async function request(url){const started=Date.now();try{const r=await fetch(url,{headers:{"User-Agent":userAgent,Accept:"text/html,application/xhtml+xml,text/calendar;q=0.9,*/*;q=0.5"},redirect:'follow',signal:AbortSignal.timeout(15000)});const body=await r.text();return{url,status:r.status,ok:r.ok,bytes:body.length,durationMs:Date.now()-started};}catch(e){return{url,status:null,ok:false,error:e.name==='TimeoutError'?'timeout':e.message,durationMs:Date.now()-started};}}
const batch=await Promise.all(links.slice(0,10).map(request));
console.log('CONCURRENT');console.log(JSON.stringify(batch,null,2));
const sequential=[];for(const url of links.slice(0,5)){sequential.push(await request(url));await new Promise(r=>setTimeout(r,175));}
console.log('SEQUENTIAL');console.log(JSON.stringify(sequential,null,2));
const concurrentOk=batch.filter(x=>x.ok).length,sequentialOk=sequential.filter(x=>x.ok).length;
console.log(JSON.stringify({linkCount:links.length,concurrentOk,sequentialOk},null,2));
if(!links.length)throw new Error('no_seed_links');
