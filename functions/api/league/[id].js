const API="https://fantasy.premierleague.com/api/";
async function onRequest({request,params}){
 const id=String(params.id||"").trim(),url=new URL(request.url),type=url.searchParams.get("type")==="h2h"?"h2h":"classic",page=Math.max(1,Math.min(50,Number(url.searchParams.get("page")||1)));
 if(!/^\d{1,12}$/.test(id))return Response.json({error:"Invalid league ID."},{status:400});
 const path=type==="h2h"?`leagues-h2h/${id}/standings/?page=${page}`:`leagues-classic/${id}/standings/?page_standings=${page}`;
 try{const response=await fetch(API+path,{headers:{"User-Agent":"TheSportzineFPL/0.1 (public FPL dashboard)"}});
 if(!response.ok)return Response.json({error:response.status===404?"League not found or standings unavailable.":"FPL standings are temporarily unavailable."},{status:response.status===404?404:502});
 const data=await response.json(),rows=data.standings?.results||[];
 return Response.json({league:data.league?{name:data.league.name}:null,results:rows.map(r=>({rank:r.rank,entry:r.entry,entry_name:r.entry_name,player_name:r.player_name,total:r.total,event_total:r.event_total})),hasMore:Boolean(data.standings?.has_next)},{headers:{"cache-control":"public, max-age=120, s-maxage=120"}});
 }catch{return Response.json({error:"Could not load league standings right now."},{status:502});}
}
export{onRequest};
