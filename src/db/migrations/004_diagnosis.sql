-- Transcrição do diagnóstico (já sem dados pessoais) e sugestões da IA com o que foi descartado.
create table transcripts (
  id text primary key,
  proposal_id text not null references proposals(id),
  kind text not null default 'DIAGNOSTICO',
  text_redacted text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table ai_suggestions (
  id text primary key,
  transcript_id text not null references transcripts(id),
  model text not null,
  accepted jsonb not null,
  discarded jsonb not null,
  created_by text,
  created_at timestamptz not null default now()
);

create trigger transcripts_immutable before update or delete on transcripts for each row execute function forbid_mutation();
create trigger ai_suggestions_immutable before update or delete on ai_suggestions for each row execute function forbid_mutation();
