import type {
  Capability,
  CapabilityContext,
  CapabilityDescriptor,
} from './contracts';

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register<I, O>(capability: Capability<I, O>): void {
    const {id, description} = capability.descriptor;
    if (!id.trim() || !description.trim()) {
      throw new Error('A capability needs a stable ID and description.');
    }
    if (!Number.isInteger(capability.descriptor.contractVersion) || capability.descriptor.contractVersion < 1) {
      throw new Error(`Capability "${id}" needs a positive integer contract version.`);
    }
    if (this.capabilities.has(id)) {
      throw new Error(`Capability "${id}" is already registered.`);
    }
    this.capabilities.set(id, capability as Capability);
  }

  list(): CapabilityDescriptor[] {
    return [...this.capabilities.values()]
      .map(({descriptor}) => ({...descriptor}))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  async execute(id: string, input: unknown, context: CapabilityContext): Promise<unknown> {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new Error(`Capability "${id}" is not registered.`);
    }
    return capability.execute(input, context);
  }

  descriptor(id: string): CapabilityDescriptor {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new Error(`Capability "${id}" is not registered.`);
    }
    return {...capability.descriptor};
  }
}
