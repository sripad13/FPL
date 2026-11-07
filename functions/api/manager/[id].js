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
    const picks = (picksPayload.picks || []).map(pick => {
      const player = elements.get(pick.element) || {};
      const club = teams.get(player.team) || {};
      const livePlayer = liveElements.get(pick.element) || {};
      const stats = livePlayer.stats || {};
      return {
        id: pick.element,
        name: `${player.first_name || ""} ${player.second_name || ""}`.trim() || "Player",
        webName: player.web_name || "Player",
        position: (bootstrap.element_types || []).find(t => t.id === player.element_type)?.singular_name_short || "",
        club: club.short_name || "",
        clubName: club.name || "",
        clubId: player.team,
        price: (player.now_cost || 0) / 10,
        points: Number(stats.total_points || 0),
        minutes: Number(stats.minutes || 0),
        multiplier: Number(pick.multiplier || 0),
        isCaptain: Boolean(pick.is_captain),
        isViceCaptain: Boolean(pick.is_vice_captain),
        positionOrder: Number(pick.position || 0),
        status: player.status || "a",
        news: player.news || ""
      };
    });

    const starting = picks.filter(p => p.positionOrder <= 11).sort((a,b) => a.positionOrder-b.positionOrder);
    const bench = picks.filter(p => p.positionOrder > 11).sort((a,b) => a.positionOrder-b.positionOrder);
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

    return json({
      manager: {
        id: manager.id,
        name: manager.player_name,
        teamName: manager.name,
        overallPoints: manager.summary_overall_points,
        overallRank: manager.summary_overall_rank,
        previousOverallRank,
        rankChange,
        eventPoints: score,
        eventRank: entryHistory.rank ?? null,
        teamValue: entryHistory.value != null ? entryHistory.value / 10 : null,
        bank: entryHistory.bank != null ? entryHistory.bank / 10 : null,
        transfers: entryHistory.event_transfers ?? null,
        event: picksEvent.id,
        eventName: picksEvent.name
      },
      squad: { starting, bench },
      leagues: {
        classic: (manager.leagues?.classic || []).map(l => ({
          id: l.id, name: l.name, rank: l.entry_rank,
          lastRank: l.entry_last_rank, movement: l.entry_movement,
          created: l.created, closed: l.closed, scoring: l.scoring
        })),
        h2h: (manager.leagues?.h2h || []).map(l => ({
          id: l.id, name: l.name, rank: l.entry_rank,
          lastRank: l.entry_last_rank, movement: l.entry_movement,
          created: l.created, closed: l.closed, scoring: l.scoring
        }))
      },
      gameweek: {
        average: picksEvent.average_entry_score ?? null,
        highest: picksEvent.highest_score ?? null,
        deadline: picksEvent.deadline_time,
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
