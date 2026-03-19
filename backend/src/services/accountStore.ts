import { TableClient, odata } from '@azure/data-tables';
import { Account } from '../types';

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
  domain?: string;
  hidden?: boolean;
}

/**
 * Map an Account to a Table Storage entity for sync writes.
 * NOTE: `licenses` is intentionally excluded so that Merge mode
 * preserves any manually-entered value already in the table.
 * `domain` is only written when non-empty to avoid overwriting a
 * manually-corrected value with a blank string.
 */
function toEntity(account: Account): Omit<AccountEntity, 'licenses'> {
  const entity: Record<string, unknown> = {
    partitionKey: 'accounts',
    rowKey: account.accountId,
    accountName: account.accountName,
    csmName: account.csmName,
    csmEmail: account.csmEmail,
    renewalDate: account.renewalDate,
    hubspotUrl: account.hubspotUrl,
    syncedAt: account.syncedAt,
  };
  // Only write ARR when upstream has a value; skip 0 to preserve CSV/manual entries
  if (account.arr > 0) entity.arr = account.arr;
  // Only write domain when non-empty to avoid overwriting manual corrections
  if (account.domain) entity.domain = account.domain;
  return entity as Omit<AccountEntity, 'licenses'>;
}

function fromEntity(entity: AccountEntity): Account {
  return {
    accountId: entity.rowKey,
    accountName: entity.accountName,
    csmName: entity.csmName,
    csmEmail: entity.csmEmail,
    arr: entity.arr,
    renewalDate: entity.renewalDate,
    hubspotUrl: entity.hubspotUrl,
    syncedAt: entity.syncedAt,
    licenses: entity.licenses ?? null,
    domain: entity.domain ?? '',
    hidden: entity.hidden ?? false,
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
   * Upsert account data using Merge mode so that manually-entered
   * fields (e.g. `licenses`) are never overwritten by the nightly sync.
   */
  async upsertAccount(account: Account): Promise<void> {
    await this.client.upsertEntity(toEntity(account), 'Merge');
  }

  async listAccounts(): Promise<Account[]> {
    const results: Account[] = [];
    for await (const entity of this.client.listEntities<AccountEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'accounts'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async getById(accountId: string): Promise<Account | null> {
    try {
      const entity = await this.client.getEntity<AccountEntity>('accounts', accountId);
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Update the licence count for a single account.
   * Uses Merge mode so only `licenses` is written; all other fields are preserved.
   */
  async updateLicenses(accountId: string, licenses: number | null): Promise<void> {
    await this.client.upsertEntity(
      { partitionKey: 'accounts', rowKey: accountId, licenses },
      'Merge'
    );
  }

  /**
   * Update the ARR for a single account.
   * Uses Merge mode so only `arr` is written; all other fields are preserved.
   */
  async updateArr(accountId: string, arr: number): Promise<void> {
    await this.client.upsertEntity(
      { partitionKey: 'accounts', rowKey: accountId, arr },
      'Merge'
    );
  }

  /**
   * Update the hidden flag for a single account.
   * Uses Merge mode so only `hidden` is written; all other fields are preserved.
   */
  async updateHidden(accountId: string, hidden: boolean): Promise<void> {
    await this.client.upsertEntity(
      { partitionKey: 'accounts', rowKey: accountId, hidden },
      'Merge'
    );
  }
}
