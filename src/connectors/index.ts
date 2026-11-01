import type { PipedriveConnector } from './pipedrive/interface.ts';
import { PipedriveMock } from './pipedrive/mock.ts';
import { PipedriveReal } from './pipedrive/real.ts';

export interface Connectors {
  pipedrive: PipedriveConnector;
}

type Env = Record<string, string | undefined>;

/** Cria os conectores conforme *_MODE do .env (padrão: mock). Cada chamada cria instâncias novas. */
export function createConnectors(env: Env = process.env): Connectors {
  return {
    pipedrive: env.PIPEDRIVE_MODE === 'real' ? new PipedriveReal() : new PipedriveMock(),
  };
}
