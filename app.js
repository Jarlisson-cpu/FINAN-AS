'use strict';

/* ================= utilidades ================= */
const STORAGE_KEY = 'minhas-financas.v1';
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round(n * 100) / 100;
const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const curMonth = () => todayISO().slice(0, 7);
const monthKey = iso => iso.slice(0, 7);
const dateBR = iso => iso ? iso.split('-').reverse().join('/') : '';
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthLabel = ym => `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const shortMonth = ym => `${MONTHS[+ym.slice(5) - 1].slice(0, 3)}/${ym.slice(2, 4)}`;

function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
function clampDay(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(day, new Date(y, m, 0).getDate()))}`;
}
const lastDay = ym => clampDay(ym, 31);
function monthsBetween(fromYm, toYm) {
  const [y1, m1] = fromYm.split('-').map(Number), [y2, m2] = toYm.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
// aceita "1.234,56", "1234,56" e "1234.56"
function parseNum(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}

const TYPE_LABEL = { expense: 'Despesa', income: 'Receita', transfer: 'Transferência' };
const ACC_TYPES = { cash: 'Dinheiro', bank: 'Conta bancária', savings: 'Poupança', invest: 'Investimentos', credit: 'Cartão de crédito' };
const EMOJIS = ['🏠', '🍽️', '🛒', '🚗', '⛽', '🩺', '💊', '📚', '🎉', '📺', '🛍️', '💡', '📱', '✈️', '🐶', '👶', '🎁', '💼', '📈', '💰', '🏋️', '☕', '🍺', '🧾', '📦', '🔧'];

/* ================= estado ================= */
function defaultState() {
  const c = (name, type, icon, color) => ({ id: uid(), name, type, icon, color });
  return {
    version: 1,
    accounts: [
      { id: uid(), name: 'Carteira', type: 'cash', initial: 0, color: '#16a34a' },
      { id: uid(), name: 'Conta corrente', type: 'bank', initial: 0, color: '#2563eb' },
    ],
    categories: [
      c('Salário', 'income', '💼', '#16a34a'), c('Freelance', 'income', '🧑‍💻', '#0d9488'),
      c('Rendimentos', 'income', '📈', '#65a30d'), c('Outras receitas', 'income', '➕', '#0891b2'),
      c('Moradia', 'expense', '🏠', '#2563eb'), c('Alimentação', 'expense', '🍽️', '#ea580c'),
      c('Mercado', 'expense', '🛒', '#d97706'), c('Transporte', 'expense', '🚗', '#7c3aed'),
      c('Saúde', 'expense', '🩺', '#dc2626'), c('Educação', 'expense', '📚', '#0891b2'),
      c('Lazer', 'expense', '🎉', '#db2777'), c('Assinaturas', 'expense', '📺', '#9333ea'),
      c('Compras', 'expense', '🛍️', '#c026d3'), c('Contas e serviços', 'expense', '💡', '#ca8a04'),
      c('Outros', 'expense', '📦', '#64748b'),
    ],
    transactions: [],
    budgets: {},     // { categoryId: limite mensal }
    goals: [],
    recurring: [],
    settings: { theme: 'auto' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.warn('Falha ao ler dados salvos', e); }
  return defaultState();
}
function normalize(s) {
  const d = defaultState();
  return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }
  catch (e) { toast('⚠️ Não foi possível salvar no navegador'); }
}

let S = load();
const ui = { view: location.hash.slice(1) || 'dashboard', month: curMonth(), f: { type: '', cat: '', acc: '', status: '', q: '' } };

const byId = (list, id) => list.find(x => x.id === id);
const cat = id => byId(S.categories, id);
const acc = id => byId(S.accounts, id);

/* ================= cálculos ================= */
// saldo da conta; por padrão só lançamentos efetivados (pagos/recebidos)
function accountBalance(accId, { upTo, pending = false } = {}) {
  const a = acc(accId);
  let b = a ? +a.initial || 0 : 0;
  for (const t of S.transactions) {
    if (!t.paid && !pending) continue;
    if (upTo && t.date > upTo) continue;
    if (t.type === 'income' && t.accountId === accId) b += t.amount;
    else if (t.type === 'expense' && t.accountId === accId) b -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === accId) b -= t.amount;
      if (t.toAccountId === accId) b += t.amount;
    }
  }
  return round2(b);
}
const totalBalance = opts => round2(S.accounts.reduce((s, a) => s + accountBalance(a.id, opts), 0));
const monthTx = ym => S.transactions.filter(t => monthKey(t.date) === ym);

function summary(ym) {
  const r = { inc: 0, exp: 0, pendInc: 0, pendExp: 0 };
  for (const t of monthTx(ym)) {
    if (t.type === 'income') { r.inc += t.amount; if (!t.paid) r.pendInc += t.amount; }
    else if (t.type === 'expense') { r.exp += t.amount; if (!t.paid) r.pendExp += t.amount; }
  }
  for (const k in r) r[k] = round2(r[k]);
  r.net = round2(r.inc - r.exp);
  return r;
}

function totalsByCategory(txs, type = 'expense') {
  const map = new Map();
  for (const t of txs) {
    if (t.type !== type) continue;
    map.set(t.categoryId || '', (map.get(t.categoryId || '') || 0) + t.amount);
  }
  return [...map].map(([id, value]) => {
    const c = cat(id);
    return { id, label: c ? c.name : 'Sem categoria', icon: c ? c.icon : '❔', color: c ? c.color : '#94a3b8', value: round2(value) };
  }).sort((a, b) => b.value - a.value);
}

const spentIn = (catId, ym) => round2(monthTx(ym).filter(t => t.type === 'expense' && t.categoryId === catId).reduce((s, t) => s + t.amount, 0));

// cria os lançamentos das contas fixas até o mês atual
function generateRecurring() {
  const cur = curMonth();
  let n = 0;
  for (const r of S.recurring) {
    if (!r.active) continue;
    let m = addMonths(r.lastGenerated || addMonths(r.startMonth, -1), 1);
    if (m < r.startMonth) m = r.startMonth;
    while (m <= cur) {
      S.transactions.push({
        id: uid(), type: r.type, amount: r.amount, date: clampDay(m, r.day), desc: r.desc,
        categoryId: r.categoryId, accountId: r.accountId, toAccountId: '', paid: false, recurringId: r.id,
      });
      r.lastGenerated = m;
      m = addMonths(m, 1);
      n++;
    }
  }
  if (n) save();
  return n;
}

/* ================= gráficos (SVG) ================= */
function donut(items, size = 170) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = 62, C = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map(i => {
    const len = total ? (i.value / total) * C : 0;
    const s = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${i.color}" stroke-width="22"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"><title>${esc(i.label)}: ${brl(i.value)}</title></circle>`;
    off += len;
    return s;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 160 160" role="img" aria-label="Gráfico por categoria">
    <circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--surface-2)" stroke-width="22"/>
    <g transform="rotate(-90 80 80)">${segs}</g>
    <text x="80" y="76" text-anchor="middle" style="font-size:10px">Total</text>
    <text x="80" y="93" text-anchor="middle" style="font-size:13px;font-weight:700;fill:var(--text)">${esc(brl(total))}</text>
  </svg>`;
}

function barChart(rows) {
  const W = 640, H = 230, P = { t: 12, r: 8, b: 26, l: 8 };
  const max = Math.max(1, ...rows.flatMap(r => [r.inc, r.exp]));
  const gw = (W - P.l - P.r) / rows.length, bw = Math.min(22, gw / 3.2), ch = H - P.t - P.b;
  const bars = rows.map((r, i) => {
    const x = P.l + i * gw + gw / 2;
    const hi = (r.inc / max) * ch, he = (r.exp / max) * ch;
    return `<rect x="${x - bw - 2}" y="${P.t + ch - hi}" width="${bw}" height="${hi}" rx="4" fill="var(--inc)"><title>${r.label} — Receitas: ${brl(r.inc)}</title></rect>
      <rect x="${x + 2}" y="${P.t + ch - he}" width="${bw}" height="${he}" rx="4" fill="var(--exp)"><title>${r.label} — Despesas: ${brl(r.exp)}</title></rect>
      <text x="${x}" y="${H - 8}" text-anchor="middle">${r.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Receitas e despesas por mês">
    <line x1="${P.l}" x2="${W - P.r}" y1="${P.t + ch}" y2="${P.t + ch}" stroke="var(--border)"/>${bars}</svg>
    <div class="chart-legend"><span><i style="background:var(--inc)"></i>Receitas</span><span><i style="background:var(--exp)"></i>Despesas</span></div>`;
}

function legend(items) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return `<div class="legend">${items.map(i => `<div style="--c:${i.color}"><i></i><span>${i.icon} ${esc(i.label)}</span>
    <span class="muted sm">${Math.round(i.value / total * 100)}%</span><strong class="sm">${brl(i.value)}</strong></div>`).join('')}</div>`;
}

const progressBar = pct => `<div class="bar"><span class="${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}" style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>`;
const empty = (msg, action, label) => `<div class="empty"><p>${msg}</p>${action ? `<button class="btn primary" data-action="${action}">${label}</button>` : ''}</div>`;
const pageHead = (title, actions = '') => `<div class="page-head"><h1>${title}</h1><div class="actions">${actions}</div></div>`;

/* ================= telas ================= */
function viewDashboard() {
  const ym = ui.month, s = summary(ym);
  const byCat = totalsByCategory(monthTx(ym));
  const last6 = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5)).map(m => ({ label: shortMonth(m), ...summary(m) }));
  const pending = S.transactions.filter(t => !t.paid && t.type !== 'transfer' && t.date <= lastDay(ym))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  const budgets = budgetRows(ym).sort((a, b) => b.spent / b.limit - a.spent / a.limit).slice(0, 5);
  const today = todayISO();
  const projected = totalBalance({ upTo: lastDay(ym), pending: true });

  return `
  <div class="grid kpis">
    <div class="card kpi"><span class="kpi-label">💳 Saldo atual em contas</span><strong class="kpi-value ${totalBalance() < 0 ? 'neg' : ''}">${brl(totalBalance())}</strong><small>Previsto no fim do mês: ${brl(projected)}</small></div>
    <div class="card kpi"><span class="kpi-label">⬆️ Receitas do mês</span><strong class="kpi-value inc">${brl(s.inc)}</strong><small>${s.pendInc ? `${brl(s.pendInc)} a receber` : 'Tudo recebido'}</small></div>
    <div class="card kpi"><span class="kpi-label">⬇️ Despesas do mês</span><strong class="kpi-value exp">${brl(s.exp)}</strong><small>${s.pendExp ? `${brl(s.pendExp)} a pagar` : 'Tudo pago'}</small></div>
    <div class="card kpi"><span class="kpi-label">⚖️ Resultado do mês</span><strong class="kpi-value ${s.net < 0 ? 'neg' : 'pos'}">${brl(s.net)}</strong><small>${s.inc ? `Você ${s.net >= 0 ? 'poupou' : 'excedeu'} ${Math.abs(Math.round(s.net / s.inc * 100))}% da renda` : '—'}</small></div>
  </div>

  <div class="grid cols-2">
    <div class="stack">
      <div class="card"><div class="card-head"><h3>Despesas por categoria</h3></div>
        ${byCat.length ? `<div class="donut-wrap">${donut(byCat)}${legend(byCat.slice(0, 7))}</div>` : empty('Nenhuma despesa neste mês.', 'newTx', '+ Lançar despesa')}
      </div>
      <div class="card"><div class="card-head"><h3>Últimos 6 meses</h3></div>${barChart(last6)}</div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-head"><h3>Contas a pagar e receber</h3><button class="link" data-action="goPending">Ver todas</button></div>
        ${pending.length ? `<div class="list">${pending.map(t => {
          const c = cat(t.categoryId);
          const late = t.date < today;
          return `<div class="list-item"><div class="ico" style="--c:${c?.color || '#64748b'}">${c?.icon || '❔'}</div>
            <div class="grow"><div class="desc">${esc(t.desc || c?.name || '—')}</div><div class="sm ${late ? 'neg' : 'muted'}">${late ? 'Atrasado · ' : 'Vence '}${dateBR(t.date)}</div></div>
            <div class="num ${t.type}">${brl(t.amount)}</div>
            <button class="btn sm" data-action="togglePaid" data-id="${t.id}">${t.type === 'income' ? 'Recebi' : 'Paguei'}</button></div>`;
        }).join('')}</div>` : empty('Nada pendente. 🎉')}
      </div>
      <div class="card"><div class="card-head"><h3>Orçamentos</h3><button class="link" data-action="nav" data-view="budgets">Gerenciar</button></div>
        ${budgets.length ? budgets.map(budgetRowHtml).join('') : empty('Defina limites de gastos por categoria.', 'nav" data-view="budgets', 'Criar orçamento')}
      </div>
      <div class="card"><div class="card-head"><h3>Contas</h3><button class="link" data-action="nav" data-view="accounts">Ver contas</button></div>
        <div class="list">${S.accounts.map(a => { const b = accountBalance(a.id); return `<div class="list-item"><div class="ico" style="--c:${a.color}">🏦</div>
          <div class="grow"><div class="desc">${esc(a.name)}</div><div class="muted sm">${ACC_TYPES[a.type] || ''}</div></div><div class="num ${b < 0 ? 'neg' : ''}">${brl(b)}</div></div>`; }).join('')}</div>
      </div>
      ${S.goals.length ? `<div class="card"><div class="card-head"><h3>Metas</h3><button class="link" data-action="nav" data-view="goals">Ver metas</button></div>
        ${S.goals.slice(0, 3).map(g => { const p = g.target ? g.saved / g.target * 100 : 0; return `<div class="bar-row"><div class="line"><span>${g.icon} ${esc(g.name)}</span><span class="sm muted">${Math.round(p)}%</span></div>
          <div class="bar"><span style="width:${Math.min(100, p)}%;background:${g.color}"></span></div></div>`; }).join('')}</div>` : ''}
    </div>
  </div>`;
}

function viewTransactions() {
  const f = ui.f;
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
  return pageHead('Lançamentos', `<button class="btn" data-action="exportCSV">⬇️ Exportar CSV</button><button class="btn" data-action="newTransfer">🔁 Transferir</button><button class="btn primary" data-action="newTx">+ Novo</button>`) + `
  <div class="card filters">
    <input type="search" placeholder="🔍 Buscar descrição…" data-filter="q" value="${esc(f.q)}">
    <select data-filter="type">${opt('', 'Todos os tipos', f.type)}${opt('expense', 'Despesas', f.type)}${opt('income', 'Receitas', f.type)}${opt('transfer', 'Transferências', f.type)}</select>
    <select data-filter="cat">${opt('', 'Todas as categorias', f.cat)}${S.categories.map(c => opt(c.id, `${c.icon} ${c.name}`, f.cat)).join('')}</select>
    <select data-filter="acc">${opt('', 'Todas as contas', f.acc)}${S.accounts.map(a => opt(a.id, a.name, f.acc)).join('')}</select>
    <select data-filter="status">${opt('', 'Qualquer situação', f.status)}${opt('paid', 'Pagos / recebidos', f.status)}${opt('pending', 'Pendentes', f.status)}</select>
  </div>
  <div class="card" id="txTable"></div>`;
}

function filteredTx() {
  const f = ui.f, q = f.q.trim().toLowerCase();
  return monthTx(ui.month).filter(t =>
    (!f.type || t.type === f.type) &&
    (!f.cat || t.categoryId === f.cat) &&
    (!f.acc || t.accountId === f.acc || t.toAccountId === f.acc) &&
    (!f.status || (f.status === 'paid') === !!t.paid) &&
    (!q || (t.desc || '').toLowerCase().includes(q))
  ).sort((a, b) => b.date.localeCompare(a.date));
}

function renderTxTable() {
  const list = filteredTx();
  let inc = 0, exp = 0;
  list.forEach(t => { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; });
  $('#txTable').innerHTML = list.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Descrição</th><th class="hide-sm">Categoria</th><th class="num">Valor</th><th class="hide-sm">Situação</th><th></th></tr></thead>
      <tbody>${list.map(txRow).join('')}</tbody>
    </table></div>
    <div class="totals"><span>${list.length} lançamento(s)</span><span>Receitas: <strong class="inc">${brl(inc)}</strong></span>
      <span>Despesas: <strong class="exp">${brl(exp)}</strong></span><span>Saldo: <strong class="${inc - exp < 0 ? 'neg' : 'pos'}">${brl(inc - exp)}</strong></span></div>`
    : empty(Object.values(ui.f).some(Boolean) ? 'Nenhum lançamento corresponde aos filtros.' : `Nenhum lançamento em ${monthLabel(ui.month)}.`, 'newTx', '+ Adicionar lançamento');
}

function txRow(t) {
  const c = cat(t.categoryId), a = acc(t.accountId), to = acc(t.toAccountId);
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  const chip = t.type === 'transfer' ? `<span class="chip" style="--c:#64748b">🔁 Transferência</span>`
    : `<span class="chip" style="--c:${c?.color || '#94a3b8'}">${c ? `${c.icon} ${esc(c.name)}` : 'Sem categoria'}</span>`;
  const paidLabel = t.paid ? (t.type === 'income' ? 'Recebido' : t.type === 'transfer' ? 'Feita' : 'Pago') : 'Pendente';
  return `<tr>
    <td class="nowrap">${dateBR(t.date).slice(0, 5)}</td>
    <td><div class="desc">${esc(t.desc || c?.name || '—')}${t.recurringId ? ' <span title="Lançamento fixo">🔁</span>' : ''}</div>
      <div class="muted sm">${t.type === 'transfer' ? `${esc(a?.name || '?')} → ${esc(to?.name || '?')}` : esc(a?.name || 'Conta removida')}</div></td>
    <td class="hide-sm">${chip}</td>
    <td class="num ${t.type}">${sign} ${brl(t.amount)}</td>
    <td class="hide-sm"><button class="status ${t.paid ? 'ok' : 'pend'}" data-action="togglePaid" data-id="${t.id}" title="Clique para alternar">${paidLabel}</button></td>
    <td class="row-actions"><button class="icon-btn" data-action="editTx" data-id="${t.id}" title="Editar">✏️</button><button class="icon-btn" data-action="delTx" data-id="${t.id}" title="Excluir">🗑️</button></td>
  </tr>`;
}

function viewAccounts() {
  const ym = ui.month;
  return pageHead('Contas', `<button class="btn" data-action="newTransfer">🔁 Transferir</button><button class="btn primary" data-action="newAccount">+ Nova conta</button>`) + `
  <div class="grid kpis">
    <div class="card kpi"><span class="kpi-label">Saldo total</span><strong class="kpi-value">${brl(totalBalance())}</strong></div>
    <div class="card kpi"><span class="kpi-label">Previsto (fim de ${MONTHS[+ym.slice(5) - 1].toLowerCase()})</span><strong class="kpi-value">${brl(totalBalance({ upTo: lastDay(ym), pending: true }))}</strong></div>
  </div>
  ${S.accounts.length ? `<div class="grid cards3">${S.accounts.map(a => {
    const b = accountBalance(a.id), p = accountBalance(a.id, { upTo: lastDay(ym), pending: true });
    return `<div class="card account" style="--c:${a.color}">
      <div class="acc-top"><div class="ico">${a.type === 'credit' ? '💳' : a.type === 'cash' ? '💵' : a.type === 'invest' ? '📈' : '🏦'}</div>
        <div><strong>${esc(a.name)}</strong><div class="muted sm">${ACC_TYPES[a.type] || ''}</div></div></div>
      <div class="acc-balance ${b < 0 ? 'neg' : ''}">${brl(b)}</div>
      <div class="muted sm">Previsto no fim do mês: ${brl(p)}</div>
      <div class="card-actions"><button class="btn sm" data-action="viewAccountTx" data-id="${a.id}">Extrato</button>
        <button class="btn sm" data-action="editAccount" data-id="${a.id}">Editar</button><button class="btn sm danger" data-action="delAccount" data-id="${a.id}">Excluir</button></div>
    </div>`;
  }).join('')}</div>` : `<div class="card">${empty('Cadastre sua primeira conta.', 'newAccount', '+ Nova conta')}</div>`}`;
}

function viewCategories() {
  const col = type => {
    const list = S.categories.filter(c => c.type === type);
    return `<div class="card"><div class="card-head"><h3>${type === 'expense' ? 'Despesas' : 'Receitas'}</h3>
      <button class="btn sm" data-action="newCategory" data-type="${type}">+ Adicionar</button></div>
      <div class="list">${list.map(c => {
        const n = S.transactions.filter(t => t.categoryId === c.id).length;
        return `<div class="list-item"><div class="ico" style="--c:${c.color}">${c.icon}</div><div class="grow"><div class="desc">${esc(c.name)}</div><div class="muted sm">${n} lançamento(s)</div></div>
          <button class="icon-btn" data-action="editCategory" data-id="${c.id}" title="Editar">✏️</button><button class="icon-btn" data-action="delCategory" data-id="${c.id}" title="Excluir">🗑️</button></div>`;
      }).join('') || empty('Nenhuma categoria.')}</div></div>`;
  };
  return pageHead('Categorias') + `<div class="grid cols-even">${col('expense')}${col('income')}</div>`;
}

function budgetRows(ym) {
  return S.categories.filter(c => c.type === 'expense' && S.budgets[c.id] > 0)
    .map(c => ({ c, limit: S.budgets[c.id], spent: spentIn(c.id, ym) }));
}
function budgetRowHtml({ c, limit, spent }) {
  const pct = spent / limit * 100, left = limit - spent;
  return `<div class="bar-row"><div class="line"><span>${c.icon} ${esc(c.name)}</span><span class="sm"><strong>${brl(spent)}</strong> <span class="muted">de ${brl(limit)}</span></span></div>
    ${progressBar(pct)}<div class="sm ${left < 0 ? 'neg' : 'muted'}">${left < 0 ? `Estourou em ${brl(-left)}` : `Restam ${brl(left)}`}</div></div>`;
}

function viewBudgets() {
  const ym = ui.month, rows = budgetRows(ym);
  const limit = rows.reduce((s, r) => s + r.limit, 0), spent = rows.reduce((s, r) => s + r.spent, 0);
  const inc = summary(ym).inc;
  return pageHead('Orçamentos mensais') + `
  <div class="grid kpis">
    <div class="card kpi"><span class="kpi-label">Total orçado</span><strong class="kpi-value">${brl(limit)}</strong><small>${inc ? `${Math.round(limit / inc * 100)}% da renda do mês` : 'Limite aplicado todo mês'}</small></div>
    <div class="card kpi"><span class="kpi-label">Gasto nas categorias orçadas</span><strong class="kpi-value exp">${brl(spent)}</strong></div>
    <div class="card kpi"><span class="kpi-label">Disponível</span><strong class="kpi-value ${limit - spent < 0 ? 'neg' : 'pos'}">${brl(limit - spent)}</strong></div>
    <div class="card kpi"><span class="kpi-label">Uso geral</span><strong class="kpi-value">${limit ? Math.round(spent / limit * 100) : 0}%</strong>${progressBar(limit ? spent / limit * 100 : 0)}</div>
  </div>
  <div class="card"><div class="card-head"><h3>Limite por categoria — ${monthLabel(ym)}</h3><span class="muted sm">Deixe vazio para não limitar</span></div>
    <div class="table-wrap"><table><thead><tr><th>Categoria</th><th style="width:150px">Limite mensal</th><th class="num">Gasto</th><th style="width:30%" class="hide-sm">Progresso</th></tr></thead><tbody>
    ${S.categories.filter(c => c.type === 'expense').map(c => {
      const l = S.budgets[c.id] || 0, sp = spentIn(c.id, ym);
      return `<tr><td>${c.icon} ${esc(c.name)}</td>
        <td><input inputmode="decimal" data-budget="${c.id}" value="${l ? fmtNum(l) : ''}" placeholder="—"></td>
        <td class="num ${l && sp > l ? 'neg' : ''}">${brl(sp)}</td><td class="hide-sm">${l ? progressBar(sp / l * 100) : '<span class="muted sm">sem limite</span>'}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}

function viewGoals() {
  const now = curMonth();
  const total = S.goals.reduce((s, g) => s + g.saved, 0), target = S.goals.reduce((s, g) => s + g.target, 0);
  return pageHead('Metas', `<button class="btn primary" data-action="newGoal">+ Nova meta</button>`) +
  (S.goals.length ? `<div class="grid kpis"><div class="card kpi"><span class="kpi-label">Guardado em metas</span><strong class="kpi-value pos">${brl(total)}</strong><small>de ${brl(target)}</small></div></div>
  <div class="grid cards3">${S.goals.map(g => {
    const p = g.target ? g.saved / g.target * 100 : 0, left = Math.max(0, g.target - g.saved);
    let plan = '';
    if (left <= 0) plan = '🎉 Meta atingida!';
    else if (g.deadline) {
      const m = monthsBetween(now, monthKey(g.deadline));
      plan = m > 0 ? `Guarde <strong>${brl(left / m)}</strong>/mês por ${m} meses` : `<span class="neg">Prazo vencido</span>`;
    }
    return `<div class="card goal" style="--c:${g.color}">
      <div class="acc-top"><div class="ico">${g.icon}</div><div><strong>${esc(g.name)}</strong><div class="muted sm">${g.deadline ? `Até ${dateBR(g.deadline)}` : 'Sem prazo'}</div></div></div>
      <div class="acc-balance">${brl(g.saved)}</div>
      <div class="bar"><span style="width:${Math.min(100, p)}%"></span></div>
      <div class="line sm" style="display:flex;justify-content:space-between"><span>${Math.round(p)}% de ${brl(g.target)}</span><span class="muted">faltam ${brl(left)}</span></div>
      ${plan ? `<div class="sm" style="margin-top:.5rem">${plan}</div>` : ''}
      <div class="card-actions"><button class="btn sm primary" data-action="contributeGoal" data-id="${g.id}">+ Guardar</button>
        <button class="btn sm" data-action="editGoal" data-id="${g.id}">Editar</button><button class="btn sm danger" data-action="delGoal" data-id="${g.id}">Excluir</button></div>
    </div>`;
  }).join('')}</div>` : `<div class="card">${empty('Crie metas como reserva de emergência, viagem ou carro novo e acompanhe seu progresso.', 'newGoal', '+ Criar meta')}</div>`);
}

function viewRecurring() {
  const active = S.recurring.filter(r => r.active);
  const inc = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const exp = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  return pageHead('Receitas e despesas fixas', `<button class="btn primary" data-action="newRec">+ Novo fixo</button>`) + `
  <div class="grid kpis">
    <div class="card kpi"><span class="kpi-label">Receitas fixas / mês</span><strong class="kpi-value inc">${brl(inc)}</strong></div>
    <div class="card kpi"><span class="kpi-label">Despesas fixas / mês</span><strong class="kpi-value exp">${brl(exp)}</strong></div>
    <div class="card kpi"><span class="kpi-label">Sobra após fixos</span><strong class="kpi-value ${inc - exp < 0 ? 'neg' : 'pos'}">${brl(inc - exp)}</strong></div>
  </div>
  <div class="card">${S.recurring.length ? `<p class="muted sm" style="margin-top:0">Os lançamentos fixos são criados automaticamente todo mês como <strong>pendentes</strong>. Marque como pago quando quitar.</p>
    <div class="table-wrap"><table><thead><tr><th>Descrição</th><th class="hide-sm">Categoria</th><th>Dia</th><th class="num">Valor</th><th>Ativo</th><th></th></tr></thead><tbody>
    ${S.recurring.map(r => { const c = cat(r.categoryId); return `<tr>
      <td><div class="desc">${esc(r.desc)}</div><div class="muted sm">${esc(acc(r.accountId)?.name || '')}</div></td>
      <td class="hide-sm"><span class="chip" style="--c:${c?.color || '#94a3b8'}">${c ? `${c.icon} ${esc(c.name)}` : 'Sem categoria'}</span></td>
      <td>${r.day}</td><td class="num ${r.type}">${r.type === 'income' ? '+' : '−'} ${brl(r.amount)}</td>
      <td><button class="status ${r.active ? 'ok' : 'pend'}" data-action="toggleRec" data-id="${r.id}">${r.active ? 'Ativo' : 'Pausado'}</button></td>
      <td class="row-actions"><button class="icon-btn" data-action="editRec" data-id="${r.id}">✏️</button><button class="icon-btn" data-action="delRec" data-id="${r.id}">🗑️</button></td></tr>`; }).join('')}
    </tbody></table></div>` : empty('Cadastre salário, aluguel, internet, assinaturas… e eles serão lançados todo mês automaticamente.', 'newRec', '+ Novo fixo')}</div>`;
}

function viewReports() {
  const y = ui.month.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  const rows = months.map(m => ({ m, label: MONTHS[+m.slice(5) - 1].slice(0, 3), ...summary(m) }));
  const yearTx = S.transactions.filter(t => t.date.startsWith(y));
  const inc = rows.reduce((s, r) => s + r.inc, 0), exp = rows.reduce((s, r) => s + r.exp, 0);
  const withData = rows.filter(r => r.inc || r.exp).length || 1;
  const expCats = totalsByCategory(yearTx, 'expense'), incCats = totalsByCategory(yearTx, 'income');
  return pageHead(`Relatório de ${y}`, `<button class="btn" data-action="prevYear">‹ ${+y - 1}</button><button class="btn" data-action="nextYear">${+y + 1} ›</button>`) + `
  <div class="grid kpis">
    <div class="card kpi"><span class="kpi-label">Receitas no ano</span><strong class="kpi-value inc">${brl(inc)}</strong><small>Média ${brl(inc / withData)}/mês</small></div>
    <div class="card kpi"><span class="kpi-label">Despesas no ano</span><strong class="kpi-value exp">${brl(exp)}</strong><small>Média ${brl(exp / withData)}/mês</small></div>
    <div class="card kpi"><span class="kpi-label">Resultado</span><strong class="kpi-value ${inc - exp < 0 ? 'neg' : 'pos'}">${brl(inc - exp)}</strong></div>
    <div class="card kpi"><span class="kpi-label">Taxa de poupança</span><strong class="kpi-value">${inc ? Math.round((inc - exp) / inc * 100) : 0}%</strong><small>Do que entrou, quanto sobrou</small></div>
  </div>
  <div class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Mês a mês</h3></div>${barChart(rows)}</div>
  <div class="grid cols-even" style="margin-bottom:1rem">
    <div class="card"><div class="card-head"><h3>Para onde foi o dinheiro</h3></div>${expCats.length ? `<div class="donut-wrap">${donut(expCats)}${legend(expCats.slice(0, 8))}</div>` : empty('Sem despesas no ano.')}</div>
    <div class="card"><div class="card-head"><h3>De onde veio o dinheiro</h3></div>${incCats.length ? `<div class="donut-wrap">${donut(incCats)}${legend(incCats.slice(0, 8))}</div>` : empty('Sem receitas no ano.')}</div>
  </div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Resultado</th><th class="num hide-sm">Poupança</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><button class="link" data-action="gotoMonth" data-month="${r.m}">${MONTHS[+r.m.slice(5) - 1]}</button></td><td class="num inc">${brl(r.inc)}</td><td class="num exp">${brl(r.exp)}</td>
      <td class="num ${r.net < 0 ? 'neg' : ''}">${brl(r.net)}</td><td class="num hide-sm">${r.inc ? Math.round(r.net / r.inc * 100) + '%' : '—'}</td></tr>`).join('')}
    <tr><td><strong>Total</strong></td><td class="num inc">${brl(inc)}</td><td class="num exp">${brl(exp)}</td><td class="num">${brl(inc - exp)}</td><td class="hide-sm"></td></tr>
  </tbody></table></div></div>`;
}

function viewSettings() {
  const t = S.settings.theme;
  return pageHead('Ajustes') + `
  <div class="grid cols-even">
    <div class="stack">
      <div class="card"><h3>Aparência</h3>
        <div class="form"><label>Tema<select data-setting="theme">
          <option value="auto" ${t === 'auto' ? 'selected' : ''}>Automático (do sistema)</option>
          <option value="light" ${t === 'light' ? 'selected' : ''}>Claro</option>
          <option value="dark" ${t === 'dark' ? 'selected' : ''}>Escuro</option></select></label></div>
      </div>
      <div class="card"><h3>Backup</h3>
        <p class="muted sm">Seus dados ficam salvos <strong>apenas neste navegador</strong>. Faça backup com frequência — principalmente antes de limpar o histórico do navegador.</p>
        <div class="card-actions"><button class="btn primary" data-action="exportJSON">⬇️ Baixar backup</button><button class="btn" data-action="importJSON">⬆️ Restaurar backup</button><button class="btn" data-action="exportCSVAll">⬇️ Todos os lançamentos (CSV)</button></div>
      </div>
    </div>
    <div class="stack">
      <div class="card"><h3>Resumo dos dados</h3>
        <div class="list">
          <div class="list-item"><span class="grow">Lançamentos</span><strong>${S.transactions.length}</strong></div>
          <div class="list-item"><span class="grow">Contas</span><strong>${S.accounts.length}</strong></div>
          <div class="list-item"><span class="grow">Categorias</span><strong>${S.categories.length}</strong></div>
          <div class="list-item"><span class="grow">Metas</span><strong>${S.goals.length}</strong></div>
          <div class="list-item"><span class="grow">Fixos</span><strong>${S.recurring.length}</strong></div>
        </div>
      </div>
      <div class="card"><h3>Zona de cuidado</h3>
        <p class="muted sm">Os dados de exemplo e o reset <strong>substituem tudo</strong> que está salvo.</p>
        <div class="card-actions"><button class="btn" data-action="demo">🧪 Carregar dados de exemplo</button><button class="btn danger" data-action="reset">Apagar tudo</button></div>
      </div>
    </div>
  </div>`;
}

const VIEWS = { dashboard: viewDashboard, transactions: viewTransactions, accounts: viewAccounts, categories: viewCategories, budgets: viewBudgets, goals: viewGoals, recurring: viewRecurring, reports: viewReports, settings: viewSettings };

function render() {
  if (!VIEWS[ui.view]) ui.view = 'dashboard';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  $('#monthLabel').textContent = monthLabel(ui.month);
  $('#view').innerHTML = VIEWS[ui.view]();
  if (ui.view === 'transactions') renderTxTable();
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/* ================= modal / toast ================= */
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  setTimeout(() => $('#modalBody').querySelector('input:not([type=radio]):not([type=checkbox]), select')?.focus(), 30);
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
const formActions = `<div class="form-actions"><button type="button" class="btn" data-action="closeModal">Cancelar</button><button class="btn primary">Salvar</button></div>`;
const accOpts = sel => S.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const catOpts = (type, sel) => `<option value="">Sem categoria</option>` + S.categories.filter(c => c.type === type)
  .map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
const defaultDate = () => ui.month === curMonth() ? todayISO() : `${ui.month}-01`;
const emojiPicker = () => `<div class="emoji-picks">${EMOJIS.map(e => `<button type="button" data-action="pickEmoji" data-emoji="${e}">${e}</button>`).join('')}</div>`;

/* ================= formulários ================= */
function txForm(t, preset = {}) {
  const isNew = !t;
  if (!S.accounts.length) { toast('Cadastre uma conta primeiro'); ui.view = 'accounts'; render(); return; }
  t = t || { type: 'expense', amount: '', date: defaultDate(), desc: '', categoryId: '', accountId: S.accounts[0].id, toAccountId: S.accounts[1]?.id || S.accounts[0].id, paid: true, ...preset };
  openModal(`<h2>${isNew ? 'Novo' : 'Editar'} lançamento</h2>
    <form id="txForm" class="form" autocomplete="off">
      <div class="seg">${['expense', 'income', 'transfer'].map(k => `<label><input type="radio" name="type" value="${k}" ${t.type === k ? 'checked' : ''}><span>${TYPE_LABEL[k]}</span></label>`).join('')}</div>
      <div class="row2"><label>Valor (R$)<input name="amount" inputmode="decimal" required placeholder="0,00" value="${t.amount !== '' ? fmtNum(t.amount) : ''}"></label>
        <label>Data<input type="date" name="date" required value="${t.date}"></label></div>
      <label>Descrição<input name="desc" value="${esc(t.desc)}" placeholder="Ex.: Supermercado" list="descList"></label>
      <datalist id="descList">${[...new Set(S.transactions.map(x => x.desc).filter(Boolean))].slice(-80).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <label data-show="cat">Categoria<select name="categoryId"></select></label>
      <div class="row2"><label><span data-show="fromLabel">Conta</span><select name="accountId">${accOpts(t.accountId)}</select></label>
        <label data-show="to">Para a conta<select name="toAccountId">${accOpts(t.toAccountId)}</select></label></div>
      ${isNew ? `<label data-show="inst">Parcelas<input type="number" name="installments" min="1" max="120" value="1">
        <small class="muted">Para compras parceladas: informe o valor total e ele será dividido mês a mês.</small></label>` : ''}
      <label class="check"><input type="checkbox" name="paid" ${t.paid ? 'checked' : ''}><span id="paidLabel"></span></label>
      ${formActions}
    </form>`);
  const form = $('#txForm');
  const sync = () => {
    const type = form.type.value;
    form.categoryId.innerHTML = catOpts(type, t.categoryId);
    form.querySelector('[data-show=cat]').hidden = type === 'transfer';
    form.querySelector('[data-show=to]').hidden = type !== 'transfer';
    form.querySelector('[data-show=fromLabel]').textContent = type === 'transfer' ? 'Da conta' : 'Conta';
    const inst = form.querySelector('[data-show=inst]');
    if (inst) inst.hidden = type !== 'expense';
    $('#paidLabel').textContent = type === 'income' ? 'Já recebi' : type === 'transfer' ? 'Já foi feita' : 'Já paguei';
  };
  form.addEventListener('change', e => { if (e.target.name === 'type') sync(); });
  // ao escolher uma descrição já usada, sugere a mesma categoria
  form.desc.addEventListener('change', () => {
    const prev = [...S.transactions].reverse().find(x => x.desc === form.desc.value && x.type === form.type.value && x.categoryId);
    if (prev && !form.categoryId.value) form.categoryId.value = prev.categoryId;
  });
  sync();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const amount = round2(parseNum(form.amount.value));
    if (!(amount > 0)) return toast('Informe um valor maior que zero');
    const type = form.type.value;
    if (type === 'transfer' && form.accountId.value === form.toAccountId.value) return toast('Escolha contas diferentes');
    const base = {
      type, date: form.date.value, desc: form.desc.value.trim(),
      categoryId: type === 'transfer' ? '' : form.categoryId.value,
      accountId: form.accountId.value, toAccountId: type === 'transfer' ? form.toAccountId.value : '',
      paid: form.paid.checked,
    };
    const n = isNew && type === 'expense' ? Math.max(1, Math.min(120, parseInt(form.installments.value, 10) || 1)) : 1;
    if (!isNew) Object.assign(t, base, { amount });
    else if (n === 1) S.transactions.push({ id: uid(), ...base, amount });
    else {
      const part = Math.floor(amount * 100 / n) / 100, groupId = uid(), day = +base.date.slice(8);
      for (let i = 0; i < n; i++) {
        S.transactions.push({
          id: uid(), ...base, groupId,
          amount: i === n - 1 ? round2(amount - part * (n - 1)) : part,
          date: clampDay(addMonths(monthKey(base.date), i), day),
          desc: `${base.desc || 'Compra parcelada'} (${i + 1}/${n})`,
          paid: i === 0 ? base.paid : false,
        });
      }
    }
    save(); closeModal(); render();
    toast(n > 1 ? `${n} parcelas lançadas` : 'Lançamento salvo');
  });
}

function accountForm(a) {
  const isNew = !a;
  a = a || { name: '', type: 'bank', initial: 0, color: '#2563eb' };
  openModal(`<h2>${isNew ? 'Nova' : 'Editar'} conta</h2>
    <form id="accForm" class="form">
      <label>Nome<input name="name" required value="${esc(a.name)}" placeholder="Ex.: Nubank, Itaú, Carteira"></label>
      <label>Tipo<select name="type">${Object.entries(ACC_TYPES).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="row2"><label>Saldo inicial (R$)<input name="initial" inputmode="decimal" value="${fmtNum(a.initial || 0)}">
        <small class="muted">Use negativo para fatura/dívida</small></label><label>Cor<input type="color" name="color" value="${a.color}"></label></div>
      ${formActions}
    </form>`);
  $('#accForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = { name: f.name.value.trim(), type: f.type.value, initial: round2(parseNum(f.initial.value) || 0), color: f.color.value };
    if (isNew) S.accounts.push({ id: uid(), ...data }); else Object.assign(a, data);
    save(); closeModal(); render(); toast('Conta salva');
  });
}

function categoryForm(c, type = 'expense') {
  const isNew = !c;
  c = c || { name: '', type, icon: '📦', color: '#64748b' };
  openModal(`<h2>${isNew ? 'Nova' : 'Editar'} categoria</h2>
    <form id="catForm" class="form">
      <label>Nome<input name="name" required value="${esc(c.name)}"></label>
      <div class="row2"><label>Tipo<select name="type"><option value="expense" ${c.type === 'expense' ? 'selected' : ''}>Despesa</option><option value="income" ${c.type === 'income' ? 'selected' : ''}>Receita</option></select></label>
        <label>Cor<input type="color" name="color" value="${c.color}"></label></div>
      <label>Ícone<input name="icon" value="${esc(c.icon)}" maxlength="4" style="width:5rem"></label>
      ${emojiPicker()}
      ${formActions}
    </form>`);
  $('#catForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const data = { name: f.name.value.trim(), type: f.type.value, icon: f.icon.value.trim() || '📦', color: f.color.value };
    if (isNew) S.categories.push({ id: uid(), ...data }); else Object.assign(c, data);
    save(); closeModal(); render(); toast('Categoria salva');
  });
}

function goalForm(g) {
  const isNew = !g;
  g = g || { name: '', target: '', saved: 0, deadline: '', color: '#4f46e5', icon: '🏆' };
  openModal(`<h2>${isNew ? 'Nova' : 'Editar'} meta</h2>
    <form id="goalForm" class="form">
      <label>Nome<input name="name" required value="${esc(g.name)}" placeholder="Ex.: Reserva de emergência"></label>
      <div class="row2"><label>Valor da meta (R$)<input name="target" inputmode="decimal" required value="${g.target ? fmtNum(g.target) : ''}"></label>
        <label>Já guardado (R$)<input name="saved" inputmode="decimal" value="${fmtNum(g.saved || 0)}"></label></div>
      <div class="row2"><label>Prazo (opcional)<input type="date" name="deadline" value="${g.deadline || ''}"></label><label>Cor<input type="color" name="color" value="${g.color}"></label></div>
      <label>Ícone<input name="icon" value="${esc(g.icon)}" maxlength="4" style="width:5rem"></label>
      ${emojiPicker()}
      ${formActions}
    </form>`);
  $('#goalForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const target = round2(parseNum(f.target.value));
    if (!(target > 0)) return toast('Informe o valor da meta');
    const data = { name: f.name.value.trim(), target, saved: round2(parseNum(f.saved.value) || 0), deadline: f.deadline.value, color: f.color.value, icon: f.icon.value.trim() || '🏆' };
    if (isNew) S.goals.push({ id: uid(), history: [], ...data }); else Object.assign(g, data);
    save(); closeModal(); render(); toast('Meta salva');
  });
}

function contributeForm(g) {
  openModal(`<h2>${g.icon} ${esc(g.name)}</h2>
    <form id="contribForm" class="form">
      <div class="seg"><label><input type="radio" name="dir" value="1" checked><span>Guardar</span></label><label><input type="radio" name="dir" value="-1"><span>Retirar</span></label></div>
      <label>Valor (R$)<input name="amount" inputmode="decimal" required placeholder="0,00"></label>
      <label class="check"><input type="checkbox" name="asTx"><span>Registrar também como transferência entre contas</span></label>
      <div class="row2" data-show="accs" hidden><label>De<select name="from">${accOpts(S.accounts[0]?.id)}</select></label><label>Para<select name="to">${accOpts((S.accounts.find(a => a.type === 'savings' || a.type === 'invest') || S.accounts[1] || S.accounts[0])?.id)}</select></label></div>
      ${g.history?.length ? `<div><h3 style="margin-top:.5rem">Histórico</h3><div class="list">${g.history.slice(-6).reverse().map(h => `<div class="list-item sm"><span class="grow">${dateBR(h.date)}</span><strong class="${h.amount < 0 ? 'neg' : 'pos'}">${brl(h.amount)}</strong></div>`).join('')}</div></div>` : ''}
      ${formActions}
    </form>`);
  const f = $('#contribForm');
  f.asTx.addEventListener('change', () => { f.querySelector('[data-show=accs]').hidden = !f.asTx.checked; });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const v = round2(parseNum(f.amount.value));
    if (!(v > 0)) return toast('Informe um valor');
    const amount = v * +f.dir.value;
    g.saved = round2(Math.max(0, g.saved + amount));
    (g.history = g.history || []).push({ date: todayISO(), amount });
    if (f.asTx.checked && f.from.value !== f.to.value) {
      const [from, to] = amount > 0 ? [f.from.value, f.to.value] : [f.to.value, f.from.value];
      S.transactions.push({ id: uid(), type: 'transfer', amount: v, date: todayISO(), desc: `Meta: ${g.name}`, categoryId: '', accountId: from, toAccountId: to, paid: true });
    }
    save(); closeModal(); render();
    toast(g.saved >= g.target ? '🎉 Parabéns, meta atingida!' : 'Valor registrado');
  });
}

function recForm(r) {
  const isNew = !r;
  if (!S.accounts.length) { toast('Cadastre uma conta primeiro'); return; }
  r = r || { type: 'expense', amount: '', desc: '', categoryId: '', accountId: S.accounts[0].id, day: 10, startMonth: ui.month, active: true };
  openModal(`<h2>${isNew ? 'Novo' : 'Editar'} lançamento fixo</h2>
    <form id="recForm" class="form">
      <div class="seg">${['expense', 'income'].map(k => `<label><input type="radio" name="type" value="${k}" ${r.type === k ? 'checked' : ''}><span>${TYPE_LABEL[k]}</span></label>`).join('')}</div>
      <label>Descrição<input name="desc" required value="${esc(r.desc)}" placeholder="Ex.: Aluguel, Salário, Netflix"></label>
      <div class="row2"><label>Valor (R$)<input name="amount" inputmode="decimal" required value="${r.amount !== '' ? fmtNum(r.amount) : ''}"></label>
        <label>Dia do mês<input type="number" name="day" min="1" max="31" required value="${r.day}"></label></div>
      <div class="row2"><label>Categoria<select name="categoryId"></select></label><label>Conta<select name="accountId">${accOpts(r.accountId)}</select></label></div>
      <label>Começa em<input type="month" name="startMonth" required value="${r.startMonth}"></label>
      ${!isNew ? '<small class="muted">Alterações valem para os próximos meses; lançamentos já criados não mudam.</small>' : ''}
      ${formActions}
    </form>`);
  const f = $('#recForm');
  const sync = () => { f.categoryId.innerHTML = catOpts(f.type.value, r.categoryId); };
  f.addEventListener('change', e => { if (e.target.name === 'type') sync(); });
  sync();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const amount = round2(parseNum(f.amount.value));
    if (!(amount > 0)) return toast('Informe um valor');
    const data = {
      type: f.type.value, amount, desc: f.desc.value.trim(), categoryId: f.categoryId.value, accountId: f.accountId.value,
      day: Math.max(1, Math.min(31, +f.day.value || 1)), startMonth: f.startMonth.value,
    };
    if (isNew) S.recurring.push({ id: uid(), active: true, lastGenerated: addMonths(data.startMonth, -1), ...data });
    else {
      Object.assign(r, data);
      if (!r.lastGenerated || r.lastGenerated < addMonths(r.startMonth, -1)) r.lastGenerated = addMonths(r.startMonth, -1);
    }
    const n = generateRecurring();
    save(); closeModal(); render();
    toast(n ? `Fixo salvo · ${n} lançamento(s) criado(s)` : 'Fixo salvo');
  });
}

/* ================= exportação ================= */
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toCSV(list) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Situação'];
  const rows = list.sort((a, b) => a.date.localeCompare(b.date)).map(t => [
    dateBR(t.date), TYPE_LABEL[t.type], t.desc, cat(t.categoryId)?.name || '', acc(t.accountId)?.name || '', acc(t.toAccountId)?.name || '',
    fmtNum(t.type === 'expense' ? -t.amount : t.amount), t.paid ? 'Efetivado' : 'Pendente',
  ].map(q).join(';'));
  return '﻿' + [head.map(q).join(';'), ...rows].join('\r\n');
}

/* ================= dados de exemplo ================= */
function loadDemo() {
  S = defaultState();
  S.settings.theme = document.documentElement.dataset.theme || 'auto';
  let seed = 42;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const between = (a, b) => round2(a + rnd() * (b - a));
  const C = name => S.categories.find(c => c.name === name).id;
  const [wallet, bank] = S.accounts;
  wallet.initial = 150; bank.initial = 2300;
  const card = { id: uid(), name: 'Cartão de crédito', type: 'credit', initial: 0, color: '#dc2626' };
  const reserve = { id: uid(), name: 'Reserva', type: 'savings', initial: 6000, color: '#0d9488' };
  S.accounts.push(card, reserve);
  const cur = curMonth(), start = addMonths(cur, -5), today = todayISO();
  const rule = (type, amount, desc, categoryId, accountId, day) => ({ id: uid(), type, amount, desc, categoryId, accountId, day, startMonth: start, lastGenerated: addMonths(start, -1), active: true });
  S.recurring = [
    rule('income', 5200, 'Salário', C('Salário'), bank.id, 5),
    rule('expense', 1450, 'Aluguel', C('Moradia'), bank.id, 10),
    rule('expense', 189.9, 'Internet + celular', C('Contas e serviços'), bank.id, 15),
    rule('expense', 135, 'Conta de luz', C('Contas e serviços'), bank.id, 18),
    rule('expense', 55.9, 'Streaming', C('Assinaturas'), card.id, 20),
    rule('expense', 99, 'Academia', C('Saúde'), card.id, 7),
  ];
  generateRecurring();
  const add = (type, amount, desc, catName, accountId, date) => {
    if (date <= today) S.transactions.push({ id: uid(), type, amount, desc, categoryId: catName ? C(catName) : '', accountId, toAccountId: '', paid: true, date });
  };
  const day = m => clampDay(m, 1 + Math.floor(rnd() * 28));
  for (let i = 0; i < 6; i++) {
    const m = addMonths(start, i);
    for (let k = 0; k < 4; k++) add('expense', between(140, 420), 'Supermercado', 'Mercado', bank.id, day(m));
    for (let k = 0; k < 6; k++) add('expense', between(22, 95), ['iFood', 'Restaurante', 'Padaria', 'Lanche'][k % 4], 'Alimentação', card.id, day(m));
    for (let k = 0; k < 3; k++) add('expense', between(60, 140), k ? 'Uber' : 'Combustível', 'Transporte', k ? card.id : bank.id, day(m));
    add('expense', between(80, 260), 'Cinema e bar', 'Lazer', card.id, day(m));
    add('expense', between(20, 60), 'Feira', 'Mercado', wallet.id, day(m));
    if (i % 2) add('income', between(600, 1400), 'Projeto freelance', 'Freelance', bank.id, day(m));
    if (i % 3 === 0) add('expense', between(90, 320), 'Farmácia', 'Saúde', card.id, day(m));
    add('income', between(30, 45), 'Rendimento da reserva', 'Rendimentos', reserve.id, clampDay(m, 28));
    const tr = (amount, desc, from, to, d) => { if (d <= today) S.transactions.push({ id: uid(), type: 'transfer', amount, desc, categoryId: '', accountId: from, toAccountId: to, paid: true, date: d }); };
    tr(300, 'Aporte na reserva', bank.id, reserve.id, clampDay(m, 6));
    tr(200, 'Saque', bank.id, wallet.id, clampDay(m, 3));
  }
  // compra parcelada em 10x no cartão
  const pStart = addMonths(cur, -3), groupId = uid();
  for (let i = 0; i < 10; i++) {
    const m = addMonths(pStart, i);
    S.transactions.push({ id: uid(), type: 'expense', amount: 389.9, desc: `Notebook (${i + 1}/10)`, categoryId: C('Compras'), accountId: card.id, toAccountId: '', paid: m < cur, date: clampDay(m, 12), groupId });
  }
  // pagamento da fatura: no dia 8, paga os gastos do cartão do mês anterior
  for (let i = 1; i <= 6; i++) {
    const m = addMonths(start, i), prev = addMonths(m, -1), d = clampDay(m, 8);
    const due = round2(monthTx(prev).filter(t => t.type === 'expense' && t.accountId === card.id).reduce((s, t) => s + t.amount, 0));
    S.transactions.push({ id: uid(), type: 'transfer', amount: due, desc: 'Pagamento da fatura', categoryId: '', accountId: bank.id, toAccountId: card.id, paid: d <= today, date: d });
  }
  S.transactions.forEach(t => { if (t.recurringId && t.date <= today) t.paid = true; });
  S.budgets = { [C('Mercado')]: 1300, [C('Alimentação')]: 450, [C('Transporte')]: 350, [C('Lazer')]: 250, [C('Compras')]: 500 };
  const plus = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  S.goals = [
    { id: uid(), name: 'Reserva de emergência', target: 20000, saved: 7800, deadline: plus(18), color: '#0d9488', icon: '🛟', history: [] },
    { id: uid(), name: 'Viagem de férias', target: 6000, saved: 1850, deadline: plus(8), color: '#db2777', icon: '✈️', history: [] },
    { id: uid(), name: 'Trocar de celular', target: 3500, saved: 3500, deadline: '', color: '#7c3aed', icon: '📱', history: [] },
  ];
  save();
}

/* ================= eventos ================= */
const actions = {
  nav: d => { ui.view = d.view; location.hash = d.view; render(); window.scrollTo(0, 0); },
  prevMonth: () => { ui.month = addMonths(ui.month, -1); render(); },
  nextMonth: () => { ui.month = addMonths(ui.month, 1); render(); },
  thisMonth: () => { ui.month = curMonth(); render(); },
  prevYear: () => { ui.month = addMonths(ui.month, -12); render(); },
  nextYear: () => { ui.month = addMonths(ui.month, 12); render(); },
  gotoMonth: d => { ui.month = d.month; actions.nav({ view: 'transactions' }); },
  goPending: () => { ui.f = { type: '', cat: '', acc: '', status: 'pending', q: '' }; actions.nav({ view: 'transactions' }); },
  viewAccountTx: d => { ui.f = { type: '', cat: '', acc: d.id, status: '', q: '' }; actions.nav({ view: 'transactions' }); },
  toggleTheme: () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    S.settings.theme = dark ? 'light' : 'dark';
    applyTheme(); save(); render();
  },
  closeModal,
  pickEmoji: (d, el) => { el.closest('form').icon.value = d.emoji; },

  newTx: () => txForm(),
  newTransfer: () => txForm(null, { type: 'transfer', paid: true }),
  editTx: d => txForm(byId(S.transactions, d.id)),
  delTx: d => {
    const t = byId(S.transactions, d.id);
    if (!t) return;
    const group = t.groupId ? S.transactions.filter(x => x.groupId === t.groupId) : [];
    if (group.length > 1 && confirm(`Este lançamento faz parte de uma compra parcelada (${group.length} parcelas).\n\nOK = excluir TODAS as parcelas\nCancelar = escolher outra opção`)) {
      S.transactions = S.transactions.filter(x => x.groupId !== t.groupId);
    } else if (confirm(`Excluir "${t.desc || TYPE_LABEL[t.type]}" de ${brl(t.amount)}?`)) {
      S.transactions = S.transactions.filter(x => x.id !== t.id);
    } else return;
    save(); render(); toast('Excluído');
  },
  togglePaid: d => { const t = byId(S.transactions, d.id); if (t) { t.paid = !t.paid; save(); render(); } },

  newAccount: () => accountForm(),
  editAccount: d => accountForm(acc(d.id)),
  delAccount: d => {
    const a = acc(d.id);
    const n = S.transactions.filter(t => t.accountId === a.id || t.toAccountId === a.id).length;
    if (!confirm(n ? `A conta "${a.name}" tem ${n} lançamento(s). Excluir a conta E esses lançamentos?` : `Excluir a conta "${a.name}"?`)) return;
    S.transactions = S.transactions.filter(t => t.accountId !== a.id && t.toAccountId !== a.id);
    S.recurring = S.recurring.filter(r => r.accountId !== a.id);
    S.accounts = S.accounts.filter(x => x.id !== a.id);
    save(); render(); toast('Conta excluída');
  },

  newCategory: d => categoryForm(null, d.type),
  editCategory: d => categoryForm(cat(d.id)),
  delCategory: d => {
    const c = cat(d.id);
    const n = S.transactions.filter(t => t.categoryId === c.id).length;
    if (!confirm(n ? `"${c.name}" tem ${n} lançamento(s), que ficarão sem categoria. Excluir?` : `Excluir a categoria "${c.name}"?`)) return;
    S.transactions.forEach(t => { if (t.categoryId === c.id) t.categoryId = ''; });
    S.recurring.forEach(r => { if (r.categoryId === c.id) r.categoryId = ''; });
    delete S.budgets[c.id];
    S.categories = S.categories.filter(x => x.id !== c.id);
    save(); render(); toast('Categoria excluída');
  },

  newGoal: () => goalForm(),
  editGoal: d => goalForm(byId(S.goals, d.id)),
  contributeGoal: d => contributeForm(byId(S.goals, d.id)),
  delGoal: d => {
    const g = byId(S.goals, d.id);
    if (!confirm(`Excluir a meta "${g.name}"?`)) return;
    S.goals = S.goals.filter(x => x.id !== g.id);
    save(); render();
  },

  newRec: () => recForm(),
  editRec: d => recForm(byId(S.recurring, d.id)),
  toggleRec: d => {
    const r = byId(S.recurring, d.id);
    r.active = !r.active;
    // ao reativar, não cria retroativamente os meses em que ficou pausado
    if (r.active && r.lastGenerated < addMonths(curMonth(), -1)) r.lastGenerated = addMonths(curMonth(), -1);
    generateRecurring(); save(); render();
  },
  delRec: d => {
    const r = byId(S.recurring, d.id);
    if (!confirm(`Excluir o fixo "${r.desc}"? Os lançamentos já criados serão mantidos.`)) return;
    S.recurring = S.recurring.filter(x => x.id !== r.id);
    S.transactions.forEach(t => { if (t.recurringId === r.id) delete t.recurringId; });
    save(); render();
  },

  exportCSV: () => download(`lancamentos-${ui.month}.csv`, toCSV(filteredTx()), 'text/csv;charset=utf-8'),
  exportCSVAll: () => download(`lancamentos-todos.csv`, toCSV([...S.transactions]), 'text/csv;charset=utf-8'),
  exportJSON: () => download(`backup-financas-${todayISO()}.json`, JSON.stringify(S, null, 2), 'application/json'),
  importJSON: () => $('#importFile').click(),
  demo: () => {
    if (S.transactions.length && !confirm('Isso vai SUBSTITUIR seus dados atuais pelos dados de exemplo. Continuar?')) return;
    loadDemo(); ui.month = curMonth(); actions.nav({ view: 'dashboard' }); toast('Dados de exemplo carregados');
  },
  reset: () => {
    if (!confirm('Apagar TODOS os dados? Essa ação não pode ser desfeita. (Dica: baixe um backup antes.)')) return;
    S = defaultState(); save(); applyTheme(); actions.nav({ view: 'dashboard' }); toast('Dados apagados');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.closest('#modalBody') && el.dataset.action === 'nav') closeModal();
  actions[el.dataset.action]?.(el.dataset, el, e);
});
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
  if (e.key === 'n' && $('#modal').hidden && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); txForm(); }
});
document.addEventListener('input', e => {
  const k = e.target.dataset.filter;
  if (k) { ui.f[k] = e.target.value; renderTxTable(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.budget) {
    const v = round2(parseNum(t.value));
    if (v > 0) S.budgets[t.dataset.budget] = v; else delete S.budgets[t.dataset.budget];
    save(); render();
  } else if (t.dataset.setting === 'theme') {
    S.settings.theme = t.value; applyTheme(); save();
  }
});
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('formato');
    if (!confirm(`Restaurar backup com ${data.transactions.length} lançamentos? Os dados atuais serão substituídos.`)) return;
    S = normalize(data); save(); applyTheme(); render(); toast('Backup restaurado');
  } catch { toast('Arquivo de backup inválido'); }
});
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== ui.view) { ui.view = v; render(); } });

/* ================= início ================= */
applyTheme();
const created = generateRecurring();
render();
if (created) toast(`${created} lançamento(s) fixo(s) criado(s) para este mês`);
