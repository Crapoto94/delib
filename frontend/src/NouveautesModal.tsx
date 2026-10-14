import { Modal } from './ui';
import { BoutonsDemande, JournalVersions } from './JournalVersions';

/** « Nouveautés » (What's New) : le journal des versions complet, daté, avec les boutons de demande. S'ouvre depuis le pied de page. */
export default function Nouveautes({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Nouveautés de VibeDélib" onClose={onClose} wide>
      <div className="flex flex-col gap-3" style={{ height: 'min(70vh, 38rem)' }}>
        <div className="shrink-0"><BoutonsDemande /></div>
        <div className="min-h-0 flex-1 overflow-auto pr-1"><JournalVersions /></div>
      </div>
    </Modal>
  );
}
