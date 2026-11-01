-- Link público da proposta: token aleatório (o id é adivinhável a partir do nome do cliente).
alter table proposals add column public_token text unique;
