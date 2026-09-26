import React from 'react';

/**
 * Filet de sécurité de l'interface : sans lui, la moindre erreur de rendu d'un composant vide la page entière (écran
 * blanc), sans rien dire à l'agent ni au développeur. Ici, l'erreur est affichée et journalisée, et le reste de
 * l'application n'est pas perdu.
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { erreur: Error | null }> {
  state: { erreur: Error | null } = { erreur: null };

  static getDerivedStateFromError(erreur: Error) { return { erreur }; }

  componentDidCatch(erreur: Error, infos: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Erreur de rendu :', erreur, infos.componentStack);
  }

  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <div className="m-6 card p-6" role="alert">
        <h1 className="mb-2 text-lg font-semibold text-ko">Une erreur est survenue dans l’affichage</h1>
        <p className="mb-3 text-[13px] text-mute">
          L’action a été interrompue, mais vos données sont intactes. Rechargez la page ; si le problème persiste,
          transmettez le message ci-dessous.
        </p>
        <pre className="mb-3 overflow-auto rounded bg-soft p-3 text-[12px]">{this.state.erreur.message}</pre>
        <button className="btn-primary" onClick={() => window.location.reload()}>Recharger la page</button>
      </div>
    );
  }
}
