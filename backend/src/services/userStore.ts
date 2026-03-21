import { TableClient, odata } from '@azure/data-tables';
import { User, UserRole } from '../types';

interface UserEntity {
  partitionKey: string;
  rowKey: string;
  displayName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

function fromEntity(entity: UserEntity): User {
  return {
    email: entity.rowKey,
    displayName: entity.displayName,
    role: entity.role as UserRole,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class UserStore {
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

  async getUser(email: string): Promise<User | null> {
    try {
      const entity = await this.client.getEntity<UserEntity>('users', email.toLowerCase());
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async listUsers(): Promise<User[]> {
    const results: User[] = [];
    for await (const entity of this.client.listEntities<UserEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'users'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async upsertUser(email: string, displayName: string, role: UserRole): Promise<void> {
    const key = email.toLowerCase();
    const existing = await this.getUser(key);
    await this.client.upsertEntity<UserEntity>(
      {
        partitionKey: 'users',
        rowKey: key,
        displayName,
        role,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'Replace'
    );
  }

  async deleteUser(email: string): Promise<void> {
    await this.client.deleteEntity('users', email.toLowerCase());
  }
}
