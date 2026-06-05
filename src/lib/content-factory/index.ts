/**
 * Content Factory – Feature-gated innholdsproduksjonssystem
 * IKKE aktivt i produksjon. Krev CONTENT_FACTORY_ENABLED=true
 */

export function isContentFactoryEnabled(): boolean {
  return process.env.CONTENT_FACTORY_ENABLED === 'true';
}

export function assertContentFactoryEnabled(): void {
  if (!isContentFactoryEnabled()) {
    throw new Error('Content Factory er ikke aktivert. Sett CONTENT_FACTORY_ENABLED=true');
  }
}

export * from './types';
export * from './vod/vodService';
export * from './analysis/highlightDiscovery';
export * from './ranking/highlightRanker';
export * from './copywriter/copywriterService';
export * from './review/reviewQueue';
export * from './jobs/orchestrator';
