-- Envio da proposta: a versão é imutável, então os dados do envio ficam na proposta.
alter table proposals add column sent_version_id text references proposal_versions(id);
alter table proposals add column sent_at timestamptz;
alter table proposals add column valid_until date;
