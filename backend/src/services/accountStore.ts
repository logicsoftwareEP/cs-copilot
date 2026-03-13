import { TableClient, odata } from '@azure/data-tables';
import { HubspotAccount } from '../types';

interface AccountEntity {
  partitionKey: string;
  rowKey: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;
  hubspotUrl: string;
  syncedAt: string;
  licenses?: number | null;
}

/**
 * Map a HubspotAccount to a Table Storage entity for sync writes.
 * NOTE: `licenses` is intentionally excluded so that Merge mode
 * preserves any manually-entered value already in the table.
 */
function toEntity(account: HubspotAccount): Omit<AccountEntity, 'licenses'> {
  return {
    partitionKey: 'accounts',
    rowKey: account.hubspotId,
    accountName: account.accountName,
    csmName: account.csmName,
    csmEmail: account.csmEmail,
    arr: account.arr,
    renewalDate: account.renewalDate,
    hubspotUrl: account.hubspotUrl,
    syncedAt: account.syncedAt,
  };
}

function fromEntity(entity: AccountEntity): HubspotAccount {
  return {
    hubspotId: entity.rowKey,
    accountName: entity.accountName,
    csmName: entity.csmName,
    csmEmail: entity.csmEmail,
    arr: entity.arr,
    renewalDate: entity.renewalDate,
    hubspotUrl: entity.hubspotUrl,
    syncedAt: entity.syncedAt,
    licenses: entity.licenses ?? null,
  };
}

export class AccountStore {
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

  /**
   * Upsert account data from HubSpot using Merge mode so that manually-entered
   * fields (e.g. `licenses`) are never overwritten by the nightly sync.
   */
  async upsertAccount(account: HubspotAccount): Promise<void> {
    await this.client.upsertEntity(toEntity(account), 'Merge');
  }

  async listAccounts(): Promise<HubspotAccount[]> {
    const results: HubspotAccount[] = [];
    for await (const entity of this.client.listEntities<AccountEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'accounts'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async getById(hubspotId: string): Promise<HubspotAccount | null> {
    try {
      const entity = await this.client.getEntity<AccountEntity>('accounts', hubspotId);
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Update the license count for a single account.
   * Uses Merge mode so only `licenses` is written; all other fields are preserved.
   */
  async updateLicenses(hubspotId: string, licenses: number | null): Promise<void> {
    await this.client.upsertEntity(
      { partitionKey: 'accounts', rowKey: hubspotId, licenses },
      'Merge'
    );
  }
}
