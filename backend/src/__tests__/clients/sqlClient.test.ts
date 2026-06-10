// Unit tests for exportScoresToSql. mssql is fully mocked — no real network.
jest.mock('mssql', () => {
  const begin = jest.fn().mockResolvedValue(undefined);
  const commit = jest.fn().mockResolvedValue(undefined);
  const rollback = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn().mockResolvedValue({ recordset: [] });
  const bulk = jest.fn().mockResolvedValue({ rowsAffected: 0 });
  const tables: any[] = [];

  class MockTable {
    // Mirrors real mssql Table parsing: 'schema.table' → name/schema/path
    name: string;
    schema: string | null;
    path: string;
    create = true;
    columnList: any[] = [];
    rowList: any[] = [];
    columns = { add: (...args: any[]) => this.columnList.push(args) };
    rows = { add: (...args: any[]) => this.rowList.push(args) };
    constructor(input: string) {
      const parts = input.split('.');
      this.name = parts[parts.length - 1];
      this.schema = parts.length > 1 ? parts[parts.length - 2] : null;
      this.path = parts.map(p => `[${p}]`).join('.');
      tables.push(this);
    }
  }
  class MockTransaction {
    begin = begin;
    commit = commit;
    rollback = rollback;
  }
  class MockRequest {
    query = query;
    bulk = bulk;
  }
  class MockConnectionPool {
    connected = true;
    connect = jest.fn().mockImplementation(async () => this);
    request = () => new MockRequest();
  }

  return {
    __esModule: true,
    default: {
      ConnectionPool: MockConnectionPool,
      Transaction: MockTransaction,
      Request: MockRequest,
      Table: MockTable,
      UniqueIdentifier: 'UniqueIdentifier',
      Int: 'Int',
      NVarChar: (n: number) => `NVarChar(${n})`,
      Date: 'SqlDate',
      DateTime2: 'DateTime2',
      __mocks: { begin, commit, rollback, query, bulk, tables },
    },
  };
});

import { exportScoresToSql, ScoreExportRow } from '../../clients/sqlClient';

const { begin, commit, rollback, query, bulk, tables } =
  jest.requireMock('mssql').default.__mocks;

const CONN = 'Server=tcp:test.database.windows.net,1433;Database=TestDB';
const ROW_A: ScoreExportRow = {
  clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  score: 75,
  tier: 'healthy',
  scoreDate: '2026-06-10',
};
const ROW_B: ScoreExportRow = {
  clientId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  score: null,
  tier: 'unmapped',
  scoreDate: '2026-06-10',
};

beforeEach(() => {
  jest.clearAllMocks();
  tables.length = 0;
});

describe('exportScoresToSql', () => {
  it('deletes existing rows then bulk-inserts the snapshot in one transaction', async () => {
    const written = await exportScoresToSql(CONN, 'user', 'pass', [ROW_A, ROW_B]);

    expect(written).toBe(2);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM [analytics].[AccountHealthScores]')
    );
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    // Table targets the right name and carries both rows
    expect(tables).toHaveLength(1);
    expect(tables[0].path).toBe('[analytics].[AccountHealthScores]');
    expect(tables[0].schema).toBe('analytics');
    expect(tables[0].create).toBe(false);
    expect(tables[0].rowList).toHaveLength(2);
    // Row shape: [ClientId, Score, Tier, ScoreDate, UpdatedAt]
    expect(tables[0].rowList[0][0]).toBe(ROW_A.clientId);
    expect(tables[0].rowList[0][1]).toBe(75);
    expect(tables[0].rowList[0][2]).toBe('healthy');
    expect(tables[0].rowList[0][3]).toEqual(new Date('2026-06-10'));
    expect(tables[0].rowList[0][4]).toBeInstanceOf(Date);
  });

  it('maps a null score to a NULL column value', async () => {
    await exportScoresToSql(CONN, 'user', 'pass', [ROW_B]);

    expect(tables[0].rowList[0][1]).toBeNull();
    expect(tables[0].rowList[0][2]).toBe('unmapped');
  });

  it('is a no-op for an empty snapshot — never wipes the table', async () => {
    const written = await exportScoresToSql(CONN, 'user', 'pass', []);

    expect(written).toBe(0);
    expect(begin).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows on a non-transient bulk failure', async () => {
    bulk.mockRejectedValueOnce(new Error('String or binary data would be truncated'));

    await expect(
      exportScoresToSql(CONN, 'user', 'pass', [ROW_A])
    ).rejects.toThrow('String or binary data would be truncated');

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('retries the whole transaction on a transient error, then succeeds', async () => {
    const transientErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    bulk.mockRejectedValueOnce(transientErr);

    const written = await exportScoresToSql(CONN, 'user', 'pass', [ROW_A]);

    expect(written).toBe(1);
    expect(begin).toHaveBeenCalledTimes(2);   // first attempt + retry
    expect(rollback).toHaveBeenCalledTimes(1); // failed attempt rolled back
    expect(commit).toHaveBeenCalledTimes(1);   // retry committed
  }, 15000); // retry sleeps 1s — allow headroom
});
