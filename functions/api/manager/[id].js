const API = "https://fantasy.premierleague.com/api/";

async function fpl(path) {
  const response = await fetch(API + path, {
    headers: { "User-Agent": "TheSportzineFPL/0.1 (public FPL dashboard)" }
  });
  if (!response.ok) {
    const error = new Error(`FPL API returned ${response.status} for ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=45, s-maxage=45"
    }
  });
}

export async function onRequest({ params }) {
  const id = String(params.id || "").trim();
  if (!/^\d{1,12}$/.test(id)) return json({ error: "Enter a valid numeric FPL ID." }, 400);

  try {
    const [manager, bootstrap, fixtures] = await Promise.all([
      fpl(`entry/${id}/`),
      fpl("bootstrap-static/"),
      fpl("fixtures/")
    ]);

    const events = bootstrap.events || [];
    const current = events.find(e => e.is_current);
    const lastFinished = [...events].reverse().find(e => e.finished);
    const target = current || lastFinished;
    if (!target) return json({ error: "No gameweek data is available yet." }, 503);

    let picksPayload = null;
    let picksEvent = target;
    try {
      picksPayload = await fpl(`entry/${id}/event/${target.id}/picks/`);
    } catch (e) {
      if (lastFinished && lastFinished.id !== target.id) {
        picksEvent = lastFinished;
        picksPayload = await fpl(`entry/${id}/event/${lastFinished.id}/picks/`);
      } else {
        throw e;
      }
    }

    const [live, history] = await Promise.all([
      fpl(`event/${picksEvent.id}/live/`).catch(() => ({ elements: [] })),
      fpl(`entry/${id}/history/`).catch(() => ({ current: [] }))
    ]);

    const elements = new Map((bootstrap.elements || []).map(p => [p.id, p]));
    const teams = new Map((bootstrap.teams || []).map(t => [t.id, t]));
    const liveElements = new Map((live.elements || []).map(p => [p.id, p]));
    const eventFixtures = (fixtures || []).filter(f => f.event === picksEvent.id);
    const fixtureByTeam = new Map();
    for (const fixture of eventFixtures) {
      fixtureByTeam.set(fixture.team_h, { fixture, opponent: fixture.team_a, isHome: true });
      fixtureByTeam.set(fixture.team_a, { fixture, opponent: fixture.team_h, isHome: false });
    }
    const picks = (picksPayload.picks || []).map(pick => {
      const player = elements.get(pick.element) || {};
      const club = teams.get(player.team) || {};
      const livePlayer = liveElements.get(pick.element) || {};
      const stats = livePlayer.stats || {};
      const teamFixture = fixtureByTeam.get(player.team);
      const opponentTeam = teamFixture ? teams.get(teamFixture.opponent) : null;
      const fixture = teamFixture?.fixture;
      return {
        id: pick.element,
        name: `${player.first_name || ""} ${player.second_name || ""}`.trim() || "Player",
        webName: player.web_name || "Player",
        position: (bootstrap.element_types || []).find(t => t.id === player.element_type)?.singular_name_short || "",
        club: club.short_name || "",
        clubName: club.name || "",
        clubId: player.team,
        price: (player.now_cost || 0) / 10,
        sellingPrice: Number(pick.selling_price ?? player.now_cost ?? 0) / 10,
        buyingPrice: Number(pick.purchase_price ?? player.now_cost ?? 0) / 10,
        points: Number(stats.total_points || 0),
        minutes: Number(stats.minutes || 0),
        multiplier: pick.is_captain ? 2 : Number(pick.multiplier ?? (pick.is_vice_captain ? 1 : 0)),
        isCaptain: Boolean(pick.is_captain),
        isViceCaptain: Boolean(pick.is_vice_captain),
        positionOrder: Number(pick.position || 0),
        status: player.status || "a",
        news: player.news || "",
        form: Number(player.form || 0),
        chanceOfPlaying: player.chance_of_playing_next_round,
        costChangeEvent: Number(player.cost_change_event || 0),
        costChangeSeason: Number(player.cost_change_start || 0),
        transfersInEvent: Number(player.transfers_in_event || 0),
        transfersOutEvent: Number(player.transfers_out_event || 0),
        opponent: opponentTeam?.short_name || null,
        venue: teamFixture ? (teamFixture.isHome ? "H" : "A") : null,
        isPlaying: Boolean(fixture?.started && !fixture?.finished && !fixture?.finished_provisional && Number(stats.minutes || 0) > 0 && Number(stats.minutes || 0) < 90)
      };
    });

    const playerHistories = await Promise.all(picks.map(async p => {
      try { const summary = await fpl("element-summary/" + p.id + "/"); return [p.id, (summary.history || []).slice(-5)]; }
      catch { return [p.id, []]; }
    }));
    const historyByPlayer = new Map(playerHistories);
    for (const p of picks) {
      const recent = historyByPlayer.get(p.id) || [];
      const minutes = recent.reduce((n, x) => n + Number(x.minutes || 0), 0);
      const points = recent.reduce((n, x) => n + Number(x.total_points || 0), 0);
      p.lastFivePoints = points; p.lastFiveMinutes = minutes;
      p.lastFiveForm = minutes > 0 ? points / Math.max(1, minutes / 90) / 5 : 0;
    }
    const nextEvent = picksEvent.id + 1;
    const teamFixtures = new Map();
    for (const fixture of (fixtures || []).filter(f => f.event >= nextEvent && !f.finished)) {
      for (const [teamId, opponentId, venue, difficulty] of [[fixture.team_h, fixture.team_a, "H", fixture.team_h_difficulty], [fixture.team_a, fixture.team_h, "A", fixture.team_a_difficulty]]) {
        const list = teamFixtures.get(teamId) || [];
        list.push({ event: fixture.event, opponent: teams.get(opponentId)?.short_name || "", venue, difficulty: Number(difficulty || 3) });
        teamFixtures.set(teamId, list);
      }
    }
    const nextGw = new Map();
    for (const [teamId, list] of teamFixtures) { const f = list.find(x => x.event === nextEvent); if (f) nextGw.set(teamId, f); }
    const scorePlayer = p => { const f = nextGw.get(p.clubId); const form = Math.min(10, Math.max(0, p.lastFiveForm || p.form || 0)); const fixture = f ? (6-f.difficulty)*2 : 2; const minutes = p.chanceOfPlaying == null ? 10 : Math.max(0, Math.min(10, Number(p.chanceOfPlaying)/10)); const home = f?.venue === "H" ? 10 : f?.venue === "A" ? 7 : 5; return form*.4 + fixture*.3 + minutes*.2 + home*.1; };
    const roundFplPoints = value => Math.floor(Math.max(0, Number(value) || 0) + 0.5);
    const projectedPoints = p => {
      const element = elements.get(p.id) || {};
      const official = Number(element.ep_next);
      if (Number.isFinite(official) && official > 0) return official;
      const availability = p.chanceOfPlaying == null ? 1 : Math.max(0, Math.min(1, Number(p.chanceOfPlaying) / 100));
      return Math.max(0, (Number(element.form || p.form || 0) * .45 + Number(element.points_per_game || 0) * .35 + scorePlayer(p) * .2) * availability);
    };
    const groups = { GKP:picks.filter(p=>p.position==="GKP"), DEF:picks.filter(p=>p.position==="DEF"), MID:picks.filter(p=>p.position==="MID"), FWD:picks.filter(p=>p.position==="FWD") };
    let idealXI = [], idealScore = -Infinity;
    for (let def=3; def<=5; def++) for (let mid=3; mid<=5; mid++) { const fwd=10-def-mid; if (fwd<1 || fwd>3 || groups.DEF.length<def || groups.MID.length<mid || groups.FWD.length<fwd || !groups.GKP.length) continue; const xi=[...groups.GKP.slice().sort((x,y)=>projectedPoints(y)-projectedPoints(x)).slice(0,1),...groups.DEF.slice().sort((x,y)=>projectedPoints(y)-projectedPoints(x)).slice(0,def),...groups.MID.slice().sort((x,y)=>projectedPoints(y)-projectedPoints(x)).slice(0,mid),...groups.FWD.slice().sort((x,y)=>projectedPoints(y)-projectedPoints(x)).slice(0,fwd)]; const total=xi.reduce((n,p)=>n+projectedPoints(p),0); if(total>idealScore){idealScore=total;idealXI=xi;} }
    idealXI.sort((x,y)=>["GKP","DEF","MID","FWD"].indexOf(x.position)-["GKP","DEF","MID","FWD"].indexOf(y.position));
    const projectedCaptainOrder = [...idealXI].sort((a,b)=>projectedPoints(b)-projectedPoints(a));
    idealXI.forEach(p=>{p.idealCaptain=false;p.idealViceCaptain=false;});
    if(projectedCaptainOrder[0]) projectedCaptainOrder[0].idealCaptain=true;
    if(projectedCaptainOrder[1]) projectedCaptainOrder[1].idealViceCaptain=true;
    const bank = Number(picksPayload.entry_history?.bank ?? 0) / 10;
    const squadClubCounts = new Map();
    for (const p of picks) squadClubCounts.set(p.clubId, (squadClubCounts.get(p.clubId) || 0) + 1);
    const ownedIds = new Set(picks.map(p => p.id));
    const horizonProjection = (player, horizon) => {
      const schedule = (teamFixtures.get(player.team || player.clubId) || []).filter(f => f.event < nextEvent + horizon);
      const base = Number(player.ep_next) > 0 ? Number(player.ep_next) : Math.max(0, Number(player.form || 0) * .45 + Number(player.points_per_game || 0) * .55);
      const availability = player.chance_of_playing_next_round == null ? 1 : Math.max(0, Math.min(1, Number(player.chance_of_playing_next_round) / 100));
      let total = 0;
      for (let offset=0; offset<horizon; offset++) {
        const event=nextEvent+offset, fixturesForEvent=schedule.filter(f=>f.event===event);
        const fixtureFactor = fixturesForEvent.length ? fixturesForEvent.reduce((sum,f)=>sum*Math.max(.55,Math.min(1.35,1+(3-Number(f.difficulty||3))*.105))*(f.venue==="H"?1.06:.96),1) : .85;
        const baseForEvent = offset===0 && Number(player.ep_next)>0 ? Number(player.ep_next) : Math.max(0,Number(player.form||0)*.45+Number(player.points_per_game||0)*.55);
        total += baseForEvent * fixtureFactor * (offset===0?availability:1);
      }
      return roundFplPoints(total);
    };
    const bestTransfersByHorizon = {};
    for (const horizon of [1,3,5]) {
      const transferOptions = [];
      for (const outgoing of picks) {
        const outgoingElement = elements.get(outgoing.id) || {};
        const saleValue = outgoing.sellingPrice ?? outgoing.price;
        const budget = saleValue + bank;
        const options = (bootstrap.elements || []).filter(candidate => {
          if (ownedIds.has(candidate.id) || candidate.element_type !== outgoingElement.element_type) return false;
          if ((candidate.now_cost || 0) / 10 > budget + .0001) return false;
          const currentClubCount = squadClubCounts.get(candidate.team) || 0;
          const outgoingFromSameClub = candidate.team === outgoing.clubId ? 1 : 0;
          if (currentClubCount - outgoingFromSameClub >= 3) return false;
          return candidate.status === "a" || (candidate.status === "d" && Number(candidate.chance_of_playing_next_round ?? 50) >= 75);
        }).map(candidate => {
          const club = teams.get(candidate.team) || {};
          const f = nextGw.get(candidate.team);
          const projected = horizonProjection(candidate,horizon);
          const outgoingProjected = horizonProjection({...outgoingElement,team:outgoing.clubId,form:outgoing.form,points_per_game:outgoingElement.points_per_game,ep_next:outgoingElement.ep_next,chance_of_playing_next_round:outgoing.chanceOfPlaying},horizon);
          const fixtures = (teamFixtures.get(candidate.team)||[]).filter(x=>x.event<nextEvent+horizon);
          return {id:candidate.id,webName:candidate.web_name,club:club.short_name||"",position:outgoing.position,price:(candidate.now_cost||0)/10,projectedPoints:projected,outId:outgoing.id,outName:outgoing.webName,outPrice:saleValue,bank,horizon,gain:projected-outgoingProjected,opponent:f?.opponent||null,venue:f?.venue||null,fixtures,status:candidate.status,news:candidate.news||""};
        }).filter(candidate=>candidate.gain>0).sort((a,b)=>b.gain-a.gain);
        if(options[0])transferOptions.push(options[0]);
      }
      const seen=new Set();
      bestTransfersByHorizon[horizon]=transferOptions.sort((a,b)=>b.gain-a.gain).filter(option=>{if(seen.has(option.id))return false;seen.add(option.id);return true;}).slice(0,5);
    }
    const bestTransfers = bestTransfersByHorizon[1];
    for (const p of picks) { const byEvent = new Map(); for (const f of (teamFixtures.get(p.clubId)||[]).filter(x=>x.event<=nextEvent+4)) { const entry=byEvent.get(f.event)||{event:f.event,opponents:[],difficulty:f.difficulty}; entry.opponents.push(f.opponent+" ("+f.venue+")"); entry.difficulty=Math.max(entry.difficulty,f.difficulty); byEvent.set(f.event,entry); } p.nextFixtures=[...byEvent.values()].sort((x,y)=>x.event-y.event); }
    const starting = picks.filter(p => p.positionOrder <= 11).sort((a,b) => a.positionOrder-b.positionOrder);
    const bench = picks.filter(p => p.positionOrder > 11).sort((a,b) => a.positionOrder-b.positionOrder);
    // Apply FPL automatic substitutions only once the entire gameweek is final.
    // Bench order is preserved; a goalkeeper can only replace the starting goalkeeper.
    const autoSubs = [];
    if (picksEvent.finished) {
      const absent = starting.filter(p => p.minutes === 0);
      const startingGoalkeeper = starting.find(p => p.position === "GKP");
      const absentGoalkeeper = startingGoalkeeper?.minutes === 0 ? startingGoalkeeper : null;
      const benchGoalkeeper = bench.find(p => p.position === "GKP");
      if (absentGoalkeeper && benchGoalkeeper && benchGoalkeeper.minutes > 0) {
        const index = starting.indexOf(absentGoalkeeper);
        starting[index] = { ...benchGoalkeeper, autoSubbed: true, autoSubFor: absentGoalkeeper.webName };
        benchGoalkeeper.autoSubbed = true;
        benchGoalkeeper.autoSubFor = absentGoalkeeper.webName;
        benchGoalkeeper.multiplier = 1;
        absentGoalkeeper.didNotPlay = true;
        absentGoalkeeper.autoSubbedOff = true;
        autoSubs.push({ in: benchGoalkeeper.webName, out: absentGoalkeeper.webName });
      }
      const outfieldBench = bench.filter(p => p.position !== "GKP" && p.minutes > 0);
      for (const substitute of outfieldBench) {
        const absentOutfield = starting.filter(p => p.position !== "GKP" && p.minutes === 0);
        const activeOutfield = starting.filter(p => p.position !== "GKP" && (p.minutes > 0 || p.autoSubbed));
        const counts = { DEF: activeOutfield.filter(p => p.position === "DEF").length, MID: activeOutfield.filter(p => p.position === "MID").length, FWD: activeOutfield.filter(p => p.position === "FWD").length };
        const replaceable = absentOutfield.find(player => {
          const next = { ...counts, [player.position]: counts[player.position] - 1, [substitute.position]: counts[substitute.position] + 1 };
          return next.DEF >= 3 && next.MID >= 3 && next.FWD >= 1;
        });
        if (!replaceable) continue;
        const index = starting.indexOf(replaceable);
        starting[index] = { ...substitute, autoSubbed: true, autoSubFor: replaceable.webName, multiplier: 1 };
        substitute.autoSubbed = true;
        substitute.autoSubFor = replaceable.webName;
        replaceable.didNotPlay = true;
        replaceable.autoSubbedOff = true;
        autoSubs.push({ in: substitute.webName, out: replaceable.webName });
      }
      // FPL captaincy passes to the vice-captain only when the captain does not play.
      const captain = picks.find(p => p.isCaptain);
      const viceCaptain = picks.find(p => p.isViceCaptain);
      if (captain?.minutes === 0 && viceCaptain && viceCaptain.minutes > 0) {
        const activeVice = starting.find(p => p.id === viceCaptain.id) || bench.find(p => p.id === viceCaptain.id && p.autoSubbed);
        if (activeVice) activeVice.multiplier = 2;
      }
    }
    const entryHistory = picksPayload.entry_history || {};
    const currentRank = Number(manager.summary_overall_rank || 0);
    const previousGw = (history.current || [])
      .filter(x => x.event < picksEvent.id)
      .sort((x, y) => y.event - x.event)[0] || null;
    const previousOverallRank = previousGw?.overall_rank ?? null;
    const rankChange = previousOverallRank != null && currentRank
      ? Number(previousOverallRank) - currentRank
      : null;
    const score = entryHistory.points ?? starting.reduce((sum, p) => sum + p.points * p.multiplier, 0);
    const usedChipNames = new Set((history.chips || []).map(chip => String(chip.name || "").toLowerCase()));
    const chipLabels = { wildcard:"Wildcard", freehit:"Free Hit", bboost:"Bench Boost", "3xc":"Triple Captain", assistant_manager:"Assistant Manager" };
    const allChips = [...new Set((bootstrap.chips || []).map(chip => String(chip.name || "").toLowerCase()).filter(Boolean))]
      .map(name => ({ name: chipLabels[name] || name.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()), used: usedChipNames.has(name) }));

    // Deterministic chip planner: Wildcard is a three-GW squad build; Free Hit is a one-GW XI.
    const chipHistory = history.chips || [];
    const chipNames = [...new Set((bootstrap.chips || []).map(chip => String(chip.name || "").toLowerCase()).filter(Boolean))];
    const chipDisplay = name => chipLabels[name] || name.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    const planningEvents = events.filter(event => event.id >= nextEvent && event.id <= 19);
    const playerProjectionForEvent = (player, eventId) => {
      const element = elements.get(player.id) || player;
      const schedule = teamFixtures.get(player.team || player.clubId) || [];
      const fixturesForEvent = schedule.filter(f => f.event === eventId);
      if (!fixturesForEvent.length) return 0;
      const base = eventId === nextEvent && Number(element.ep_next) > 0 ? Number(element.ep_next) :
        Math.max(0, Number(element.form || player.form || 0) * .45 + Number(element.points_per_game || 0) * .55);
      const chance = element.chance_of_playing_next_round ?? player.chanceOfPlaying;
      const availability = eventId === nextEvent && chance != null ? Math.max(0, Math.min(1, Number(chance) / 100)) : 1;
      const factor = fixturesForEvent.reduce((sum,f)=>sum+Math.max(.55,Math.min(1.35,1+(3-Number(f.difficulty||3))*.105))*(f.venue==="H"?1.06:.96),0);
      return base * factor * availability;
    };
    const multiweekProjection = (player,horizon) => Array.from({length:horizon},(_,i)=>playerProjectionForEvent(player,nextEvent+i)).reduce((a,b)=>a+b,0);
    const reliablePool = (bootstrap.elements || []).filter(p => p.status==="a" &&
      (p.chance_of_playing_next_round==null || Number(p.chance_of_playing_next_round)>=75) &&
      !(Number(p.minutes||0)<90 && Number(p.starts||0)===0)).map(p=>({
        ...p,id:p.id,team:p.team,clubId:p.team,club:teams.get(p.team)?.short_name||"",name:p.web_name,webName:p.web_name,
        position:(bootstrap.element_types||[]).find(t=>t.id===p.element_type)?.singular_name_short||"",
        price:Number(p.now_cost||0)/10,status:p.status||"a"
      }));
    const totalBudget = Number(picksPayload.entry_history?.value ?? 0)/10 + bank;
    const chooseBestXI = (players,eventId,horizon=1) => {
      const scored=players.map(p=>({...p,projectedPoints:horizon===1?playerProjectionForEvent(p,eventId):multiweekProjection(p,horizon)}));
      let best=null;
      for(let def=3;def<=5;def++)for(let mid=3;mid<=5;mid++){
        const fwd=10-def-mid;if(fwd<1||fwd>3)continue;
        const take=(pos,n)=>scored.filter(p=>p.position===pos).sort((a,b)=>b.projectedPoints-a.projectedPoints).slice(0,n);
        const xi=[...take("GKP",1),...take("DEF",def),...take("MID",mid),...take("FWD",fwd)];
        if(xi.length!==11)continue;
        const total=xi.reduce((n,p)=>n+p.projectedPoints,0);
        if(!best||total>best.total)best={xi,total};
      }
      if(!best)return {xi:[],bench:[],captain:null,vice:null,total:0};
      const ids=new Set(best.xi.map(p=>p.id)),bench=scored.filter(p=>!ids.has(p.id)).sort((a,b)=>b.projectedPoints-a.projectedPoints);
      const ranked=[...best.xi].sort((a,b)=>b.projectedPoints-a.projectedPoints);
      return {xi:best.xi,bench,captain:ranked[0],vice:ranked[1],total:best.total};
    };
    const selectBudgetedSquad = (horizon,freeHit=false) => {
      const formations=freeHit?[[3,5,2],[3,4,3],[4,5,1],[4,4,2],[4,3,3],[5,3,2],[5,4,1]]:[[5,5,3]];
      let best=null;
      for(const formation of formations){
        const required=freeHit?{GKP:1,DEF:formation[0],MID:formation[1],FWD:formation[2]}:{GKP:2,DEF:5,MID:5,FWD:3};
        const chosen=[],clubCounts=new Map();let spend=0,valid=true;
        const minCostForRemaining=(afterPos,afterCount,excludedId)=>{
          let reserve=0;
          for(const pos of ["GKP","DEF","MID","FWD"]){
            const already=chosen.filter(p=>p.position===pos).length+(pos===afterPos?afterCount:0);
            const need=Math.max(0,required[pos]-already);
            if(!need)continue;
            const prices=reliablePool.filter(p=>p.position===pos&&p.id!==excludedId&&!chosen.some(x=>x.id===p.id)).map(p=>p.price).sort((x,y)=>x-y);
            if(prices.length<need)return Infinity;
            reserve+=prices.slice(0,need).reduce((x,y)=>x+y,0);
          }
          return reserve;
        };
        for(const pos of ["GKP","DEF","MID","FWD"]){
          const candidates=reliablePool.filter(p=>p.position===pos).map(p=>({...p,projectedPoints:multiweekProjection(p,horizon)}))
            .sort((a,b)=>(b.projectedPoints/Math.max(.1,b.price))-(a.projectedPoints/Math.max(.1,a.price)));
          while(chosen.filter(p=>p.position===pos).length<required[pos]){
            const pick=candidates.find(p=>{
              if(chosen.some(x=>x.id===p.id)||(clubCounts.get(p.team)||0)>=3)return false;
              const reserve=minCostForRemaining(pos,chosen.filter(x=>x.position===pos).length+1,p.id);
              return spend+p.price+reserve<=totalBudget+.001;
            });
            if(!pick){valid=false;break;}
            chosen.push(pick);spend+=pick.price;clubCounts.set(pick.team,(clubCounts.get(pick.team)||0)+1);
          }
          if(!valid)break;
        }
        if(!valid||chosen.length!==(freeHit?11:15)||spend>totalBudget+.001)continue;
        const lineup=chooseBestXI(chosen,nextEvent,horizon);
        const score=freeHit?lineup.total:chosen.reduce((n,p)=>n+multiweekProjection(p,horizon),0);
        if(!best||score>best.score)best={players:chosen,lineup,score,spend};
      }
      return best;
    };
    const formatChipSquad = (players,lineup,freeHit=false) => {
      const starters=lineup.xi.map(p=>({...p,role:"XI",isCaptain:p.id===lineup.captain?.id,isViceCaptain:p.id===lineup.vice?.id}));
      const bench=freeHit?[]:lineup.bench.map(p=>({...p,role:"BENCH"}));
      return [...starters,...bench].map(p=>({id:p.id,name:p.webName,club:p.club,position:p.position,role:p.role,status:p.status||"a",
        isCaptain:Boolean(p.isCaptain),isViceCaptain:Boolean(p.isViceCaptain),projectedPoints:Number(p.projectedPoints.toFixed(1)),
        fixtures:(teamFixtures.get(p.team||p.clubId)||[]).filter(f=>f.event>=nextEvent&&f.event<nextEvent+(freeHit?1:3))}));
    };
    const chipScoreForEvent = (name,eventId) => {
      const currentLineup=chooseBestXI(picks.map(p=>({...p,team:p.clubId})),eventId,1);
      if(name==="wildcard"){const s=selectBudgetedSquad(3,false);return {score:s?.score||0,reason:s?"A budget-compliant 15-player rebuild targets the strongest combined projections across the next three gameweeks.":"A complete 15-player squad could not be assembled within the available budget."};}
      if(name==="freehit"){const s=selectBudgetedSquad(1,true);return {score:s?.score||0,reason:s?"Unlimited one-week transfers select the highest-projected legal XI within your squad budget and club limits.":"A valid best XI could not be assembled within the available budget."};}
      if(name==="3xc")return {score:(currentLineup.captain?.projectedPoints||0)*7,reason:currentLineup.captain?"Best projected captain: "+currentLineup.captain.webName+".":"No reliable captain projection is available."};
      if(name==="bboost")return {score:currentLineup.bench.reduce((n,p)=>n+p.projectedPoints,0)*8,reason:"Your four substitutes project "+currentLineup.bench.reduce((n,p)=>n+p.projectedPoints,0).toFixed(1)+" combined points."};
      return {score:currentLineup.total||0,reason:"Based on projected points, player availability and upcoming fixtures."};
    };
    const optimiseChipWindow = (windowStart,windowEnd,label) => {
      const start=Math.max(nextEvent,windowStart),end=windowEnd;
      const used=chipNames.filter(name=>chipHistory.some(chip=>String(chip.name||"").toLowerCase()===name&&Number(chip.event)>=windowStart&&Number(chip.event)<=windowEnd));
      const available=chipNames.filter(name=>!used.includes(name));
      if(start>end)return {label,start:windowStart,end:windowEnd,availableChips:[],usedChips:used.map(chipDisplay),recommendations:[],note:"The first-set chip window closed after GW19."};
      if(!available.length)return {label,start,end,availableChips:[],usedChips:used.map(chipDisplay),recommendations:[],note:"All chips in this window have already been used."};
      const candidates=available.map(name=>({name,options:planningEvents.filter(e=>e.id>=start&&e.id<=end).map(e=>({event:e.id,...chipScoreForEvent(name,e.id)})).sort((a,b)=>b.score-a.score).slice(0,8)}));
      let bestScore=-Infinity,bestPlan=[];
      const search=(index,usedEvents,plan,total)=>{
        if(index>=candidates.length){if(total>bestScore){bestScore=total;bestPlan=plan.slice();}return;}
        const item=candidates[index];
        for(const option of item.options){if(usedEvents.has(option.event))continue;usedEvents.add(option.event);plan.push({name:item.name,...option});search(index+1,usedEvents,plan,total+option.score);plan.pop();usedEvents.delete(option.event);}
        search(index+1,usedEvents,plan,total);
      };
      search(0,new Set(),[],0);
      const recommendations=bestPlan.sort((a,b)=>a.event-b.event).map(item=>{
        let squad=[],prepTransfers=[],captain=null,vice=null;
        if(item.name==="wildcard"||item.name==="freehit"){
          const optimized=selectBudgetedSquad(item.name==="wildcard"?3:1,item.name==="freehit");
          if(optimized){squad=formatChipSquad(optimized.players,optimized.lineup,item.name==="freehit");captain=optimized.lineup.captain?.webName||null;vice=optimized.lineup.vice?.webName||null;}
        }else{
          const lineup=chooseBestXI(picks.map(p=>({...p,team:p.clubId})),item.event,1);
          captain=lineup.captain?.webName||null;vice=lineup.vice?.webName||null;
          const starters=lineup.xi.map(p=>({...p,role:"XI",isCaptain:p.id===lineup.captain?.id,isViceCaptain:p.id===lineup.vice?.id}));
          const bench=lineup.bench.map(p=>({...p,role:"BENCH"}));
          squad=[...starters,...bench].map(p=>({id:p.id,name:p.webName,club:p.club,position:p.position,role:p.role,status:p.status,
            isCaptain:Boolean(p.isCaptain),isViceCaptain:Boolean(p.isViceCaptain),projectedPoints:Number(p.projectedPoints.toFixed(1)),
            fixtures:(teamFixtures.get(p.clubId)||[]).filter(f=>f.event===item.event)}));
        }
        return {...item,chip:chipDisplay(item.name),squad,prepTransfers,
          prepNote:item.name==="wildcard"?"Wildcard offers unlimited transfers for a full squad rebuild; this squad is selected across the next three gameweeks.":
            item.name==="freehit"?"Free Hit offers unlimited transfers for this gameweek only; your original squad returns afterwards.":
            "No transfer is assumed. Any suggested preparation move must use an available free transfer."};
      });
      return {label,start,end,availableChips:available.map(chipDisplay),usedChips:used.map(chipDisplay),recommendations,
        note:"Wildcard uses a three-gameweek squad projection; Free Hit uses a one-gameweek best XI."};
    };
    const chipStrategy={currentEvent:nextEvent,windows:[optimiseChipWindow(1,19,"FIRST SET · GW1–GW19")],
      methodology:"Wildcard: best-value 15-player squad across the next three gameweeks. Free Hit: highest-projected XI for one gameweek. Both obey the squad budget and club limit. Captain and vice-captain are selected for every chip recommendation. Projections are estimates, not guarantees."};

    const leagueLists = {
      classic: manager.leagues?.classic || [],
      h2h: manager.leagues?.h2h || []
    };
    const allLeagueIds = [...new Set([...leagueLists.classic, ...leagueLists.h2h].map(l => l.id))];
    const leagueStandings = new Map();
    await Promise.all(allLeagueIds.map(async leagueId => {
      try {
        const data = await fpl(`leagues-classic/${leagueId}/standings/?page_standings=1`);
        leagueStandings.set(leagueId, {
          total: data.standings?.has_next ? null : (data.standings?.results || []).length,
          hasMore: Boolean(data.standings?.has_next)
        });
      } catch { leagueStandings.set(leagueId, { total: null, hasMore: true }); }
    }));

    return json({
      manager: {
        id: manager.id,
        name: manager.player_name,
        teamName: manager.name,
        overallPoints: manager.summary_overall_points,
        overallRank: manager.summary_overall_rank,
        previousOverallRank,
        rankChange,
        eventPoints: manager.summary_event_points ?? score,
        eventRank: entryHistory.rank ?? null,
        teamValue: entryHistory.value != null ? entryHistory.value / 10 : null,
        bank: entryHistory.bank != null ? entryHistory.bank / 10 : null,
        transfers: entryHistory.event_transfers ?? null,
        event: picksEvent.id,
        eventName: picksEvent.name
      },
      squad: { starting, bench, autoSubs, autoSubsApplied: Boolean(picksEvent.finished) },
      chips: allChips,
      chipStrategy,
      analytics: { idealXI: idealXI.map(p=>{const f=nextGw.get(p.clubId);return {id:p.id,webName:p.webName,club:p.club,position:p.position,price:p.price,opponent:f?.opponent||null,venue:f?.venue||null,fixtures:(teamFixtures.get(p.clubId)||[]).filter(x=>x.event<nextEvent+5).map(x=>({event:x.event,opponent:x.opponent,venue:x.venue,difficulty:x.difficulty})),lastFiveForm:p.lastFiveForm,lastFivePoints:p.lastFivePoints,lastFiveMinutes:p.lastFiveMinutes,score:Number(scorePlayer(p).toFixed(2)),projectedPoints:roundFplPoints(projectedPoints(p)),idealCaptain:Boolean(p.idealCaptain),idealViceCaptain:Boolean(p.idealViceCaptain),status:p.status||"a",news:p.news||"",chanceOfPlaying:p.chanceOfPlaying}}), idealBench:picks.filter(p=>!idealXI.some(x=>x.id===p.id)).sort((a,b)=>(a.position==="GKP"?0:1)-(b.position==="GKP"?0:1)||a.positionOrder-b.positionOrder).map(p=>({id:p.id,webName:p.webName,club:p.club,position:p.position,price:p.price,projectedPoints:roundFplPoints(projectedPoints(p)),opponent:nextGw.get(p.clubId)?.opponent||null,venue:nextGw.get(p.clubId)?.venue||null,status:p.status||"a",news:p.news||"",chanceOfPlaying:p.chanceOfPlaying})), bestTransfers, bestTransfersByHorizon, priceMomentum:picks.map(p=>({id:p.id,webName:p.webName,club:p.club,price:p.price,eventChange:p.costChangeEvent,seasonChange:p.costChangeSeason,transfersIn:p.transfersInEvent,transfersOut:p.transfersOutEvent})), fixtureRatings:picks.map(p=>({id:p.id,webName:p.webName,club:p.club,position:p.position,fixtures:p.nextFixtures})) },
      leagues: {
        classic: (manager.leagues?.classic || []).map(l => ({
          id: l.id, name: l.name, rank: l.entry_rank,
          lastRank: l.entry_last_rank, movement: l.entry_rank != null && l.entry_last_rank != null ? (Number(l.entry_rank) < Number(l.entry_last_rank) ? "up" : Number(l.entry_rank) > Number(l.entry_last_rank) ? "down" : "neutral") : "neutral",
          created: l.created, closed: l.closed, scoring: l.scoring
        })),
        h2h: (manager.leagues?.h2h || []).map(l => ({
          id: l.id, name: l.name, rank: l.entry_rank,
          lastRank: l.entry_last_rank, movement: l.entry_rank != null && l.entry_last_rank != null ? (Number(l.entry_rank) < Number(l.entry_last_rank) ? "up" : Number(l.entry_rank) > Number(l.entry_last_rank) ? "down" : "neutral") : "neutral",
          created: l.created, closed: l.closed, scoring: l.scoring
        }))
      },
      gameweek: {
        average: picksEvent.average_entry_score ?? null,
        highest: picksEvent.highest_score ?? null,
        deadline: picksEvent.deadline_time,
        nextDeadline: events.filter(e => e.deadline_time && new Date(e.deadline_time).getTime() > Date.now()).sort((a,b) => new Date(a.deadline_time)-new Date(b.deadline_time))[0]?.deadline_time || picksEvent.deadline_time,
        finished: Boolean(picksEvent.finished)
      },
      history: (history.current || []).map(x => ({
        event: x.event, points: x.points, rank: x.overall_rank, eventRank: x.rank
      })),
      fixtures: (fixtures || []).filter(f => !f.finished && f.event >= picksEvent.id)
        .slice(0, 60).map(f => ({
          event: f.event,
          home: teams.get(f.team_h)?.short_name || "",
          away: teams.get(f.team_a)?.short_name || "",
          homeDifficulty: f.team_h_difficulty,
          awayDifficulty: f.team_a_difficulty,
          kickoff: f.kickoff_time
        })),
      note: "Public FPL data only. Bank and transfers may be unavailable or represent the selected gameweek snapshot."
    });
  } catch (error) {
    const status = error.status === 404 ? 404 : error.status === 403 ? 502 : 502;
    return json({
      error: status === 404
        ? "That FPL ID was not found, or its picks are not public yet."
        : "Could not load FPL data right now. The FPL service may be temporarily unavailable.",
      detail: error.message
    }, status);
  }
}
