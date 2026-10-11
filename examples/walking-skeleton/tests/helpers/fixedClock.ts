import type { Clock } from '@/shared/kernel'

export const fixedClock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') }
