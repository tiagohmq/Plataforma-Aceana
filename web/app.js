/* Adaptador do v14 para a API da Plataforma ACEANA.
 * As telas e o estado de interface (abas, transcrição, diagnóstico) continuam no v14.
 * Dados de negócio (propostas, versões, preço, margem, aprovações, contrato, integrações) vêm do servidor:
 * o front não calcula preço nem margem e não guarda parâmetros financeiros. */
(function () {
  'use strict';

  const RISK = ['CUSTO_EXTERNO', 'SISTEMA', 'RECORRENCIA', 'PROMESSA_RESULTADO']; // mesma ordem de FLAGS
  const CONTRACT_OK = ['APROVADO', 'ENVIADO_CLICKSIGN', 'ASSINADO_PARCIAL', 'ASSINADO_CLIENTE', 'ASSINADO'];
  const FORMURL = {}; // link do formulário por proposta (token de uso único)
  let RAW_PARAMS = null; // versão vigente dos parâmetros, como veio do servidor
  const enc = encodeURIComponent;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = x => (x ? new Date(x).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  async function call(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: Object.assign({ 'x-user-id': S.user }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.erro || 'Erro ' + r.status) + (j.detalhes ? ': ' + j.detalhes.join('; ') : ''));
    return j;
  }
  const API = { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}) };

  /* ---------- servidor → telas ---------- */
  function paramsToP(v, version) {
    return {
      v: version, imp: v.tax, hora: v.hourCost, hmd: v.plannedHoursPerMemberDay,
      cap: { hora: v.hourCost, hCons: v.hoursPerConsultantDay, hGer: v.hoursPerManagerDay, cap: v.productiveCapacity, ref: '' },
      venda: v.salesTime, back: v.backoffice, piso: v.floorPerMemberDay, verde: v.greenMin, amarelo: v.yellowMin,
      min: v.yellowMin, ext: v.externalCostAlert, valid: v.clientValidationDays, validade: v.proposalValidityDays,
    };
  }
  // Chave do v14 (tela de parâmetros) → chave do servidor
  const PKEY = { imp: 'tax', hora: 'hourCost', hmd: 'plannedHoursPerMemberDay', venda: 'salesTime', back: 'backoffice', piso: 'floorPerMemberDay', verde: 'greenMin', amarelo: 'yellowMin', min: 'yellowMin', ext: 'externalCostAlert', valid: 'clientValidationDays', validade: 'proposalValidityDays' };

  function formBack(d) {
    if (!d) return null;
    const masked = '•••';
    return {
      razao: d.razaoSocial, cnpj: d.cnpjCpf, endEmp: d.endereco + (d.cep ? ', CEP ' + d.cep : ''), cargo: masked,
      nome: d.representanteNome, nac: d.nacionalidade, civil: masked, prof: d.profissao, cpf: masked, rg: masked,
      orgao: masked, endRep: masked, emailAss: d.emailSignatario, emailFin: d.emailFinanceiro, diaParc: masked,
    };
  }

  function statusOf(f) {
    if (f.projectCreated) return 'Projeto criado';
    if (f.contract && /ASSINADO/.test(f.contract.status)) return 'Assinado';
    if (f.contract && f.contract.envelopeId) return 'Em assinatura';
    if (f.accepted && f.everSent) return 'Positiva';
    if (f.sent) return 'Proposta enviada';
    return { rec: 'Recusada', ok: 'Aprovada', req: 'Em aprovação' }[f.approval.status] || 'Rascunho';
  }

  function fromServer(sp, prev) {
    const v = sp.currentVersion, inp = v.input, f = sp.flow;
    const deal = DEALS.find(d => String(d.id) === String(sp.dealId)) || {};
    const sc = SC[inp.scope.solutionCode] || [];
    const byName = n => inp.scope.stages.find(s => s.name === n);
    const dOv = {};
    sc.forEach((m, i) => { const s = byName(m.n); if (s && s.days !== m.d) dOv[i] = s.days; });
    const ap = f.approval;
    const p = mk(Object.assign(
      prev ? { transcript: prev.transcript, dxOn: prev.dxOn, tab: prev.tab, view: prev.view, d2p: prev.d2p } : {},
      {
        code: sp.id, client: sp.org, contact: sp.contact, email: deal.email || '', sol: inp.scope.solutionCode,
        deal: sp.dealId, crm: deal.val || 0, owner: sp.ownerName,
        mods: sc.map(m => !!byName(m.n)), dOv,
        custom: inp.scope.extra.map(x => ({ n: x.name, ent: '—', d: x.days, e: ETAPAS[0], flags: x.risks.map(r => RISK.indexOf(r)).filter(i => i >= 0), validated: ap.status === 'ok' })),
        cons: (inp.scope.stages[0] || {}).consultants || 2,
        price: inp.presentedCents ? inp.presentedCents / 100 : null,
        custos: inp.externalCostsCents / 100,
        parcelas: v.result.installments || 1,
        ap: { st: ap.status, by: ap.by, at: fmt(ap.at), note: ap.note || '', who: ap.status === 'rec' ? ap.by : undefined, exc: ap.kind === 'EXCEPTION' ? 1 : 0, pv: P.v, cv: CAT_V },
        ver: v.number,
        sent: f.sent ? new Date(f.sentAt) : null,
        accepted: f.accepted,
        sold: inp.soldCents ? inp.soldCents / 100 : null,
        formSent: f.formSent,
        form: formBack(f.formData),
        cApproved: !!f.contract && CONTRACT_OK.includes(f.contract.status),
        sign: f.signatures,
        driveOk: f.driveOk,
        status: statusOf(f),
      }));
    p._srv = v; p._flow = f; p._contract = f.contract;
    return p;
  }

  /* ---------- carga ---------- */
  async function boot() {
    const b = await API.get('/api/ui/bootstrap');
    if (b.params) { RAW_PARAMS = b.params; P = paramsToP(b.params.values, b.params.version); }
    else { // perfil sem acesso à margem: não guarda parâmetros de outro usuário na tela
      RAW_PARAMS = null;
      P = { v: 0, imp: 0, hora: 0, hmd: 0, cap: { hora: 0, hCons: 0, hGer: 0, cap: 0, ref: '' }, venda: 0, back: 0, piso: 0, verde: 0, amarelo: 0, min: 0, ext: 0, valid: 0, validade: 0 };
    }
    const prev = new Map(PROPS.map(p => [p.code, p]));
    PROPS = b.proposals.map(sp => fromServer(sp, prev.get(sp.id)));
    const seen = new Set();
    RUNS = b.runs.filter(r => !seen.has(r.job_id) && seen.add(r.job_id)).map(r => ({
      id: r.job_id, t: fmt(r.created_at), sys: r.connector, op: r.event, code: r.proposalId || '—',
      st: r.status === 'done' || (r.ok && r.status !== 'failed') ? 'sucesso' : 'falha', err: r.error, tries: Math.max(1, r.attempts),
    }));
    AUD = b.audit.map(a => ({ t: fmt(a.at), u: a.who, a: a.action, c: a.ref, d: a.detail ? JSON.stringify(a.detail).replace(/[{}"]/g, '').slice(0, 80) : '' }));
    render();
  }
  function go(promise, okMsg) {
    return Promise.resolve(promise)
      .then(() => boot())
      .then(() => { if (okMsg) toast(okMsg); render(); })
      .catch(e => { toast(e.message); return boot().catch(() => {}).then(render); });
  }
  window.apiBoot = () => go(null);

  /* ---------- cálculo: só exibição do resultado do servidor ---------- */
  window.apiCalc = function (p) {
    const r = p._srv && p._srv.result, c = x => (x || 0) / 100;
    const empty = { V: 0, C: 0, D: days(p), M: p.cons + 1, imp: 0, caixa: 0, H: 0, rate: P.hora, opp: 0, contrib: 0, venda: 0, back: 0, total: 0, cp: 0, tp: 0, piso: 0, below: false, low: false, ext: false, exc: false, cust: false, sem: 'vermelho' };
    if (!r) return empty;
    const m = r.margins, inp = p._srv.input;
    const base = Object.assign({}, empty, { V: c(r.valueCents), C: c(inp.externalCostsCents), D: r.days, M: r.members, exc: r.requiresException, cust: r.riskyExtras.length > 0 && p.ap.st !== 'ok' });
    if (!m) return Object.assign(base, { sem: '—' }); // perfil sem acesso à margem
    return Object.assign(base, {
      imp: c(m.taxCents), caixa: c(m.cashCents), H: m.plannedHours, opp: c(m.hoursCostCents), contrib: c(m.contributionCents),
      venda: c(m.salesTimeCents), back: c(m.backofficeCents), total: c(m.totalResultCents),
      cp: m.contributionPct || 0, tp: m.totalResultPct || 0, piso: c(m.floorCents),
      below: m.alerts.includes('BELOW_FLOOR'), low: m.belowMinContribution, ext: m.alerts.includes('EXTERNAL_COST'), sem: m.light,
    });
  };
  window.apiSheetPrice = function (p) {
    const r = p._srv && p._srv.result;
    if (!r || !r.days) return null;
    const k = r.calculated;
    return { ref: 'parâmetros v' + P.v, min: k.minimumCents / 100, esp: k.expectedCents / 100, max: k.maxCents / 100, parcMax: r.maxInstallments };
  };

  /* ---------- telas → servidor ---------- */
  function toInput(p) {
    const cat = CATALOG.find(c => c[0] === p.sol) || [];
    const stages = sel(p).filter(m => !m.custom && m.d > 0).map(m => ({ name: m.n, days: m.d, consultants: p.cons }));
    const extra = (p.custom || []).map(x => ({ name: x.n, days: x.d, risks: x.flags.map(i => RISK[i]).filter(Boolean) }));
    const input = {
      scope: { solutionCode: p.sol, stages, extra }, managers: 1,
      externalCostsCents: Math.round((p.custos || 0) * 100),
      pricing: { complexity: Math.min(5, Math.max(1, cat[3] || 1)), size: 'ME', payment: 'BOLETO', channel: 'INBOUND', modality: 'PRESENCIAL', discount: 'NENHUM', outsourcing: 'NENHUMA' },
    };
    if (p.price) input.presentedCents = Math.round(p.price * 100);
    if (p.accepted && p.sold) input.soldCents = Math.round(p.sold * 100);
    const max = p._srv && p._srv.result.maxInstallments;
    input.installments = Math.max(1, max ? Math.min(p.parcelas || 1, max) : (p.parcelas || 1));
    return input;
  }
  function pushVersion(p) {
    const body = Object.assign(toInput(p), { expectedCurrentNumber: p.ver });
    return API.post('/api/proposals/' + enc(p.code) + '/versions', body);
  }

  // Edições de escopo e preço: a tela muda o estado local; o servidor cria a versão e recalcula.
  ['modToggle', 'modDays', 'cfAdd', 'cfDel', 'cons', 'priceSet', 'preset', 'useCalc', 'newVer'].forEach(name => {
    const orig = A[name];
    A[name] = (d, el) => {
      const p = PR(d.c);
      if (!p) return orig(d, el);
      const before = JSON.stringify(toInput(p));
      orig(d, el);
      const after = PR(d.c);
      if (after && (name === 'newVer' || JSON.stringify(toInput(after)) !== before)) go(pushVersion(after));
    };
  });

  // A versão 1 nasce com as etapas do catálogo; o v14 trabalha com as atividades do escopo padrão (SC).
  // Logo após importar, grava a versão 2 com esse escopo padrão para tela e servidor falarem das mesmas atividades.
  A.importDeal = d => {
    S.modal = false;
    go(API.post('/api/deals/' + enc(d.d) + '/import').then(async sp => {
      await boot(); // o retorno da importação não traz o estado de fluxo; o bootstrap traz
      const p = PR(sp.id);
      if (p && p.ver === 1 && SC[p.sol]) {
        p.mods = null; p.dOv = {}; p.custom = [];
        await pushVersion(p);
      }
      location.hash = '#proposta-' + sp.id;
    }), 'Proposta criada a partir do deal do Pipedrive.');
  };
  A.approveGn = d => go(API.post('/api/proposals/' + enc(d.c) + '/approvals', { versionNumber: PR(d.c).ver, decision: 'APROVADA' }), 'Preço aprovado.');
  A.reqExc = d => {
    const el = document.getElementById('just-' + d.c), t = el ? el.value.trim() : '';
    if (!t) return toast('Escreva a justificativa para pedir a exceção.');
    go(API.post('/api/proposals/' + enc(d.c) + '/exception-requests', { versionNumber: PR(d.c).ver, reason: t }), 'Pedido enviado à Diretoria de Projetos.');
  };
  A.approveExc = d => {
    const el = document.getElementById('cm-' + d.c), t = el ? el.value.trim() : '';
    go(API.post('/api/proposals/' + enc(d.c) + '/approvals', Object.assign({ versionNumber: PR(d.c).ver, decision: 'APROVADA' }, t ? { justification: t } : {})), 'Exceção aprovada.');
  };
  A.recuse = d => {
    const el = document.getElementById('cm-' + d.c), t = el ? el.value.trim() : '';
    if (!t) return toast('Escreva o motivo para recusar.');
    go(API.post('/api/proposals/' + enc(d.c) + '/approvals', { versionNumber: PR(d.c).ver, decision: 'RECUSADA', justification: t }), 'Exceção recusada.');
  };
  A.send = d => go(API.post('/api/proposals/' + enc(d.c) + '/send'), 'Proposta enviada. O Pipedrive é atualizado pela fila.');

  // Positiva: registra o valor vendido (nova versão). Dentro da regra, o clique do GN é a aprovação; fora dela, vai à exceção.
  A.accept = d => {
    const p = PR(d.c);
    if (!(p.sold > 0)) p.sold = p.price;
    p.accepted = true;
    go(pushVersion(p).then(sp => {
      const v = sp.currentVersion;
      return v.result.requiresException
        ? API.post('/api/proposals/' + enc(p.code) + '/exception-requests', { versionNumber: v.number, reason: 'Valor vendido fora da regra (abaixo do piso ou margem abaixo do mínimo).' })
        : API.post('/api/proposals/' + enc(p.code) + '/approvals', { versionNumber: v.number, decision: 'APROVADA' });
    }), 'Positiva registrada.');
  };

  function ensureForm(p) {
    if (FORMURL[p.code]) return Promise.resolve(FORMURL[p.code]);
    return API.post('/api/proposals/' + enc(p.code) + '/contract-form').then(r => (FORMURL[p.code] = r.url));
  }
  A.resend = d => { const p = PR(d.c); delete FORMURL[p.code]; go(ensureForm(p), 'Link de uso único gerado para ' + p.email + '.'); };
  const origOpenClient = A.openClient;
  A.openClient = d => { origOpenClient(d); const p = PR(d.c); ensureForm(p).catch(e => toast(e.message)); };
  A.cSubmit = () => {
    const p = PR(S.cliente), f = S.form[p.code] || {};
    if (filled(f) < 15) { S.showErr = true; return; }
    const cep = ((f.endEmp || '').match(/\d{5}-?\d{3}/) || [''])[0];
    const body = {
      razaoSocial: f.razao, cnpjCpf: f.cnpj, endereco: f.endEmp, cep, representanteNome: f.nome, nacionalidade: f.nac,
      profissao: f.prof, emailSignatario: f.emailAss, emailFinanceiro: f.emailFin, representanteCpf: f.cpf,
      representanteRg: f.rg, orgaoEmissor: f.orgao, estadoCivil: f.civil, enderecoRepresentante: f.endRep,
    };
    go(ensureForm(p).then(url => API.post('/api/forms/' + url.split('/').pop(), body)).then(() => { S.sub = true; S.showErr = false; delete FORMURL[p.code]; }), 'Dados enviados com segurança.');
  };

  function optionalLeftOut(p) { return (SC[p.sol] || []).filter((m, i) => !mods(p)[i]).map(m => m.n); }
  A.cApprove = d => {
    const p = PR(d.c);
    // Só reaproveita contrato que ainda aguarda aprovação e é da versão atual; senão gera um novo.
    const reuse = p._contract && p._contract.status === 'AGUARDANDO_APROVACAO' && p._contract.proposalVersionId === p._srv.id;
    const contract = reuse ? Promise.resolve(p._contract) : (() => {
      const reun = prompt('Número de reuniões previstas (Anexo II):', '6');
      if (!reun) return Promise.reject(new Error('Contrato não gerado: informe o número de reuniões.'));
      const excl = prompt('Exclusões do escopo (Anexo II), separadas por ";":', optionalLeftOut(p).join('; '));
      if (!excl) return Promise.reject(new Error('Contrato não gerado: informe as exclusões do escopo.'));
      return API.post('/api/proposals/' + enc(p.code) + '/contract', { reunioes: Number(reun), exclusoes: excl.split(';').map(s => s.trim()).filter(Boolean) });
    })();
    go(contract.then(c => API.post('/api/contracts/' + c.id + '/approvals', { decision: 'APROVADA' })), 'Contrato gerado, conferido com a proposta e o Pipedrive, e aprovado.');
  };
  // Upload no Clicksign é manual (decisão de 01/11): a pessoa sobe o PDF e informa o envelope.
  A.sendSign = d => {
    const p = PR(d.c);
    if (!p._contract) return toast('Gere e aprove o contrato antes.');
    const env = prompt('Suba o contrato no Clicksign e cole aqui o ID do envelope:', 'env-' + p.code);
    if (!env) return;
    p.tab = 'ass';
    go(API.post('/api/contracts/' + p._contract.id + '/envelope', { envelopeId: env }), 'Envelope registrado. As assinaturas chegam pelo webhook do Clicksign.');
  };
  // Demonstração: simula o retorno do Clicksign (DEMO_MODE=1 no servidor).
  A.signStep = d => {
    const p = PR(d.c);
    const signer = ['client', 'ace', 'witness'][p.sign] || 'witness';
    go(API.post('/api/demo/simulate-sign', { proposalId: p.code, signer }).then(() => sleep(1800)), 'Assinatura recebida do Clicksign.');
  };
  A.retry = d => go(API.post('/api/jobs/' + d.r + '/retry').then(() => sleep(1800)), 'Reprocessado.');
  A.simFail = d => {
    if (!['pipedrive', 'monday'].includes(d.s)) return toast('Simulação disponível para Pipedrive e Monday.');
    go(API.post('/api/demo/fail-next', { connector: d.s }), 'A próxima chamada ao ' + d.s + ' vai falhar. Reprocesse em Integrações.');
  };

  // Parâmetros: publicar cria versão nova no servidor (só Diretoria de Projetos).
  A.parm = (d, el) => {
    if (!RAW_PARAMS || !PKEY[d.k]) return;
    const pct = ['imp', 'venda', 'back', 'verde', 'amarelo', 'min', 'ext'].includes(d.k), v = num(el.value);
    const values = Object.assign({}, RAW_PARAMS.values, { [PKEY[d.k]]: pct ? v / 100 : v });
    go(API.post('/api/params', values), 'Nova versão de parâmetros publicada.');
  };
  A.capPublish = () => {
    if (!RAW_PARAMS || !S.capNew) return;
    const values = Object.assign({}, RAW_PARAMS.values, { productiveCapacity: S.capNew.cap });
    S.capNew = null;
    go(API.post('/api/params', values), 'Capacidade publicada como nova versão de parâmetros.');
  };

  const origUser = A.user;
  A.user = (d, el) => { origUser(d, el); go(null); };

  // Perfis: Jurídico descartado até confirmação; Administração existe no servidor.
  const jur = USERS.findIndex(u => u.id === 'jur');
  if (jur >= 0) USERS.splice(jur, 1, { id: 'admin', n: 'Administração (exemplo)', r: 'adm', l: 'Administração' });

  boot().catch(e => { toast('Não foi possível carregar os dados: ' + e.message); render(); });
})();
