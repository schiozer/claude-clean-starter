/**
 * Raiz de agregado: único ponto de entrada para mudar o estado do agregado.
 * Domain events entram aqui só quando houver um consumidor real (ADR-011).
 */
export abstract class AggregateRoot {}
