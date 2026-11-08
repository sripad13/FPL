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
        multiplier: Number(pick.multiplier || 0),
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
    const bench = picks.filter(p => p.positionOrder > 11).sort((a,b) => (a.position==="GKP"?0:1)-(b.position==="GKP"?0:1) || a.positionOrder-b.positionOrder);
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

    // Deterministic chip planner: evaluate future gameweeks from FPL fixtures and the manager's own squad.
    // The two chip windows are independent: GW1-19 and GW20-38.
    const chipHistory = history.chips || [];
    const chipNames = [...new Set((bootstrap.chips || []).map(chip => String(chip.name || "").toLowerCase()).filter(Boolean))];
    const chipDisplay = name => chipLabels[name] || name.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    const firstHalfChipNames = chipNames;
    const planningEvents = events.filter(event => event.id >= nextEvent && event.id <= 19);
    // Reconstruct the free-transfer bank from event transfer history. Wildcard and Free Hit preserve the bank.
    const freeTransferByEvent = new Map();
    for (const record of (history.current || [])) freeTransferByEvent.set(Number(record.event), Number(record.event_transfers || 0));
    if (!freeTransferByEvent.has(picksEvent.id)) freeTransferByEvent.set(picksEvent.id, Number(entryHistory.event_transfers || 0));
    let freeTransfers = 1;
    const chipsByEvent = new Set(chipHistory.filter(chip => ["wildcard","freehit"].includes(String(chip.name || "").toLowerCase())).map(chip => Number(chip.event)));
    for (let gw = 1; gw <= picksEvent.id; gw++) {
      const made = freeTransferByEvent.get(gw);
      if (made != null && !chipsByEvent.has(gw)) freeTransfers = Math.max(0, freeTransfers - made);
      freeTransfers = Math.min(5, freeTransfers + 1);
    }
    freeTransfers = Math.max(1, Math.min(5, freeTransfers));
    const playerProjection = (player, eventId) => {
      const element = elements.get(player.id) || {};
      const schedule = teamFixtures.get(player.clubId) || [];
      const fixturesForEvent = schedule.filter(f => f.event === eventId);
      if (!fixturesForEvent.length) return 0;
      const base = Number(element.ep_next) > 0 && eventId === nextEvent
        ? Number(element.ep_next)
        : Math.max(0, Number(element.form || player.form || 0) * .45 + Number(element.points_per_game || 0) * .55);
      const availability = eventId === nextEvent && player.chanceOfPlaying != null
        ? Math.max(0, Math.min(1, Number(player.chanceOfPlaying) / 100)) : 1;
      const fixtureMultiplier = fixturesForEvent.reduce((sum, fixture) =>
        sum + Math.max(.55, Math.min(1.35, 1 + (3 - Number(fixture.difficulty || 3)) * .105)) * (fixture.venue === "H" ? 1.06 : .96), 0);
      return base * fixtureMultiplier * availability;
    };
    const bestSquadLineup = eventId => {
      const ranked = picks.map(player => ({ player, points: playerProjection(player, eventId) }));
      let best = null;
      for (let def = 3; def <= 5; def++) for (let mid = 3; mid <= 5; mid++) {
        const fwd = 10 - def - mid;
        if (fwd < 1 || fwd > 3) continue;
        const take = (position, count) => ranked.filter(x => x.player.position === position).sort((a,b) => b.points-a.points).slice(0,count);
        const xi = [...take("GKP",1), ...take("DEF",def), ...take("MID",mid), ...take("FWD",fwd)];
        if (xi.length !== 11) continue;
        const total = xi.reduce((sum,x)=>sum+x.points,0);
        if (!best || total > best.total) best = {xi,total};
      }
      if (!best) return {xi:[],bench:[],total:0,captain:null};
      const selected = new Set(best.xi.map(x=>x.player.id));
      const bench = ranked.filter(x=>!selected.has(x.player.id)).sort((a,b)=>b.points-a.points);
      const captain = [...best.xi].sort((a,b)=>b.points-a.points)[0] || null;
      return {...best,bench,captain};
    };
    const buildChipSquadAndTransfers = (eventId, allowTransfers = true) => {
      let simulated = picks.map(player => ({...player}));
      const projection = player => {
        const schedule = teamFixtures.get(player.clubId || player.team) || [];
        const eventFixtures = schedule.filter(f => f.event === eventId);
        if (!eventFixtures.length) return 0;
        const element = elements.get(player.id) || player;
        const base = Number(element.ep_next) > 0 && eventId === nextEvent
          ? Number(element.ep_next)
          : Math.max(0, Number(element.form || player.form || 0) * .45 + Number(element.points_per_game || 0) * .55);
        const availability = eventId === nextEvent && player.chanceOfPlaying != null
          ? Math.max(0, Math.min(1, Number(player.chanceOfPlaying) / 100)) : 1;
        const multiplier = eventFixtures.reduce((sum,f)=>sum+Math.max(.55,Math.min(1.35,1+(3-Number(f.difficulty||3))*.105))*(f.venue==="H"?1.06:.96),0);
        return base * multiplier * availability;
      };
      const prepTransfers=[];
      const usedCandidates=new Set();
      const clubCounts=()=>{const counts=new Map();for(const p of simulated)counts.set(p.clubId,(counts.get(p.clubId)||0)+1);return counts;};
      for(let slot=0;allowTransfers && slot<freeTransfers;slot++){
        const counts=clubCounts();
        let best=null;
        for(const outgoing of simulated){
          const outgoingElement=elements.get(outgoing.id)||{};
          const budget=Number(outgoing.sellingPrice??outgoing.price)+bank;
          const outgoingProjection=projection(outgoing);
          for(const candidate of bootstrap.elements||[]){
            if(usedCandidates.has(candidate.id)||simulated.some(p=>p.id===candidate.id))continue;
            if(candidate.element_type!==outgoingElement.element_type||(candidate.now_cost||0)/10>budget+.0001)continue;
            const currentCount=counts.get(candidate.team)||0;
            const removedFromTeam=candidate.team===outgoing.clubId?1:0;
            if(currentCount-removedFromTeam>=3)continue;
            if(candidate.status!=="a"&&!(candidate.status==="d"&&Number(candidate.chance_of_playing_next_round??50)>=75))continue;
            const incoming={id:candidate.id,clubId:candidate.team,team:candidate.team,form:Number(candidate.form||0),chanceOfPlaying:candidate.chance_of_playing_next_round,price:(candidate.now_cost||0)/10};
            const incomingProjection=projection(incoming);
            const gain=incomingProjection-outgoingProjection;
            if(gain>0&&(!best||gain>best.gain))best={outgoing,incoming:candidate,gain,incomingProjection,outgoingProjection};
          }
        }
        if(!best)break;
        usedCandidates.add(best.incoming.id);
        simulated=simulated.filter(p=>p.id!==best.outgoing.id);
        const club=teams.get(best.incoming.team)||{};
        const fixtureList=(teamFixtures.get(best.incoming.team)||[]).filter(f=>f.event===eventId);
        prepTransfers.push({
          outId:best.outgoing.id,outName:best.outgoing.webName,
          inId:best.incoming.id,inName:best.incoming.web_name,
          club:club.short_name||"",position:best.outgoing.position,
          price:(best.incoming.now_cost||0)/10,
          projectedGain:Number(best.gain.toFixed(1)),
          projectedPoints:Number(best.incomingProjection.toFixed(1)),
          fixtures:fixtureList
        });
        simulated.push({...best.outgoing,id:best.incoming.id,webName:best.incoming.web_name,club:club.short_name||"",clubId:best.incoming.team,price:(best.incoming.now_cost||0)/10,sellingPrice:(best.incoming.now_cost||0)/10,form:Number(best.incoming.form||0),chanceOfPlaying:best.incoming.chance_of_playing_next_round});
      }
      const squad=simulated.map(player=>{
        const fixtureList=(teamFixtures.get(player.clubId)||[]).filter(f=>f.event===eventId);
        return {id:player.id,name:player.webName,club:player.club,position:player.position,role:Number(player.positionOrder||0)<=11?"XI":"BENCH",projectedPoints:Number(projection(player).toFixed(1)),fixtures:fixtureList};
      }).sort((a,b)=>["GKP","DEF","MID","FWD"].indexOf(a.position)-["GKP","DEF","MID","FWD"].indexOf(b.position)||b.projectedPoints-a.projectedPoints);
      return {squad,prepTransfers,freeTransfers};
    };
    const chipScoreForEvent = (name, eventId) => {
      const lineup = bestSquadLineup(eventId);
      const all = picks.map(player=>({player,points:playerProjection(player,eventId)}));
      const doubleSquad = all.filter(x=>(teamFixtures.get(x.player.clubId)||[]).filter(f=>f.event===eventId).length>1).length;
      const blankSquad = all.filter(x=>(teamFixtures.get(x.player.clubId)||[]).filter(f=>f.event===eventId).length===0).length;
      const doubleLeagueTeams = new Set((fixtures||[]).filter(f=>f.event===eventId&&!f.finished).flatMap(f=>[
        (teamFixtures.get(f.team_h)||[]).filter(x=>x.event===eventId).length>1?f.team_h:null,
        (teamFixtures.get(f.team_a)||[]).filter(x=>x.event===eventId).length>1?f.team_a:null
      ].filter(Boolean))).size;
      const captainPoints = lineup.captain?.points || 0;
      const benchPoints = lineup.bench.reduce((sum,x)=>sum+x.points,0);
      const nextThree = [eventId,eventId+1,eventId+2].map(gw=>bestSquadLineup(gw));
      const weakSquad = nextThree.reduce((sum,x)=>sum+x.xi.filter(p=>p.points<2).length,0);
      const isWildcard = name==="wildcard";
      const isFreeHit = name==="freehit";
      const isBenchBoost = name==="bboost";
      const isTripleCaptain = name==="3xc";
      const isAssistant = name==="assistant_manager";
      let score=0, reason="", evidence={};
      if(isTripleCaptain){
        score=captainPoints*7 + (lineup.captain && (teamFixtures.get(lineup.captain.player.clubId)||[]).filter(f=>f.event===eventId).length>1?28:0);
        reason=lineup.captain
          ? lineup.captain.player.webName+" is your best projected captain at "+captainPoints.toFixed(1)+" points"+(((teamFixtures.get(lineup.captain.player.clubId)||[]).filter(f=>f.event===eventId).length>1)?" across a double gameweek":"")+". Triple Captain adds the captain's points a second time."
          : "No reliable captain projection is available for this gameweek.";
        evidence={captain:lineup.captain?.player.webName||null,captainProjection:Number(captainPoints.toFixed(1))};
      }else if(isBenchBoost){
        score=benchPoints*8 + doubleSquad*5;
        reason="Your four substitutes project "+benchPoints.toFixed(1)+" combined points"+(doubleSquad?" and "+doubleSquad+" squad players have multiple fixtures":"")+". Bench Boost adds all four bench scores to your total.";
        evidence={benchProjection:Number(benchPoints.toFixed(1)),doubleGameweekSquadPlayers:doubleSquad};
      }else if(isFreeHit){
        score=blankSquad*13 + doubleLeagueTeams*2 + doubleSquad*3;
        reason=blankSquad+" of your 15 players have no fixture"+(doubleLeagueTeams?" while "+doubleLeagueTeams+" clubs have a double gameweek":"")+". Free Hit is most valuable when your current squad is poorly placed for this one-week fixture slate.";
        evidence={blankSquadPlayers:blankSquad,doubleGameweekTeams:doubleLeagueTeams,doubleGameweekSquadPlayers:doubleSquad};
      }else if(isWildcard){
        score=weakSquad*12 + nextThree.reduce((sum,x)=>sum+x.xi.filter(p=>p.points<3).length,0)*2;
        reason="Across the next three gameweeks, "+weakSquad+" starting-player slots project below 2 points. This is a useful reset window if your current squad needs several changes; reassess once team news and fixtures are confirmed.";
        evidence={lowProjectionSlotsNextThree:weakSquad};
      }else if(isAssistant){
        const teamIds=[...new Set(picks.map(p=>p.clubId))];
        const teamOutlook=teamIds.map(teamId=>({teamId,fixtures:(teamFixtures.get(teamId)||[]).filter(f=>f.event===eventId)}));
        const favourable=teamOutlook.filter(x=>x.fixtures.length>0&&x.fixtures.every(f=>f.difficulty<=2)).length;
        score=favourable*12+doubleSquad*4;
        reason=favourable+" of the clubs represented in your squad have favourable FDR 1–2 fixtures"+(doubleSquad?", with "+doubleSquad+" of your players in double-gameweek teams":"")+".";
        evidence={favourableSquadClubs:favourable,doubleGameweekSquadPlayers:doubleSquad};
      }else{
        score=benchPoints*3+captainPoints*3+doubleSquad*3-blankSquad*2;
        reason="Based on your squad's projected points, fixture volume and availability.";
        evidence={benchProjection:Number(benchPoints.toFixed(1)),captainProjection:Number(captainPoints.toFixed(1)),doubleGameweekSquadPlayers:doubleSquad,blankSquadPlayers:blankSquad};
      }
      return {score:Number(score.toFixed(2)),reason,evidence};
    };
    const optimiseChipWindow = (windowStart,windowEnd,label) => {
      const start=Math.max(nextEvent,windowStart), end=windowEnd;
      if(start>end)return {label,start:windowStart,end:windowEnd,availableChips:[],usedChips:chipNames.filter(name=>chipHistory.some(chip=>String(chip.name||"").toLowerCase()===name&&Number(chip.event)>=windowStart&&Number(chip.event)<=windowEnd)).map(chipDisplay),recommendations:[],note:"The first-set chip window closed after GW19. These chips cannot be used from GW20 onwards."};
      const used=chipNames.filter(name=>chipHistory.some(chip=>String(chip.name||"").toLowerCase()===name&&Number(chip.event)>=windowStart&&Number(chip.event)<=windowEnd));
      const available=firstHalfChipNames.filter(name=>!used.includes(name));
      if(!available.length)return {label,start,end,availableChips:[],usedChips:used.map(chipDisplay),recommendations:[],note:"All chips in this window have already been used."};
      const candidates=available.map(name=>({name,options:planningEvents.filter(event=>event.id>=start&&event.id<=end).map(event=>({event:event.id,...chipScoreForEvent(name,event.id)})).sort((a,b)=>b.score-a.score).slice(0,8)}));
      let bestScore=-Infinity,bestPlan=[];
      const search=(index,used,plan,total)=>{
        if(index>=candidates.length){if(total>bestScore){bestScore=total;bestPlan=plan.slice();}return;}
        const item=candidates[index];
        for(const option of item.options){
          if(used.has(option.event))continue;
          used.add(option.event);plan.push({name:item.name,...option});
          search(index+1,used,plan,total+option.score);
          plan.pop();used.delete(option.event);
        }
        search(index+1,used,plan,total);
      };
      search(0,new Set(),[],0);
      const recommendations=bestPlan.sort((a,b)=>a.event-b.event).map(item=>{
        const transferPreparationAllowed=!["wildcard","freehit"].includes(item.name);
        const preparation=buildChipSquadAndTransfers(item.event,transferPreparationAllowed);
        const prepNote=item.name==="wildcard"?"Wildcard already gives you a squad reset with unlimited transfers; save your free transfers rather than making pre-chip moves.":item.name==="freehit"?"Avoid pre-chip transfers: Free Hit creates a one-week squad and your original team returns afterwards.":"Suggested moves use only your banked free transfers and are selected for this chip's target gameweek.";
        return {...item,chip:chipDisplay(item.name),...preparation,prepNote};
      });
      return {label,start,end,availableChips:available.map(chipDisplay),usedChips:used.map(chipDisplay),recommendations,note:"The planner compares candidate gameweeks for every available chip and selects the highest-scoring non-overlapping schedule."};
    };
    const chipStrategy = {
      currentEvent: nextEvent,
      freeTransfers,
      maxFreeTransfers: 5,
      windows: [
        optimiseChipWindow(1,19,"FIRST SET · GW1–GW19")
      ].filter(Boolean),
      methodology:"First-set chips only (GW1–GW19). Transfer preparation uses your reconstructed free-transfer bank (one per gameweek, maximum five) and suggests only positive-projection moves within that bank. Player and fixture projections are estimates, not guarantees."
    };

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
      squad: { starting, bench },
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
