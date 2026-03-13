import { HubspotAccount } from '../types';

interface CompanySearchResponse {
  results: Array<{
    id: string;
    properties: {
      hs_object_id?: string;
      name?: string;
      hubspot_owner_id?: string;
      arr__annual_recurring_revenue_?: string;
      renewal_date?: string;
      hs_object_url?: string;
    };
  }>;
  paging?: {
    next: {
      after: string;
    };
  };
}

interface OwnerResponse {
  firstname: string;
  lastname: string;
  email: string;
}

/**
 * Resolve owner details by ownerId
 */
async function resolveOwner(
  apiKey: string,
  ownerId: string
): Promise<{ firstname: string; lastname: string; email: string } | null> {
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/owners/${ownerId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `HubSpot API error (resolveOwner): ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as OwnerResponse;
  return {
    firstname: data.firstname,
    lastname: data.lastname,
    email: data.email,
  };
}

/**
 * Search for active HubSpot companies and map to HubspotAccount
 */
export async function searchActiveCompanies(
  apiKey: string
): Promise<HubspotAccount[]> {
  const results: HubspotAccount[] = [];
  const ownerCache = new Map<
    string,
    { firstname: string; lastname: string; email: string } | null
  >();

  let after: string | undefined;

  // Pagination loop
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
        'hubspot_owner_id',
        'arr__annual_recurring_revenue_',
        'renewal_date',
        'hs_object_url',
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

    // Process each result
    for (const result of data.results) {
      let csmName = '';
      let csmEmail = '';

      // Resolve owner if present
      if (result.properties.hubspot_owner_id) {
        const ownerId = result.properties.hubspot_owner_id;

        // Check cache first
        if (!ownerCache.has(ownerId)) {
          ownerCache.set(ownerId, await resolveOwner(apiKey, ownerId));
        }

        const owner = ownerCache.get(ownerId);
        if (owner) {
          csmName = `${owner.firstname} ${owner.lastname}`;
          csmEmail = owner.email;
        }
      }

      const account: HubspotAccount = {
        hubspotId: result.id,
        accountName: result.properties.name ?? '',
        csmName,
        csmEmail,
        arr: Number(result.properties.arr__annual_recurring_revenue_ ?? 0),
        renewalDate: result.properties.renewal_date ?? '',
        hubspotUrl: result.properties.hs_object_url ?? '',
        syncedAt: new Date().toISOString(),
      };

      results.push(account);
    }

    // Check for pagination
    if (!data.paging?.next?.after) {
      break;
    }

    after = data.paging.next.after;
  }

  return results;
}
