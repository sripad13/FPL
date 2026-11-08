import "./fpl-pro.css";

export const FPL_PRO_PLANS = Object.freeze({
  monthly: { id: "monthly", name: "Monthly", price: 99, cadence: "month", description: "Flexible access, billed monthly." },
  season: { id: "season", name: "Season Pass", price: 499, cadence: "season", description: "One payment for the full FPL season.", featured: true }
});

const features = [
  ["Ideal XI optimiser", "Find the strongest projected starting XI for the next gameweek."],
  ["Captain and vice-captain picks", "Compare the leading armband options with projection context."],
  ["Transfer recommendations", "Prioritised moves with one-, three- and five-gameweek outlooks."],
  ["Chip strategy", "Plan Wildcard, Free Hit, Bench Boost and Triple Captain usage."],
  ["Squad planning tools", "Explore alternatives and understand the projected points trade-off."]
];

const money = value => "₹" + Number(value).toLocaleString("en-IN");

export function mountFplProPage(root) {
  if (!root) return;
  document.body.classList.add("fpl-pro-route");
  root.innerHTML = `
    <div class="pro-shell">
      <header class="pro-header">
        <a class="pro-wordmark" href="/" aria-label="TheSportzine FPL home"><span>THE</span> SPORTZINE <i>FPL</i></a>
        <a class="pro-back" href="/">← Back to FPL</a>
      </header>
      <main class="pro-main">
        <section class="pro-hero">
          <div class="pro-hero-copy">
            <span class="pro-eyebrow">THE SPORTZINE FPL · PRO</span>
            <h1>Make every FPL decision <em>count.</em></h1>
            <p>Go beyond the points tally. Get sharper squad decisions, captaincy insight and chip planning — built around your FPL team.</p>
            <a class="pro-primary-link" href="#pro-plans">Explore FPL Pro <span>↓</span></a>
            <div class="pro-trust"><span>✓</span> Your free FPL dashboard stays free. Upgrade only for deeper analysis.</div>
          </div>
          <div class="pro-hero-card" aria-label="FPL Pro feature preview">
            <div class="pro-card-top"><span>GAMEWEEK INTELLIGENCE</span><b>PRO PREVIEW</b></div>
            <div class="pro-projection"><div><small>PROJECTED XI</small><strong>68.4 <i>pts</i></strong></div><span class="pro-up">+6.2 vs current XI</span></div>
            <div class="pro-mini-row"><span><b class="pro-avatar">C</b><span><strong>Captain pick</strong><small>Best projected return</small></span></span><b>2×</b></div>
            <div class="pro-mini-row"><span><b class="pro-avatar muted">T</b><span><strong>Transfer watch</strong><small>One high-upside move</small></span></span><b>+4.1</b></div>
            <div class="pro-lock-note"><span>✦</span> Full recommendations unlock with Pro</div>
          </div>
        </section>

        <section class="pro-preview" aria-labelledby="pro-preview-title">
          <div class="pro-section-heading"><div><span class="pro-eyebrow">A TASTE OF PRO</span><h2 id="pro-preview-title">Preview before you upgrade.</h2></div><p>See the kind of decisions FPL Pro helps you make. Detailed player-level recommendations remain locked until you subscribe.</p></div>
          <div class="pro-preview-grid">
            <article class="pro-preview-card"><span class="pro-preview-icon">XI</span><small>IDEAL XI</small><h3>Build a stronger starting team.</h3><p>Preview your best formation and projected team score.</p><div class="pro-preview-stat"><span>Projected XI score</span><b>68.4 pts</b></div><div class="pro-blur-line"></div><div class="pro-blur-line short"></div><span class="pro-preview-lock">🔒 Player-by-player breakdown</span></article>
            <article class="pro-preview-card"><span class="pro-preview-icon">C</span><small>CAPTAINCY</small><h3>Make the armband decision count.</h3><p>Get a top captain preview and understand the upside.</p><div class="pro-preview-stat"><span>Top captain preview</span><b>Available</b></div><div class="pro-blur-line"></div><div class="pro-blur-line short"></div><span class="pro-preview-lock">🔒 Full captain comparison</span></article>
            <article class="pro-preview-card"><span class="pro-preview-icon">⇄</span><small>TRANSFER RADAR</small><h3>Know where your next move matters.</h3><p>See one transfer opportunity before unlocking the full shortlist.</p><div class="pro-preview-stat"><span>Transfer preview</span><b>1 opportunity</b></div><div class="pro-blur-line"></div><div class="pro-blur-line short"></div><span class="pro-preview-lock">🔒 1 / 3 / 5 GW analysis</span></article>
          </div>
          <p class="pro-demo-disclaimer">Illustrative preview data — your live recommendations will be generated from your linked FPL team.</p>
        </section>

        <section class="pro-plans" id="pro-plans" aria-labelledby="pro-plans-title">
          <div class="pro-section-heading centered"><div><span class="pro-eyebrow">SIMPLE PRICING</span><h2 id="pro-plans-title">Choose your FPL edge.</h2><p>No complicated tiers. All Pro features in either plan.</p></div></div>
          <div class="pro-plan-grid">
            <article class="pro-plan" data-plan="monthly"><div class="pro-plan-name">MONTHLY</div><div class="pro-price"><strong>₹99</strong><span>/ month</span></div><p>Flexible access with monthly billing.</p><ul><li>All FPL Pro tools</li><li>Cancel before your next renewal</li><li>Linked FPL team analysis</li></ul><button type="button" class="pro-plan-button" data-select-plan="monthly">Choose Monthly</button></article>
            <article class="pro-plan featured" data-plan="season"><div class="pro-popular">BEST VALUE</div><div class="pro-plan-name">SEASON PASS</div><div class="pro-price"><strong>₹499</strong><span>/ season</span></div><p>One payment for the full FPL season.</p><ul><li>Everything in Monthly</li><li>One full-season pass</li><li>One payment for the full season</li></ul><button type="button" class="pro-plan-button" data-select-plan="season">Choose Season Pass</button></article>
          </div>
          <p class="pro-billing-note">Prices shown in INR. The final checkout provider and applicable taxes will be confirmed before payments are enabled.</p>
        </section>

        <section class="pro-feature-list"><div class="pro-section-heading"><div><span class="pro-eyebrow">WHAT'S INCLUDED</span><h2>One upgrade. Every edge.</h2></div></div><div class="pro-feature-grid">${features.map(([name,description],i)=>`<article><span>0${i+1}</span><div><h3>${name}</h3><p>${description}</p></div><b>PRO</b></article>`).join("")}</div></section>
        <section class="pro-faq"><h2>Good to know</h2><details><summary>Will the free FPL dashboard remain available?</summary><p>Yes. Your existing squad, live points, leagues, fixtures and core dashboard remain free.</p></details><details><summary>How will I sign in?</summary><p>FPL Pro accounts will use Google sign-in. You will then link your FPL ID to your account.</p></details><details><summary>Which payment gateway will you use?</summary><p>The payment provider is intentionally not locked in yet. Checkout will be enabled only after the provider is selected and verified.</p></details><details><summary>Are projections guaranteed?</summary><p>No. FPL Pro recommendations are analytical estimates based on available FPL data, not guarantees of future points.</p></details></section>
      </main>
      <footer class="pro-footer"><span>THE SPORTZINE FPL PRO</span><a href="/">Return to your free dashboard</a></footer>
    </div>
    <div class="pro-toast" role="status" aria-live="polite" hidden></div>`;
  const toast=root.querySelector(".pro-toast");
  root.querySelectorAll("[data-select-plan]").forEach(button=>button.addEventListener("click",()=>{
    const plan=FPL_PRO_PLANS[button.dataset.selectPlan];
    if(!plan)return;
    toast.textContent=plan.name+" selected · "+money(plan.price)+(plan.cadence==="month"?"/month":" for the season")+". Google sign-in and secure checkout will be enabled in the next phase.";
    toast.hidden=false;
  }));
}
