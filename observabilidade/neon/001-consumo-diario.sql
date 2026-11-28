-- Histórico de auditoria do consumo de IA (spec ai-bom-consumo-tokens §4.6 e §6).
-- Aplicar no projeto Neon `ai-observabilidade` pelo driver HTTP (ADR-008).
create table consumo_diario (
  dia date not null,
  projeto text not null,
  origem text not null check (origem in ('local', 'ci')),
  modelo text not null,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  tokens_cache_leitura bigint not null default 0,
  tokens_cache_escrita bigint not null default 0,
  custo_usd numeric(12, 4) not null default 0,
  sessoes integer not null default 0,
  coletado_em timestamptz not null default now(),
  primary key (dia, projeto, origem, modelo)
);
