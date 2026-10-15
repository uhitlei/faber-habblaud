// Fábrica Faber no modo demonstração: dados fixos (sem sorteio, para não mexer na sequência do simulador) em duas
// salas — o repositório da fábrica com uma demanda esperando você e outra bloqueada, e uma sala em desenvolvimento.
import type { FaberRoomInfo } from '../faber';
import { tr } from '../i18n';

export function demoFaber(project: string, now: number): FaberRoomInfo | undefined {
  const ago = (min: number) => now - min * 60_000;
  if (project === 'loja-virtual') {
    return {
      tasks: [
        { id: 'TASK-42', title: tr('Checkout com Pix'), type: 'feature', state: 'my-review', column: 'My Review', gate: 'G6', awaitingOwner: 'G6', agent: 'qa', updatedAt: ago(4) },
        { id: 'TASK-45', title: tr('Cupom some no carrinho'), type: 'bug', state: 'blocked', column: 'Blocked', gate: 'G3', blocked: tr('esperando acesso ao sandbox do gateway'), agent: 'senior-developer', updatedAt: ago(30) },
        { id: 'TASK-47', title: tr('Filtro por tamanho'), type: 'feature', state: 'in-development', column: 'In Development', gate: 'G3', agent: 'senior-developer', updatedAt: ago(12) },
      ],
      done: 9,
    };
  }
  if (project === 'api-pagamentos') {
    return {
      task: { id: 'TASK-18', title: tr('Estorno parcial'), type: 'feature', state: 'code-review', column: 'Review & Validation', gate: 'G4', agent: 'code-reviewer', updatedAt: ago(7) },
    };
  }
  return undefined;
}
