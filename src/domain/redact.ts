// Remove dados pessoais antes de qualquer texto sair para a IA (M10: a IA nunca recebe CPF/RG).
// A ordem importa: CNPJ antes de CPF, CPF antes de telefone.
const RULES: RegExp[] = [
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, // CNPJ
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b(?:RG|R\.G\.|identidade)\s*(?:n[º°o.]?\s*)?[:\-]?\s*[\dxX][\dxX.\-]{4,13}/gi, // RG com rótulo
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
  /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, // telefone
];

export function redactPersonalData(text: string): string {
  return RULES.reduce((t, re) => t.replace(re, m => (/^(RG|R\.G\.|identidade)/i.test(m) ? m.split(/[\s:\-]/)[0] + ' [removido]' : '[removido]')), text);
}
