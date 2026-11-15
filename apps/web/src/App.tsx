import { CURRENT_SCHEMA_VERSION } from '@lastplan/core';

/** App-Rahmen (Platzhalter). Ansichten folgen ab Meilenstein 3. */
export function App() {
  return (
    <>
      <header className="app-header">
        <span className="app-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9 1 3 9h4l-1 6 6-8H8l1-6z" />
          </svg>
        </span>
        <span className="app-title">LastPlan</span>
      </header>
      <main className="app-main">
        <section className="app-card" aria-labelledby="start-title">
          <h1 id="start-title">Grundgerüst</h1>
          <p>
            Projektübersicht und Editor folgen ab Meilenstein 3. Projektformat-Version:{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{CURRENT_SCHEMA_VERSION}</span>
          </p>
        </section>
      </main>
    </>
  );
}
