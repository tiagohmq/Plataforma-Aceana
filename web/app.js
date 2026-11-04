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
    if (inp.source === 'planilha') {
      p._sc = inp.scope.stages.map(x => ({ e: x.group || 'Escopo', n: x.name, d: x.days, ent: x.notes || '—' }));
      p.mods = p._sc.map(() => true); p.dOv = {};
      p.cons = inp.scope.stages.reduce((m, x) => Math.max(m, x.consultants), 1);
      SC[p.sol] = p._sc;
    }
    p._srv = v; p._flow = f; p._contract = f.contract;
    return p;
  }

  /* ---------- carga ---------- */
  async function boot() {
    const b = await API.get('/api/ui/bootstrap');
    CAT = (b.catalog && b.catalog.solutions) || [];
    CAT.forEach(c => ensureSC(c.code));
    if (b.me && b.me.role === 'GN') await loadDeals(); // lista de negócios do Pipedrive: só quem monta proposta
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
    if (p._sc) SC[p.sol] = p._sc; // escopo importado é desta proposta, não da solução
    const cat = CATALOG.find(c => c[0] === p.sol) || [];
    const stages = sel(p).filter(m => !m.custom && m.d > 0).map(m => Object.assign({ name: m.n, days: m.d, consultants: p.cons }, p._sc ? { group: m.e, ...(m.ent && m.ent !== '—' ? { notes: m.ent } : {}) } : {}));
    const extra = (p.custom || []).map(x => ({ name: x.n, days: x.d, risks: x.flags.map(i => RISK[i]).filter(Boolean) }));
    const input = {
      scope: { solutionCode: p.sol, stages, extra }, managers: 1,
      externalCostsCents: Math.round((p.custos || 0) * 100),
      pricing: { complexity: Math.min(5, Math.max(1, cat[3] || 1)), size: 'ME', payment: 'BOLETO', channel: 'INBOUND', modality: 'PRESENCIAL', discount: 'NENHUM', outsourcing: 'NENHUMA' },
    };
    if (p._srv && p._srv.input.source) input.source = p._srv.input.source;
    if (p._srv && p._srv.input.pricing) input.pricing = Object.assign({}, p._srv.input.pricing, { complexity: input.pricing.complexity });
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

  /* ---------- Pipedrive real e diagnóstico por transcrição ---------- */
  let CAT = []; // soluções do catálogo vigente (servidor), com etapas e dias
  const DXCACHE = {}; // última análise por proposta: undefined = não buscada, null = nenhuma
  const DXDRAFT = {}; // texto colado ainda não analisado
  const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // Soluções sem atividades padrão no v14 usam as etapas do catálogo do servidor (ou as quatro etapas, a preencher).
  function ensureSC(code) {
    if (!code || SC[code]) return;
    const s = CAT.find(c => c.code === code);
    const st = s && s.stages.length ? s.stages : [{ name: 'Start' }, { name: 'Imersão' }, { name: 'Ideação' }, { name: 'Acompanhamento' }];
    SC[code] = st.map(x => ({ e: x.name, n: x.name, d: x.days || 0, ent: '—' }));
  }
  const solFromServices = services => {
    const hit = CAT.find(c => (services || []).some(sv => normTxt(sv) === normTxt(c.name)));
    return hit ? hit.code : '';
  };

  async function loadDeals() {
    try {
      const deals = await API.get('/api/pipedrive/deals');
      DEALS.splice(0, DEALS.length, ...deals.map(d => ({
        id: d.id, client: d.org, contact: d.contact, email: d.contactEmail || '', val: (d.value || 0) / 100,
        sol: solFromServices(d.services), services: d.services || [], pipeline: d.pipeline || '', preAudit: (d.details && d.details.preAudit) || '',
      })));
    } catch (e) { toast('Pipedrive indisponível: ' + e.message); }
  }

  window.vNewModal = function () {
    const open = DEALS.filter(d => !PROPS.some(p => String(p.deal) === String(d.id)));
    const row = d => `<div class="mod"><div class="b"><h3>${esc(d.client)}</h3>
      <p class="small muted">Deal #${esc(d.id)}${d.pipeline ? ' · ' + esc(d.pipeline) : ''} · ${esc(d.contact || 'sem contato')}${d.val ? ' · ' + BRL(d.val) : ''}</p>
      <p class="small">${d.services && d.services.length ? 'Serviço: ' + esc(d.services.join(', ')) : '<span class="muted">Serviço ainda não informado no Pipedrive (a análise da transcrição sugere)</span>'}</p>
      ${d.preAudit ? `<p class="quote">${esc(d.preAudit.slice(0, 220))}${d.preAudit.length > 220 ? '…' : ''}</p>` : ''}</div>
      <button class="btn p" data-a="importDeal" data-d="${esc(d.id)}">Importar</button></div>`;
    return `<div class="modal" data-a="newClose"><div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Nova proposta</h2><button class="btn q" data-a="newClose">Fechar</button></div>
      <p class="small muted" style="margin:6px 0 14px">Negócios em "Diagnóstico realizado" no Pipedrive, ainda sem proposta (${open.length}). A plataforma só lê o Pipedrive: nada é alterado lá.</p>
      ${open.map(row).join('') || '<p class="muted">Nenhum negócio novo em Diagnóstico realizado.</p>'}</div></div>`;
  };

  function loadDx(p) {
    if (DXCACHE[p.code] !== undefined) return;
    DXCACHE[p.code] = null;
    API.get('/api/proposals/' + enc(p.code) + '/diagnosis').then(d => { DXCACHE[p.code] = d; render(); }).catch(() => {});
  }
  const TIPO = { DOR: ['Dor', 'bad'], OBJETIVO: ['Objetivo', 'ok'], RESTRICAO: ['Restrição', 'warn'] };

  window.vDx = function (p) {
    const ed = can('Criar e editar'), busy = S.dxBusy === p.code;
    loadDx(p);
    const dx = DXCACHE[p.code];
    const form = `<div class="card"><h2>Transcrição da reunião de diagnóstico</h2>
      <p class="small muted" style="margin:4px 0 12px">Cole a transcrição da reunião. A plataforma remove CPF, RG, CNPJ, e-mails e telefones antes de analisar. A análise só sugere soluções do catálogo, sempre com o trecho de origem, e nunca define preço, desconto ou prazo. Quem decide é você.</p>
      <textarea id="dx-${esc(p.code)}" class="inp" rows="10" data-chg="dxDraft" data-c="${esc(p.code)}" placeholder="Consultor: Como funciona hoje?&#10;Cliente: ..." ${ed && !busy ? '' : 'disabled'} style="min-height:200px">${esc(DXDRAFT[p.code] || '')}</textarea>
      <div class="row" style="margin-top:12px"><button class="btn y" data-a="dxAnalyze" data-c="${esc(p.code)}" ${ed && !busy ? '' : 'disabled'}>${busy ? 'Analisando a transcrição…' : (dx ? 'Analisar de novo' : 'Analisar transcrição')}</button>${busy ? '<span class="small muted">Pode levar até um minuto.</span>' : ''}</div></div>`;
    let res = '';
    if (dx) {
      res = `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">O que a análise encontrou</h2><span class="chip info">${dx.itens.length} itens · ${dx.solucoes.length} soluções</span></div>
        ${dx.resumo ? `<p style="margin:10px 0 4px">${esc(dx.resumo)}</p>` : ''}
        ${dx.itens.map(it => `<div class="mod"><div class="b"><div class="row"><span class="chip ${TIPO[it.tipo][1]}">${TIPO[it.tipo][0]}</span></div><h3>${esc(it.texto)}</h3><p class="quote">${esc(it.trecho)}</p></div></div>`).join('') || '<p class="muted" style="margin-top:10px">Nenhum item com trecho de origem.</p>'}</div>
        <div class="card"><h2>Soluções sugeridas do catálogo</h2><p class="small muted" style="margin:4px 0 12px">Escolha uma para montar o escopo em rascunho. Você revisa dias, equipe e preço depois.</p>
        ${dx.solucoes.map(s => `<div class="mod"><div class="b"><div class="row"><span class="chip">${esc(s.codigo)}</span>${p.sol === s.codigo ? '<span class="chip ok">No escopo</span>' : ''}</div><h3>${esc(s.nome)}</h3><p class="small">${esc(s.motivo)}</p><p class="quote">${esc(s.trecho)}</p></div>
          <button class="btn ${p.sol === s.codigo ? 'q' : 'p'}" data-a="dxUseSol" data-c="${esc(p.code)}" data-s="${esc(s.codigo)}" ${ed ? '' : 'disabled'}>${p.sol === s.codigo ? 'Remontar escopo' : 'Usar esta solução'}</button></div>`).join('') || '<p class="muted">Nenhuma solução do catálogo foi sugerida.</p>'}
        ${dx.descartados.length ? `<p class="small muted" style="margin-top:12px">Descartados pela trava (${dx.descartados.length}): ${dx.descartados.map(x => esc(x.texto) + ' — ' + esc(x.motivo)).join('; ')}</p>` : ''}
        <p class="small muted" style="margin-top:8px">Análise: ${esc(dx.model)} · ${fmt(dx.createdAt)}</p></div>`;
    }
    return `<div class="cols"><div class="m stack">${form}${res}</div><div class="s">${pdSide(p)}${aiBox}</div></div>`;
  };

  A.dxDraft = (d, el) => { DXDRAFT[d.c] = el.value; A._skip = 1; };
  A.dxAnalyze = d => {
    const el = document.getElementById('dx-' + d.c), t = el ? el.value : (DXDRAFT[d.c] || '');
    DXDRAFT[d.c] = t;
    if (t.trim().length < 20) return toast('Cole a transcrição da reunião antes de analisar.');
    S.dxBusy = d.c;
    API.post('/api/proposals/' + enc(d.c) + '/diagnosis', { transcript: t })
      .then(r => { DXCACHE[d.c] = r; S.dxBusy = null; toast('Diagnóstico estruturado. Confira os trechos e escolha a solução.'); render(); })
      .catch(e => { S.dxBusy = null; toast(e.message); render(); });
  };
  A.dxUseSol = d => {
    const p = PR(d.c);
    if (p.sent) return toast('Proposta já enviada. Crie uma nova versão para mudar o escopo.');
    ensureSC(d.s);
    p.sol = d.s; p.mods = null; p.dOv = {}; p.custom = []; p.tab = 'esc';
    const nome = (CAT.find(c => c.code === d.s) || {}).name || d.s;
    go(pushVersion(p), 'Escopo montado com ' + nome + '. Revise os dias, a equipe e o preço.');
  };

  /* ---------- Escopo da planilha do assistente e proposta pronta (PDF ou Canva) ---------- */
  const SHEETINFO = {}; // último resultado de importação por proposta (avisos, preço da planilha)
  const fileB64 = file => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => fail(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(file);
  });

  // Mantém o escopo importado da proposta aberta (SC é por solução no v14; a planilha é por proposta).
  const origWs = vWs;
  vWs = function (p) { if (p._sc) SC[p.sol] = p._sc; return origWs(p); };

  function sheetCard(p) {
    const ed = can('Criar e editar'), info = SHEETINFO[p.code], fromSheet = p._srv && p._srv.input.source === 'planilha';
    const groups = fromSheet ? [...new Set(p._sc.map(x => x.e))].map(g => ({ g, acts: p._sc.filter(x => x.e === g) })) : [];
    return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Escopo da planilha do assistente</h2>${fromSheet ? '<span class="chip ok">Importado da planilha</span>' : ''}</div>
      <p class="small muted" style="margin:4px 0 12px">No Google Sheets: Arquivo → Fazer download → Microsoft Excel (.xlsx). A plataforma lê solução, etapas, atividades, dias, equipe, custos e multiplicadores. O preço é calculado aqui, não na planilha.</p>
      <div class="row"><input type="file" accept=".xlsx" id="xlsx-${esc(p.code)}" ${ed && !p.sent ? '' : 'disabled'}><button class="btn y" data-a="sheetImport" data-c="${esc(p.code)}" ${ed && !p.sent ? '' : 'disabled'}>${S.sheetBusy === p.code ? 'Importando…' : 'Importar escopo'}</button></div>
      ${p.sent ? '<p class="small muted" style="margin-top:8px">Proposta já enviada: crie uma nova versão para importar outro escopo.</p>' : ''}
      ${info ? `<div class="stack" style="gap:6px;margin-top:12px">${info.sheetPriceCents ? `<p class="small">Preço que a planilha mostrava: ${BRL(info.sheetPriceCents / 100)} (só referência; não entra no cálculo).</p>` : ''}${info.warnings.map(w => `<div class="banner warn small">${esc(w)}</div>`).join('')}</div>` : ''}
      ${groups.map(x => `<div style="margin-top:14px"><h3>${esc(x.g)} · ${x.acts.reduce((t, a) => t + a.d, 0)} dias</h3>${x.acts.map(a => `<div class="mod"><div class="b"><div class="row" style="justify-content:space-between"><b>${esc(a.n)}</b><span class="chip">${a.d} d</span></div>${a.ent && a.ent !== '—' ? `<p class="small muted">Pronto quando: ${esc(a.ent)}</p>` : ''}</div></div>`).join('')}</div>`).join('')}</div>`;
  }
  const origEsc = vEsc;
  vEsc = function (p) { return `<div class="stack" style="margin-bottom:20px">${sheetCard(p)}</div>` + origEsc(p); };

  A.sheetImport = d => {
    const p = PR(d.c), el = document.getElementById('xlsx-' + d.c), file = el && el.files && el.files[0];
    if (!file) return toast('Escolha o arquivo .xlsx da planilha.');
    S.sheetBusy = d.c;
    fileB64(file)
      .then(b64 => API.post('/api/proposals/' + enc(d.c) + '/import-spreadsheet', { fileBase64: b64, expectedCurrentNumber: p.ver }))
      .then(r => { SHEETINFO[d.c] = { warnings: r.warnings, sheetPriceCents: r.sheetPriceCents }; delete DXCACHE[d.c]; S.sheetBusy = null; return boot(); })
      .then(() => toast('Escopo importado da planilha. Confira os avisos, os dias e o preço.'))
      .catch(e => { S.sheetBusy = null; toast(e.message); render(); });
  };

  function attachCard(p) {
    const ed = can('Criar e editar'), att = p._flow && p._flow.attachment, approved = p.ap && p.ap.st === 'ok';
    const ok = b => (b === null ? '<span class="chip">não lido</span>' : b ? '<span class="chip ok">confere</span>' : '<span class="chip bad">não confere</span>');
    const cur = att ? `<div class="banner ${att.confirmedBy ? 'warn' : 'ok'}" style="margin-top:10px">Anexado: ${att.kind === 'PDF' ? esc(att.filename || 'PDF') : `<a href="${esc(att.url)}" target="_blank" rel="noopener">link do Canva</a>`} · ${fmt(att.createdAt)}${att.confirmedBy ? ` · conferido manualmente por ${esc(att.confirmedBy)}` : ''}</div>
      <dl class="kv" style="margin-top:10px"><dt>Valor ${esc(att.checks.expected.value)}</dt><dd>${ok(att.checks.valueFound)}</dd><dt>${att.checks.expected.installments}x de ${esc(att.checks.expected.installment)}</dt><dd>${ok(att.checks.installmentsFound)}</dd><dt>Sem margem para o cliente</dt><dd>${att.checks.mentionsMargin === null ? '<span class="chip">não lido</span>' : att.checks.mentionsMargin ? '<span class="chip bad">menciona margem</span>' : '<span class="chip ok">ok</span>'}</dd></dl>` : '';
    return `<div class="card"><h2>Proposta pronta (PDF ou Canva)</h2>
      <p class="small muted" style="margin:4px 0 12px">A proposta montada pelo assistente com o design system. Ela fica presa a esta versão aprovada; se o preço ou o escopo mudar, é preciso anexar de novo. Dê ao assistente o valor e as parcelas aprovados aqui.</p>
      ${approved ? `<div class="row"><input type="file" accept="application/pdf,.pdf" id="pdf-${esc(p.code)}" ${ed ? '' : 'disabled'}><button class="btn y" data-a="attachPdf" data-c="${esc(p.code)}" ${ed ? '' : 'disabled'}>Anexar PDF</button></div>
      <div class="row" style="margin-top:10px"><input class="inp" style="flex:1;min-width:220px" id="canva-${esc(p.code)}" placeholder="https://www.canva.com/design/..." ${ed ? '' : 'disabled'}><button class="btn" data-a="attachLink" data-c="${esc(p.code)}" ${ed ? '' : 'disabled'}>Anexar link do Canva</button></div>`
        : '<div class="banner info">Aprove o preço desta versão antes de anexar a proposta.</div>'}
      ${cur}</div>`;
  }
  const origProp = vProp;
  vProp = function (p) { return `<div class="stack" style="margin-bottom:20px">${attachCard(p)}</div>` + origProp(p); };

  // Conferência pendente: mostra o motivo e pede confirmação explícita, que fica registrada no nome do GN.
  function sendAttachment(code, payload) {
    return API.post('/api/proposals/' + enc(code) + '/attachment', payload).catch(e => {
      if (!/Confira antes de anexar/.test(e.message)) throw e;
      if (!window.confirm(e.message + '\n\nConfirmar e anexar mesmo assim?')) throw new Error('Anexo cancelado.');
      return API.post('/api/proposals/' + enc(code) + '/attachment', Object.assign({}, payload, { confirmed: true }));
    });
  }
  A.attachPdf = d => {
    const el = document.getElementById('pdf-' + d.c), file = el && el.files && el.files[0];
    if (!file) return toast('Escolha o PDF da proposta.');
    go(fileB64(file).then(b64 => sendAttachment(d.c, { kind: 'PDF', filename: file.name, fileBase64: b64 })), 'Proposta em PDF anexada a esta versão.');
  };
  A.attachLink = d => {
    const el = document.getElementById('canva-' + d.c), url = el ? el.value.trim() : '';
    if (!url) return toast('Cole o link do Canva.');
    go(sendAttachment(d.c, { kind: 'LINK', url }), 'Link do Canva anexado a esta versão.');
  };

  const origUser = A.user;
  A.user = (d, el) => { origUser(d, el); go(null); };

  // Perfis: Jurídico descartado até confirmação; Administração existe no servidor.
  const jur = USERS.findIndex(u => u.id === 'jur');
  if (jur >= 0) USERS.splice(jur, 1, { id: 'admin', n: 'Administração (exemplo)', r: 'adm', l: 'Administração' });

  boot().catch(e => { toast('Não foi possível carregar os dados: ' + e.message); render(); });
})();
