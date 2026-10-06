export function NotFoundPage() {
  return (
    <main className="clock-page">
      <section className="clock-panel" aria-labelledby="not-found-title">
        <div className="clock-heading">
          <p className="eyebrow">CONTROL HORARIO</p>
          <h1 id="not-found-title">Página no encontrada</h1>
        </div>
        <p className="muted not-found-text">Esta aplicación sólo registra entradas y salidas del personal.</p>
        <div className="not-found-actions">
          <a className="button primary" href="/">Ir al fichador</a>
        </div>
      </section>
    </main>
  );
}
