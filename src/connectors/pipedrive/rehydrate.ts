import type { Db } from '../../db/client.ts';
import type { PipedriveMock } from './mock.ts';

/**
 * O Pipedrive simulado guarda estado em memória. Na partida, reaplica as gravações que a fila já concluiu,
 * para o deal simulado continuar igual ao que a plataforma enviou (senão a conferência do contrato acusaria divergência).
 * Só faz sentido no modo mock: o Pipedrive real guarda o próprio estado.
 */
export async function rehydratePipedriveMock(db: Db, mock: PipedriveMock): Promise<void> {
  const done = await db.query<{ type: string; payload: { dealId: string; fields?: { stage?: string; valueCents?: number }; wonAt?: string } }>(
    "select type, payload from jobs where status = 'done' and type in ('pipedrive.updateDeal', 'pipedrive.markWon') order by updated_at");
  for (const j of done.rows) {
    const d = mock.deals.get(j.payload.dealId);
    if (!d) continue;
    if (j.type === 'pipedrive.markWon') mock.deals.set(d.id, { ...d, status: 'won', wonAt: j.payload.wonAt, stage: 'Ganho' });
    else mock.deals.set(d.id, { ...d, ...(j.payload.fields?.stage ? { stage: j.payload.fields.stage } : {}), ...(j.payload.fields?.valueCents ? { value: j.payload.fields.valueCents } : {}) });
  }
}
