import { it, expect } from 'vitest';
import { can, type Role, type Capability } from '../../src/domain/permissions.ts';

// Matriz da spec §9 ("leitura" do DP/Diretoria em montar proposta = não edita).
const M: Record<Capability, Role[]> = {
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
const ROLES: Role[] = ['GN', 'GP', 'DP', 'DIRETORIA', 'ADMIN'];

it.each(Object.entries(M).flatMap(([cap, ok]) => ROLES.map(r => [cap, r, ok.includes(r)] as const)))(
  '%s para %s = %s', (cap, role, expected) => {
    expect(can(role, cap as Capability)).toBe(expected);
  });
