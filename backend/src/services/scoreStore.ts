import { TableClient, odata } from '@azure/data-tables';
import { ChurnScore, HealthTier } from '../types';

interface ScoreEntity {
  partitionKey: string;
  rowKey: string;
  score: number | null;
  tier: string;
  dauWauTrend: number | null;
  featureAdoption: number | null;
  lastLoginDays: number | null;
  scoreDelta: number | null;
  computedAt: string;
}

function fromEntity(entity: ScoreEntity): ChurnScore {
  return {
    hubspotId: entity.partitionKey,
    date: entity.rowKey,
    score: entity.score,
    tier: entity.tier as HealthTier | 'unmapped',
    dauWauTrend: entity.dauWauTrend,
    featureAdoption: entity.featureAdoption,
    lastLoginDays: entity.lastLoginDays,
    scoreDelta: entity.scoreDelta,
    computedAt: entity.computedAt,
  };
}

function nDaysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export class ScoreStore {
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

  async getLatestScoreForAccount(hubspotId: string): Promise<ChurnScore | null> {
    const cutoff = nDaysAgoISO(90);
    const rows: ChurnScore[] = [];

    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${hubspotId} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }

    if (rows.length === 0) return null;

    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows[0];
  }

  async getScoreHistory(hubspotId: string, days: number): Promise<ChurnScore[]> {
    const cutoff = nDaysAgoISO(days);
    const rows: ChurnScore[] = [];

    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${hubspotId} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }

  async getAllScoresForDate(date: string): Promise<Map<string, ChurnScore>> {
    const result = new Map<string, ChurnScore>();

    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: { filter: odata`RowKey eq ${date}` },
    })) {
      result.set(entity.partitionKey, fromEntity(entity));
    }

    return result;
  }
}