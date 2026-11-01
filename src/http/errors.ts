/** Regra de negócio violada → 409 {erro, codigo}. */
export class BusinessError extends Error {
  constructor(public codigo: string, mensagem: string) { super(mensagem); }
}
export class ForbiddenError extends Error {
  constructor(mensagem = 'Seu perfil não tem permissão para esta ação.') { super(mensagem); }
}
export class NotFoundError extends Error {
  constructor(mensagem = 'Não encontrado.') { super(mensagem); }
}
/** Link usado ou expirado → 410. */
export class GoneError extends Error {
  constructor(mensagem = 'Este link já foi usado ou expirou.') { super(mensagem); }
}
export class UnauthorizedError extends Error {
  constructor(mensagem = 'Usuário não identificado.') { super(mensagem); }
}
