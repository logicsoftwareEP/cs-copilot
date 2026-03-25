import { TableClient } from '@azure/data-tables';

export interface SyncStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export class SyncStatusStore {
  private client: TableClient;

  constructor(connectionString: string) {
    this.client = TableClient.fromConnectionString(connectionString, 'syncstatus');
  }

  async ensureTable(): Promise<void> {
    await this.client.createTable();
  }

  async setRunning(): Promise<void> {
    await this.client.upsertEntity({
      partitionKey: 'sync',
      rowKey: 'status',
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: '',
      error: '',
    }, 'Replace');
  }

  async setCompleted(): Promise<void> {
    await this.client.upsertEntity({
      partitionKey: 'sync',
      rowKey: 'status',
      status: 'completed',
      completedAt: new Date().toISOString(),
    }, 'Replace');
  }

  async setFailed(error: string): Promise<void> {
    await this.client.upsertEntity({
      partitionKey: 'sync',
      rowKey: 'status',
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
    }, 'Replace');
  }

  async getStatus(): Promise<SyncStatus> {
    try {
      const entity = await this.client.getEntity('sync', 'status');
      const result: SyncStatus = { status: entity.status as SyncStatus['status'] };
      if (entity.startedAt) result.startedAt = entity.startedAt as string;
      if (entity.completedAt) result.completedAt = entity.completedAt as string;
      if (entity.error) result.error = entity.error as string;
      return result;
    } catch (err: any) {
      if (err?.statusCode === 404) return { status: 'idle' };
      throw err;
    }
  }
}
