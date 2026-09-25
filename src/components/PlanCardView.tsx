import type { PlanCard } from '../chess/structures';

/** Pawn-structure plan: what you aim for, what the opponent wants, concrete hints. */
export default function PlanCardView({ plan }: { plan: PlanCard }) {
  return (
    <div className="plan-card">
      <div className="pc-head">
        <span className="pc-tag">Structure</span>
        <strong>{plan.structure}</strong>
      </div>
      <p className="pc-sum">{plan.summary}</p>
      <div className="pc-cols">
        <div>
          <div className="pc-sub you">Your plan</div>
          <ul>{plan.you.map(t => <li key={t}>{t}</li>)}</ul>
        </div>
        <div>
          <div className="pc-sub opp">Watch out for</div>
          <ul>{plan.opponent.map(t => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
      {plan.hints.length > 0 && (
        <div className="pc-hints">
          {plan.hints.map(h => <span key={h}>◆ {h}</span>)}
        </div>
      )}
    </div>
  );
}
