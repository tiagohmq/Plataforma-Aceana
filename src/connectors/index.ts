import type { PipedriveConnector } from './pipedrive/interface.ts';
import { PipedriveMock } from './pipedrive/mock.ts';
import { PipedriveReal } from './pipedrive/real.ts';
import type { MondayConnector } from './monday/interface.ts';
import { MondayMock } from './monday/mock.ts';
import { MondayReal } from './monday/real.ts';
import type { DriveConnector } from './drive/interface.ts';
import { DriveMock } from './drive/mock.ts';
import { DriveReal } from './drive/real.ts';

// Clicksign: o upload é manual (decisão de 01/11). A plataforma só recebe o webhook (src/http/routes/webhooks.ts).
export interface Connectors {
  pipedrive: PipedriveConnector;
  monday: MondayConnector;
  drive: DriveConnector;
}

type Env = Record<string, string | undefined>;

/** Cria os conectores conforme *_MODE do .env (padrão: mock). Cada chamada cria instâncias novas. */
export function createConnectors(env: Env = process.env): Connectors {
  return {
    pipedrive: env.PIPEDRIVE_MODE === 'real' ? new PipedriveReal() : new PipedriveMock(),
    monday: env.MONDAY_MODE === 'real' ? new MondayReal() : new MondayMock(),
    drive: env.DRIVE_MODE === 'real' ? new DriveReal() : new DriveMock(),
  };
}
