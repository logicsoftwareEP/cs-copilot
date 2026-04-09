import { TableClient, odata } from '@azure/data-tables';
import { IntercomDailySnapshot } from '../clients/intercomClient';

/**
 * Aggregated Intercom metrics for a domain over a rolling window (typically 30 days).
 *
 * - conversationVolume: SUM of daily volumes
 * - openCount: value from the most recent snapshot (LATEST)
 * - avgResponseTime: true weighted average across snapshots (totalResponseTime / responseCount)
 * - quickResolutions: SUM across snapshots
 * - aiHandled: SUM across snapshots
 */
export interface IntercomAggregated {
  conversationVolume: number;
  openCount: number;
  avgResponseTime: number;
  quickResolutions: number;
  aiHandled: number;
  avgCxScore: number | null;
  cxScoreCount: number;
}

interface IntercomEntity {
  partitionKey: string; // domain
  rowKey: string;       // date (YYYY-MM-DD)
  conversationVolume: number;
  openCount: number;
  avgResponseTime: number;
  quickResolutions: number;
  aiHandled: number;
  totalResponseTime: number;
  responseCount: number;
  cxScoreTotal: number;
  cxScoreCount: number;
}

function toEntity(domain: string, date: string, data: IntercomDailySnapshot): IntercomEntity {
  return {
    partitionKey: domain,
    rowKey: date,
    conversationVolume: data.conversationVolume,
    openCount: data.openCount,
    avgResponseTime: data.avgResponseTime,
    quickResolutions: data.quickResolutions,
    aiHandled: data.aiHandled,
    totalResponseTime: data.totalResponseTime,
    responseCount: data.responseCount,
    cxScoreTotal: data.cxScoreTotal,
    cxScoreCount: data.cxScoreCount,
  };
}

function fromEntity(entity: IntercomEntity): IntercomDailySnapshot & { date: string } {
  return {
    date: entity.rowKey,
    conversationVolume: entity.conversationVolume,
    openCount: entity.openCount,
    avgResponseTime: entity.avgResponseTime,
    quickResolutions: entity.quickResolutions,
    aiHandled: entity.aiHandled,
    totalResponseTime: entity.totalResponseTime,
    responseCount: entity.responseCount,
    cxScoreTotal: entity.cxScoreTotal ?? 0,
    cxScoreCount: entity.cxScoreCount ?? 0,
  };
}

function nDaysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export class IntercomStore {
  private client: TableClient;

  constructor(connectionString: string, tableName = 'intercomscores') {
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
   * Upsert a daily snapshot for a domain.
   * partitionKey = domain, rowKey = date (YYYY-MM-DD).
   */
  async upsertSnapshot(domain: string, date: string, data: IntercomDailySnapshot): Promise<void> {
    await this.client.upsertEntity(toEntity(domain, date, data), 'Replace');
  }

  /**
   * Return all snapshots for a domain within the last `days` days, sorted newest-first.
   */
  async getSnapshots(domain: string, days: number): Promise<Array<IntercomDailySnapshot & { date: string }>> {
    const cutoff = nDaysAgoISO(days);
    const rows: Array<IntercomDailySnapshot & { date: string }> = [];

    for await (const entity of this.client.listEntities<IntercomEntity>({
      queryOptions: {
        filter: odata`PartitionKey eq ${domain} and RowKey ge ${cutoff}`,
      },
    })) {
      rows.push(fromEntity(entity));
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }

  /**
   * Aggregate a list of snapshots into a single IntercomAggregated value.
   *
   * - conversationVolume, quickResolutions, aiHandled: summed across all snapshots
   * - openCount: taken from the most recent snapshot (latest date)
   * - avgResponseTime: weighted average using totalResponseTime / responseCount across all snapshots
   */
  aggregate(snapshots: Array<IntercomDailySnapshot & { date: string }>): IntercomAggregated {
    if (snapshots.length === 0) {
      return { conversationVolume: 0, openCount: 0, avgResponseTime: 0, quickResolutions: 0, aiHandled: 0, avgCxScore: null, cxScoreCount: 0 };
    }

    let conversationVolume = 0;
    let quickResolutions = 0;
    let aiHandled = 0;
    let totalResponseTime = 0;
    let responseCount = 0;
    let cxScoreTotal = 0;
    let cxScoreCount = 0;

    // Snapshots are expected to be sorted newest-first; take openCount from the first entry.
    const openCount = snapshots[0].openCount;

    for (const s of snapshots) {
      conversationVolume += s.conversationVolume;
      quickResolutions += s.quickResolutions;
      aiHandled += s.aiHandled;
      totalResponseTime += s.totalResponseTime;
      responseCount += s.responseCount;
      cxScoreTotal += s.cxScoreTotal;
      cxScoreCount += s.cxScoreCount;
    }

    const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;
    const avgCxScore = cxScoreCount > 0 ? cxScoreTotal / cxScoreCount : null;

    return { conversationVolume, openCount, avgResponseTime, quickResolutions, aiHandled, avgCxScore, cxScoreCount };
  }

  /**
   * Return all snapshots across all domains within the last `days` days, sorted newest-first.
   * Each returned item includes a `domain` field (the partitionKey).
   */
  async getAllSnapshots(days: number): Promise<Array<IntercomDailySnapshot & { date: string; domain: string }>> {
    const cutoff = nDaysAgoISO(days);
    const rows: Array<IntercomDailySnapshot & { date: string; domain: string }> = [];

    for await (const entity of this.client.listEntities<IntercomEntity>({
      queryOptions: {
        filter: odata`RowKey ge ${cutoff}`,
      },
    })) {
      rows.push({ ...fromEntity(entity), domain: entity.partitionKey });
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }

  /**
   * Delete snapshots older than `days` days. Returns the number of rows deleted.
   */
  async cleanup(days: number): Promise<number> {
    const cutoff = nDaysAgoISO(days);
    let deleted = 0;

    // List all entities with RowKey (date) strictly less than the cutoff.
    // Table Storage filter: RowKey lt cutoff means date < cutoff (ISO strings sort lexicographically).
    for await (const entity of this.client.listEntities<IntercomEntity>({
      queryOptions: {
        filter: odata`RowKey lt ${cutoff}`,
      },
    })) {
      await this.client.deleteEntity(entity.partitionKey, entity.rowKey);
      deleted++;
    }

    return deleted;
  }
}
