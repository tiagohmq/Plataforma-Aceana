-- Proposta pronta montada fora da plataforma (assistente com design system): PDF ou link do Canva,
-- presa a uma versão aprovada. Nova versão = anexo antigo deixa de valer (ele aponta para a versão velha).
create table proposal_attachments (
  id text primary key,
  proposal_version_id text not null references proposal_versions(id),
  kind text not null check (kind in ('PDF','LINK')),
  filename text,
  content_base64 text,
  url text,
  checks jsonb not null,
  confirmed_by text,
  created_by text,
  created_at timestamptz not null default now()
);
create trigger proposal_attachments_immutable before update or delete on proposal_attachments for each row execute function forbid_mutation();
