import { AggregateRoot, type Clock } from '@/shared/kernel'
import { ResourceId } from './ResourceId'
import { Title } from './Title'

export interface ResourceSnapshot {
  id: string
  tenantId: string
  ownerId: string
  title: string
  createdAt: Date
}

export class Resource extends AggregateRoot {
  private constructor(
    readonly id: ResourceId,
    readonly tenantId: string,
    readonly ownerId: string,
    readonly title: Title,
    readonly createdAt: Date
  ) {
    super()
  }

  static create(props: { tenantId: string; ownerId: string; title: Title }, clock: Clock): Resource {
    return new Resource(ResourceId.new(), props.tenantId, props.ownerId, props.title, clock.now())
  }

  static rehydrate(s: ResourceSnapshot): Resource {
    return new Resource(ResourceId.of(s.id), s.tenantId, s.ownerId, Title.of(s.title), new Date(s.createdAt))
  }

  toSnapshot(): ResourceSnapshot {
    return {
      id: this.id.value,
      tenantId: this.tenantId,
      ownerId: this.ownerId,
      title: this.title.value,
      createdAt: new Date(this.createdAt),
    }
  }
}
