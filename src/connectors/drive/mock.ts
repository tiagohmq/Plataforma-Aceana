import type { DriveConnector } from './interface.ts';

export class DriveMock implements DriveConnector {
  folders = new Map<string, { folderId: string; url: string; name: string }>();

  async ensureClientFolder(dealId: string, clientName: string): Promise<{ folderId: string; url: string }> {
    const cur = this.folders.get(dealId);
    if (cur) return cur;
    const f = { folderId: `pasta-${dealId}`, url: `https://drive.exemplo/pasta-${dealId}`, name: clientName };
    this.folders.set(dealId, f);
    return f;
  }
}
