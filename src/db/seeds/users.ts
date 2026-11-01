import type { Role } from '../../domain/permissions.ts';

// Usuários do protótipo v14 (seletor "Entrar como"). Jurídico descartado até confirmação; Administração incluída.
export const USER_SEEDS: { id: string; name: string; email: string; role: Role }[] = [
  { id: 'larissa', name: 'Larissa Silva', email: 'larissa@exemplo.ace', role: 'GN' },
  { id: 'lara', name: 'Lara', email: 'lara@exemplo.ace', role: 'GN' },
  { id: 'clara', name: 'Clara', email: 'clara@exemplo.ace', role: 'GP' },
  { id: 'dp', name: 'Diretor de Projetos (exemplo)', email: 'dp@exemplo.ace', role: 'DP' },
  { id: 'dp2', name: 'Head de Projetos (exemplo)', email: 'dp2@exemplo.ace', role: 'DP' },
  { id: 'dir', name: 'Diretoria (exemplo)', email: 'dir@exemplo.ace', role: 'DIRETORIA' },
  { id: 'admin', name: 'Administração (exemplo)', email: 'admin@exemplo.ace', role: 'ADMIN' },
];
