import type { MondayConnector, ProjectInput } from './interface.ts';

export class MondayMock implements MondayConnector {
  items = new Map<string, ProjectInput & { status: string }>();
  failNext = 0;
  private seq = 1000;

  async createProject(input: ProjectInput): Promise<{ itemId: string }> {
    if (this.failNext > 0) { this.failNext--; throw new Error('Monday simulado: falha forçada'); }
    const itemId = String(++this.seq);
    this.items.set(itemId, { ...input, status: 'Fechado e não iniciado' });
    return { itemId };
  }
}
