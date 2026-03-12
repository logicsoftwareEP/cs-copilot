import { TableClient, odata } from '@azure/data-tables';
import { AmplitudeMapping } from '../types';

interface MappingEntity {
  partitionKey: string;
  rowKey: string;
  hubspotName: string;
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

function fromEntity(entity: MappingEntity): AmplitudeMapping {
  return {
    hubspotId: entity.rowKey,
    hubspotName: entity.hubspotName,
    amplitudeAlias: entity.amplitudeAlias,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class MappingStore {
  private client: TableClient;

  constructor(connectionString: string, tableName: string) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    try {
      await this.client.createTable();
    } catch (err: any) {
      if (err?.statusCode !== 409) throw err;
    }
  }

  async upsertMapping(hubspotId: string, hubspotName: string, amplitudeAlias: string): Promise<void> {
    const existing = await this.getMapping(hubspotId);
    const now = new Date().toISOString();

    const entity: MappingEntity = {
      partitionKey: 'mapping',
      rowKey: hubspotId,
      hubspotName,
      amplitudeAlias,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.client.upsertEntity(entity, 'Replace');
  }

  async listMappings(): Promise<AmplitudeMapping[]> {
    const results: AmplitudeMapping[] = [];
    for await (const entity of this.client.listEntities<MappingEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'mapping'` },
    })) {
      results.push(fromEntity(entity));
    }

    return results;
  }

  async getMapping(hubspotId: string): Promise<AmplitudeMapping | null> {
    try {
      const entity = await this.client.getEntity<MappingEntity>('mapping', hubspotId);
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async deleteMapping(hubspotId: string): Promise<void> {
    await this.client.deleteEntity('mapping', hubspotId);
  }
}