import { Component, ReactNode } from 'react';

/**
 * Filet de sécurité d'affichage : sans lui, la moindre exception pendant le rendu démonte tout l'arbre React
 * et laisse une page blanche, sans message ni piste (c'est ce qui se produisait quand l'identité publique
 * de la collectivité revenait dans un format inattendu). On affiche l'erreur et un bouton de rechargement.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { erreur: Error | null }> {
  state: { erreur: Error | null } = { erreur: null };

  static getDerivedStateFromError(erreur: Error) { return { erreur }; }

  componentDidCatch(erreur: Error, infos: unknown) { console.error('Erreur d’affichage de l’espace élus', erreur, infos); }

  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-page p-4">
        <section className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-float">
          <h1 className="text-[20px]">L’application n’a pas pu s’afficher</h1>
          <p className="mt-2 text-[14px] text-mute">Rechargez la page. Si le problème persiste, signalez-le à la DSI en précisant le message ci-dessous.</p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-soft p-3 text-[12px] text-ko">{this.state.erreur.message}</pre>
          <button className="btn-primary mt-4 w-full !py-3 !text-[16px]" onClick={() => location.reload()}>Recharger</button>
        </section>
      </main>
    );
  }
}
