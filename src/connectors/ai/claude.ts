import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { DiagnosisSchema } from '../../domain/ai-guard.ts';
import type { DiagnosisAI } from './interface.ts';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Você ajuda o gerente de negócios da A.C.E. Consultoria (empresa júnior) a estruturar o diagnóstico de um cliente a partir da transcrição da reunião.

Faça duas coisas:
1. Liste as dores, os objetivos e as restrições do cliente. Para cada item, copie em "trecho" um pedaço literal da transcrição que o comprova (copie exatamente, sem resumir). Se não houver trecho que comprove, não inclua o item.
2. Sugira as soluções do catálogo que atendem a esse diagnóstico, só com códigos da lista recebida, cada uma com o motivo e um trecho literal da transcrição.

Limites: você não define preço, valor, desconto, prazo, número de dias nem cláusula de contrato. Isso é decidido por pessoas na plataforma. Escreva em português do Brasil, com frases curtas.`;

/** Assistente de diagnóstico com Claude. Recebe um cliente pronto (testes injetam um falso). */
export function claudeDiagnosis(client: Anthropic = new Anthropic()): DiagnosisAI {
  return async input => {
    const catalog = input.catalog.map(c => `${c.code} | ${c.name} | ${c.front}`).join('\n');
    const content = [
      `Catálogo de soluções (código | nome | frente):\n${catalog}`,
      input.preAudit ? `Pré-auditoria registrada no Pipedrive:\n${input.preAudit}` : '',
      `Transcrição da reunião de diagnóstico:\n${input.transcript}`,
    ].filter(Boolean).join('\n\n');

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Se o modelo recusar por regra de segurança, a API tenta de novo com outro modelo na mesma chamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(DiagnosisSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    } as never) as unknown as { stop_reason: string; model?: string; content: { type: string; text?: string }[] };

    if (response.stop_reason === 'refusal') throw new Error('A IA recusou analisar esta transcrição. Preencha o diagnóstico manualmente.');
    if (response.stop_reason === 'max_tokens') throw new Error('A resposta da IA ficou incompleta. Tente de novo com uma transcrição menor.');
    const text = response.content.find(b => b.type === 'text')?.text;
    if (!text) throw new Error('A IA não devolveu o diagnóstico.');
    return { model: response.model ?? MODEL, output: JSON.parse(text) };
  };
}
