export type Role = 'GN' | 'GP' | 'DP' | 'DIRETORIA' | 'ADMIN';
export type Capability =
  | 'proposal.edit' | 'price.approve' | 'exception.approve' | 'margin.view' | 'personal.view'
  | 'handoff.view' | 'catalog.edit' | 'params.publish' | 'admin';

// Matriz do plano v0.1 §10 / spec §9. Mudança aqui é decisão: registrar em docs/decisoes.md.
const MATRIX: Record<Capability, readonly Role[]> = {
  'proposal.edit': ['GN'],
  'price.approve': ['GN', 'DP'],
  'exception.approve': ['DP', 'DIRETORIA'],
  'margin.view': ['GN', 'DP', 'DIRETORIA'],
  'personal.view': ['GN', 'DIRETORIA'],
  'handoff.view': ['GN', 'GP', 'DP', 'DIRETORIA'],
  'catalog.edit': ['DP'],
  'params.publish': ['DP'],
  admin: ['ADMIN'],
};

export const can = (role: Role, cap: Capability): boolean => MATRIX[cap].includes(role);
