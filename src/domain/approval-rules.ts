import { can, type Role } from './permissions.ts';

export type ApprovalKind = 'PRICE' | 'EXCEPTION';

/** Exceção quando o preço fica abaixo do piso, a contribuição abaixo de 30% ou há atividade fora do catálogo com risco. */
export const approvalNeeded = (v: { requiresException: boolean }): ApprovalKind =>
  v.requiresException ? 'EXCEPTION' : 'PRICE';

/** Dentro da regra: GN ou DP. Exceção: só DP ou Diretoria, e quem pediu não aprova. */
export function canApprove(user: { id: string; role: Role }, kind: ApprovalKind, requestedBy: string | null): boolean {
  if (kind === 'PRICE') return can(user.role, 'price.approve');
  return can(user.role, 'exception.approve') && user.id !== requestedBy;
}
