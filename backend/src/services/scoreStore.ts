import { TableClient, odata } from '@azure/data-tables';
import { ChurnScore, HealthTier } from '../types';

interface ScoreEntity {
  partitionKey: string;
  rowKey: string;
  score: number | null;
  tier: string;
  dauWauTrend: number | null;
  monthlyActiveUsers: number | null;
  licenseUtilization: number | null;
  featuresUsed: number | null;
  featureDetails: string | null;
  scoreDelta: number | null;
  computedAt: string;
  zendeskPenalty: number | null;
  zendeskDetails: string | null;
  intercomPenalty: number | null;
  intercomBonus: number | null;
  intercomDetails: string | null;
  cxScorePenalty: number | null;
  cxScoreBonus: number | null;
  aliasStatus?: string | null;
}

function fromEntity(entity: ScoreEntity): ChurnScore {
  return {
    accountId: entity.partitionKey,
    date: entity.rowKey,
    score: entity.score,
    tier: entity.tier as HealthTier | 'unmapped',
    dauWauTrend: entity.dauWauTrend,
    monthlyActiveUsers: entity.monthlyActiveUsers ?? null,
    licenseUtilization: entity.licenseUtilization ?? null,
    featuresUsed: entity.featuresUsed ?? null,
    featureDetails: entity.featureDetails ?? null,
    scoreDelta: entity.scoreDelta,
    computedAt: entity.computedAt,
    zendeskPenalty: entity.zendeskPenalty ?? null,
    zendeskDetails: entity.zendeskDetails ?? null,
    intercomPenalty: entity.intercomPenalty ?? null,
    intercomBonus: entity.intercomBonus ?? null,
    intercomDetails: entity.intercomDetails ?? null,
    cxScorePenalty: entity.cxScorePenalty ?? null,
    cxScoreBonus: entity.cxScoreBonus ?? null,
    aliasStatus: (entity.aliasStatus as 'valid' | 'not-found' | null) ?? null,
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

  async getLatestScoreForAccount(accountId: string): Promise<ChurnScore | null> {
    const cutoff = nDaysAgoISO(90);
    const rows: ChurnScore[] = [];

    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${accountId} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }

    if (rows.length === 0) return null;

    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows[0];
  }

  async getScoreHistory(accountId: string, days: number): Promise<ChurnScore[]> {
    const cutoff = nDaysAgoISO(days);
    const rows: ChurnScore[] = [];

    for await (const entity of this.client.listEntities<ScoreEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${accountId} and RowKey ge ${cutoff}`,
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

  async upsertScore(score: ChurnScore): Promise<void> {
    await this.client.upsertEntity({
      partitionKey: score.accountId,
      rowKey: score.date,
      score: score.score,
      tier: score.tier,
      dauWauTrend: score.dauWauTrend,
      monthlyActiveUsers: score.monthlyActiveUsers,
      licenseUtilization: score.licenseUtilization,
      featuresUsed: score.featuresUsed,
      featureDetails: score.featureDetails,
      scoreDelta: score.scoreDelta,
      computedAt: score.computedAt,
      zendeskPenalty: score.zendeskPenalty,
      zendeskDetails: score.zendeskDetails,
      intercomPenalty: score.intercomPenalty,
      intercomBonus: score.intercomBonus,
      intercomDetails: score.intercomDetails,
      cxScorePenalty: score.cxScorePenalty,
      cxScoreBonus: score.cxScoreBonus,
      aliasStatus: score.aliasStatus,
    }, 'Replace');
  }
}
