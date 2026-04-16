/**
 * @deprecated Retained for DATA_SOURCE=hubspot rollback. Do not add new features.
 * Primary data source is SQL Server (sqlClient.ts).
 */
import { Account } from '../types';

interface CompanySearchResponse {
  results: Array<{
    id: string;
    properties: {
      hs_object_id?: string;
      name?: string;
      csm?: string;
      arr__annual_recurring_revenue_?: string;
      renewal_date?: string;
      hs_object_url?: string;
      domain?: string;
    };
  }>;
  paging?: {
    next: {
      after: string;
    };
  };
}

interface OwnerResponse {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Resolve a HubSpot user ID to name + email via the owners API.
 */
async function resolveOwner(
  apiKey: string,
  userId: string
): Promise<{ name: string; email: string } | null> {
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/owners/${userId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      `HubSpot API error (resolveOwner): ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as OwnerResponse;
  return {
    name: `${data.firstName} ${data.lastName}`.trim(),
    email: data.email,
  };
}

/**
 * Search for active HubSpot companies and map to Account.
 * CSM is stored as a user ID in the custom `csm` property and resolved
 * to a display name via the HubSpot owners API (results cached per sync).
 */
export async function searchActiveCompanies(
  apiKey: string
): Promise<Account[]> {
  const results: Account[] = [];
  const ownerCache = new Map<string, { name: string; email: string } | null>();
  let after: string | undefined;

  while (true) {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: 'active', operator: 'EQ', value: 'yes' },
          ],
        },
      ],
      properties: [
        'hs_object_id',
        'name',
        'csm',
        'arr__annual_recurring_revenue_',
        'renewal_date',
        'hs_object_url',
        'domain',
      ],
      limit: 100,
      ...(after && { after }),
    };

    const response = await fetch(
      'https://api.hubapi.com/crm/v3/objects/companies/search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(
        `HubSpot API error (searchActiveCompanies): ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as CompanySearchResponse;

    for (const result of data.results) {
      let csmName = '';
      let csmEmail = '';

      const csmUserId = result.properties.csm;
      if (csmUserId) {
        if (!ownerCache.has(csmUserId)) {
          ownerCache.set(csmUserId, await resolveOwner(apiKey, csmUserId));
        }
        const owner = ownerCache.get(csmUserId);
        if (owner) {
          csmName  = owner.name;
          csmEmail = owner.email;
        }
      }

      results.push({
        accountId:        result.id,
        hubspotCompanyId: result.id,
        accountName:      result.properties.name ?? '',
        csmName,
        csmEmail,
        arr:         Number(result.properties.arr__annual_recurring_revenue_ ?? 0),
        renewalDate: result.properties.renewal_date ?? '',
        hubspotUrl:  result.properties.hs_object_url ?? '',
        syncedAt:    new Date().toISOString(),
        licenses:    null, // manually entered in the UI; never synced from HubSpot
        domain:      result.properties.domain ?? '',
        hidden:      false,
        notes:       '', // preserved by Merge mode; never written from sync
      });
    }

    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }

  return results;
}
