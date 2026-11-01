-- Esquema inicial da Plataforma ACEANA (spec §5).
-- Tabelas marcadas como imutáveis recebem o trigger forbid_mutation: mudança cria linha nova.

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'tabela imutável: %', tg_table_name;
end;
$$;

create table users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('GN','GP','DP','DIRETORIA','ADMIN')),
  active boolean not null default true
);

create table parameter_versions (
  id text primary key,
  version int not null unique,
  values jsonb not null,
  valid_from timestamptz not null default now(),
  author_id text,
  origin text not null
);

create table catalog_versions (
  id text primary key,
  version int not null unique,
  published_at timestamptz not null default now(),
  author_id text,
  origin text not null
);

create table solutions (
  id text primary key,
  catalog_version_id text not null references catalog_versions(id),
  code text not null,
  name text not null,
  front text,
  complexity int not null,
  unique (catalog_version_id, code)
);

create table solution_stages (
  id text primary key,
  solution_id text not null references solutions(id),
  position int not null,
  name text not null,
  days int not null check (days >= 0),
  days_validated boolean not null default false
);

create table proposals (
  id text primary key,
  deal_id text not null,
  org_name text not null,
  contact_name text,
  owner_id text references users(id),
  status text not null default 'RASCUNHO',
  created_at timestamptz not null default now()
);
create unique index proposals_one_active_per_deal on proposals(deal_id) where status <> 'PERDIDA';

create table proposal_versions (
  id text primary key,
  proposal_id text not null references proposals(id),
  number int not null,
  catalog_version_id text not null references catalog_versions(id),
  parameter_version_id text not null references parameter_versions(id),
  input jsonb not null,
  result jsonb not null,
  valid_until date,
  created_by text,
  created_at timestamptz not null default now(),
  unique (proposal_id, number)
);

create table approvals (
  id text primary key,
  target_type text not null check (target_type in ('PROPOSAL_VERSION','CONTRACT')),
  target_id text not null,
  kind text not null check (kind in ('PRICE','EXCEPTION','CONTRACT','EXCEPTION_REQUEST')),
  requested_by text,
  decided_by text,
  decision text check (decision in ('APROVADA','RECUSADA','PEDIDA')),
  justification text,
  catalog_version_id text,
  parameter_version_id text,
  created_at timestamptz not null default now()
);

create table contract_forms (
  id text primary key,
  proposal_id text not null references proposals(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table contract_data (
  proposal_id text primary key references proposals(id),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table contract_personal (
  proposal_id text primary key references proposals(id),
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table contracts (
  id text primary key,
  proposal_id text not null references proposals(id),
  proposal_version_id text not null references proposal_versions(id),
  content jsonb not null,
  content_hash text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table contract_status (
  contract_id text primary key references contracts(id),
  status text not null,
  envelope_id text,
  updated_at timestamptz not null default now()
);

create table external_links (
  deal_id text not null,
  system text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (deal_id, system)
);

create table jobs (
  id text primary key,
  type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table connector_runs (
  id text primary key,
  job_id text references jobs(id),
  connector text not null,
  event text not null,
  ok boolean not null,
  error text,
  duration_ms int,
  created_at timestamptz not null default now()
);

create table audit_events (
  id text primary key,
  actor_id text,
  entity text not null,
  entity_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create table holidays (
  day date primary key,
  scope text not null,
  name text not null,
  source text not null
);

create trigger parameter_versions_immutable before update or delete on parameter_versions for each row execute function forbid_mutation();
create trigger catalog_versions_immutable before update or delete on catalog_versions for each row execute function forbid_mutation();
create trigger solutions_immutable before update or delete on solutions for each row execute function forbid_mutation();
create trigger solution_stages_immutable before update or delete on solution_stages for each row execute function forbid_mutation();
create trigger proposal_versions_immutable before update or delete on proposal_versions for each row execute function forbid_mutation();
create trigger approvals_immutable before update or delete on approvals for each row execute function forbid_mutation();
create trigger contracts_immutable before update or delete on contracts for each row execute function forbid_mutation();
create trigger connector_runs_immutable before update or delete on connector_runs for each row execute function forbid_mutation();
create trigger audit_events_immutable before update or delete on audit_events for each row execute function forbid_mutation();
