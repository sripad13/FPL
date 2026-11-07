import "./style.css";

const app = document.querySelector("#app");
const savedId = "82285";
const clubColors = {
  ARS: "#e52b38", AVL: "#8b1e55", BOU: "#c83c3c", BRE: "#c62828",
  BHA: "#1674c8", BUR: "#7a263a", CHE: "#1766c2", CRY: "#1b4e9b",
  EVE: "#1763bf", FUL: "#f0f0f0", LEE: "#f1d638", LIV: "#d71920",
  MCI: "#65b9e9", MUN: "#d71920", NEW: "#d8d8d8", NFO: "#d71920",
  SUN: "#d71920", TOT: "#f6f6f6", WHU: "#7b263a", WOL: "#e6a900"
};

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function shirt(p) {
  const color = clubColors[p.club] || "#777";
  const textColor = ["#f0f0f0","#f1d638","#65b9e9","#d8d8d8"].includes(color) ? "#111" : "#fff";
  return `<div class="shirt" style="--shirt:${color};--shirt-text:${textColor}" aria-label="${esc(p.club)} shirt"><span>${esc(p.club || "FC")}</span></div>`;
}
function playerCard(p) {
  return `<div class="player">
    ${shirt(p)}
    <div class="player-name">${esc(p.webName)}${p.isCaptain ? ' <b class="captain">C</b>' : p.isViceCaptain ? ' <b class="captain vc">VC</b>' : ""}</div>
    <div class="player-points">${p.points} <small>pts</small></div>
  </div>`;
}
function formationRows(starting) {
  const rows = [[], [], [], []];
  for (const p of starting) {
    const idx = Math.max(0, Math.min(3, p.positionOrder === 1 ? 0 : p.positionOrder <= 5 ? 1 : p.positionOrder <= 9 ? 2 : 3));
    rows[idx].push(p);
  }
  return rows.map(row => `<div class="pitch-row">${row.map(playerCard).join("")}</div>`).join("");
}
function skeleton() {
  app.innerHTML = `<div class="shell"><header class="brand"><div class="brand-mark">♛</div><div><strong>TheSportzine <em>FPL</em></strong><small>Live Rank · Player Analytics · FPL Tools</small></div><button class="theme" id="theme">◐</button></header>
  <nav class="nav">${["Dashboard","Live Rank","My Team","Players","Compare","Fixtures","Transfers","Tools","Stats"].map((x,i)=>`<span class="${i===0?"active":""}">${x}</span>`).join("")}</nav>
  <main><div class="title-row"><div><h1>My Team <b class="live-dot">LIVE</b></h1><p id="gw-label">Loading gameweek…</p></div><div class="id-control"><span id="team-name">Your Team</span><label>FPL ID <input id="fpl-id" value="${savedId}" inputmode="numeric" aria-label="FPL ID"></label><button id="load">↻</button></div></div>
  <section class="metrics"><div class="points"><small>Current Points</small><strong id="points">—</strong><span id="points-note">Loading live score</span></div>
    <div class="metric"><small>Overall Rank</small><strong id="rank">—</strong></div><div class="metric"><small>Overall Points</small><strong id="overall">—</strong></div><div class="metric"><small>GW Average</small><strong id="average">—</strong></div><div class="metric"><small>Team Value</small><strong id="value">—</strong></div><div class="metric"><small>In the Bank</small><strong id="bank">—</strong></div><div class="metric"><small>Transfers</small><strong id="transfers">—</strong></div>
  </section>
  <section class="main-grid"><div class="panel squad-panel"><div class="panel-head"><h2>Squad</h2><span id="formation">Starting XI</span></div><div class="pitch"><div class="pitch-lines"></div><div id="starting" class="starting"><div class="loading">Loading your squad…</div></div><div class="bench"><div class="bench-label">SUBSTITUTES</div><div id="bench" class="bench-row"></div></div></div></div>
  <aside class="side-stack"><div class="panel rank-panel"><div class="panel-head"><h2>Live Rank</h2><span class="tag">FPL profile</span></div><strong id="rank-large">—</strong><small>Official rank snapshot</small><div class="sparkline"> <svg viewBox="0 0 400 72" preserveAspectRatio="none"><path d="M0 58 C45 52 60 30 110 39 S180 48 220 28 S280 42 320 22 S360 18 400 5" /></svg></div></div>
  <div class="panel summary"><h2>Gameweek Summary</h2><div><span>Gameweek points</span><b id="summary-points">—</b></div><div><span>Overall rank</span><b id="summary-rank">—</b></div><div><span>Gameweek average</span><b id="summary-average">—</b></div><div><span>Gameweek status</span><b id="gw-status">—</b></div></div>
  <div class="panel trend"><div class="panel-head"><h2>Rank Trend</h2><span class="tag">Season</span></div><div id="trend-chart" class="chart-empty">Waiting for history</div></div></aside></section>
  <section class="bottom-grid"><div class="panel"><div class="panel-head"><h2>Player Analytics</h2><span class="tag">Your squad</span></div><div class="table-wrap"><table><thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Price</th><th>GW Pts</th><th>Role</th></tr></thead><tbody id="players-table"><tr><td colspan="6">Loading…</td></tr></tbody></table></div></div>
  <div class="panel"><div class="panel-head"><h2>Upcoming Fixtures</h2><span class="tag">Next fixtures</span></div><div id="fixtures" class="fixture-list">Loading…</div></div></section>
  <p class="footnote">Unofficial community dashboard. Data from the public Fantasy Premier League API. Live scores and ranks can change while matches are in progress.</p></main></div>`;
}
function fmt(n) { return n == null ? "—" : Number(n).toLocaleString("en-GB"); }
function render(data) {
  const m = data.manager;
  document.querySelector("#gw-label").textContent = `${m.eventName} · 2026/27`;
  document.querySelector("#team-name").textContent = m.teamName || m.name || "Your Team";
  document.querySelector("#points").textContent = fmt(m.eventPoints);
  document.querySelector("#rank").textContent = fmt(m.overallRank);
  document.querySelector("#rank-large").textContent = fmt(m.overallRank);
  document.querySelector("#overall").textContent = fmt(m.overallPoints);
  document.querySelector("#average").textContent = fmt(data.gameweek.average);
  document.querySelector("#value").textContent = m.teamValue == null ? "—" : `£${m.teamValue.toFixed(1)}m`;
  document.querySelector("#bank").textContent = m.bank == null ? "—" : `£${m.bank.toFixed(1)}m`;
  document.querySelector("#transfers").textContent = m.transfers == null ? "—" : `${m.transfers} FT`;
  document.querySelector("#summary-points").textContent = fmt(m.eventPoints);
  document.querySelector("#summary-rank").textContent = fmt(m.overallRank);
  document.querySelector("#summary-average").textContent = fmt(data.gameweek.average);
  document.querySelector("#gw-status").textContent = data.gameweek.finished ? "Finished" : "In progress / upcoming";
  document.querySelector("#points-note").textContent = data.gameweek.finished ? "Gameweek score" : "Live / provisional";
  const start = data.squad.starting;
  const bench = data.squad.bench;
  document.querySelector("#formation").textContent = `${start.filter(p=>p.position==="DEF").length}-${start.filter(p=>p.position==="MID").length}-${start.filter(p=>p.position==="FWD").length}`;
  document.querySelector("#starting").innerHTML = formationRows(start);
  document.querySelector("#bench").innerHTML = bench.map(playerCard).join("");
  const all = [...start, ...bench];
  document.querySelector("#players-table").innerHTML = all.map(p=>`<tr><td><div class="table-player">${shirt(p)}<span>${esc(p.webName)}</span></div></td><td>${esc(p.club)}</td><td>${esc(p.position)}</td><td>£${p.price.toFixed(1)}m</td><td><b>${p.points}</b></td><td>${p.isCaptain?"Captain":p.isViceCaptain?"Vice-captain":p.multiplier===0?"Bench":"Starter"}</td></tr>`).join("");
  const hist = data.history.filter(x=>x.rank).slice(-10);
  if (hist.length > 1) {
    const max = Math.max(...hist.map(x=>x.rank)), min = Math.min(...hist.map(x=>x.rank));
    const pts = hist.map((x,i)=>`${(i/(hist.length-1))*100},${8+((x.rank-min)/(max-min||1))*48}`).join(" ");
    document.querySelector("#trend-chart").innerHTML = `<svg viewBox="0 0 100 65" preserveAspectRatio="none"><polyline points="${pts}" /></svg><div class="chart-labels"><span>GW${hist[0].event}</span><span>GW${hist[hist.length-1].event}</span></div>`;
  } else document.querySelector("#trend-chart").textContent = "Not enough rank history yet";
  document.querySelector("#fixtures").innerHTML = data.fixtures.slice(0,8).map(f=>`<div class="fixture"><span>GW${f.event}</span><b>${esc(f.home)} <small>vs</small> ${esc(f.away)}</b><span class="difficulty">${new Date(f.kickoff).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span></div>`).join("") || "No upcoming fixtures found";
}
async function load(id) {
  const button = document.querySelector("#load");
  button.textContent = "…";
  document.querySelector("#starting").innerHTML = `<div class="loading">Fetching your FPL squad…</div>`;
  try {
    const res = await fetch(`/api/manager/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load this FPL ID.");
    render(data);
  } catch (e) {
    document.querySelector("#starting").innerHTML = `<div class="error">${esc(e.message)}<br><small>Check the FPL ID or try again shortly.</small></div>`;
  } finally { button.textContent = "↻"; }
}
skeleton();
document.querySelector("#load").addEventListener("click", () => load(document.querySelector("#fpl-id").value.trim()));
document.querySelector("#fpl-id").addEventListener("keydown", e => { if (e.key === "Enter") load(e.currentTarget.value.trim()); });
document.querySelector("#theme").addEventListener("click", () => document.body.classList.toggle("light"));
load(savedId);
