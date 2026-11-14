import type {
  Capability,
  CapabilityContext,
  CapabilityDescriptor,
} from './contracts';
import {readFileSync} from 'node:fs';

type JsonSchema = Record<string, unknown>;
type CapabilityContract = {
  id: string;
  contractVersion: number;
  screen: CapabilityDescriptor['screen'];
  permission: CapabilityDescriptor['permission'];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

const manifest = JSON.parse(readFileSync(new URL('../capabilities.json', import.meta.url), 'utf8')) as {
  capabilities: CapabilityContract[];
};

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

  list(): Array<CapabilityDescriptor & Pick<CapabilityContract, 'inputSchema' | 'outputSchema'>> {
    if (this.capabilities.size !== manifest.capabilities.length) {
      throw new Error('Registered capabilities do not match the published capability contract manifest.');
    }
    return [...this.capabilities.values()].map(({descriptor}) => {
      const contract = manifest.capabilities.find(({id}) => id === descriptor.id);
      if (!contract || contract.contractVersion !== descriptor.contractVersion ||
          contract.screen !== descriptor.screen || contract.permission !== descriptor.permission) {
        throw new Error(`Capability "${descriptor.id}" does not match its published contract metadata.`);
      }
      return {...descriptor, inputSchema: contract.inputSchema, outputSchema: contract.outputSchema};
    }).sort((a, b) => a.id.localeCompare(b.id));
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
