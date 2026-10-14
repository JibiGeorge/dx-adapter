export interface BrokerPolicy {
  polId: number;
  polNo: string;
  planName: string;
  polHolderName: string;
  startDate: unknown;
  endDate: unknown;
  dbType: string;
  corpId: number;
}

type PolicyRecord = Record<string, any>;

const firstDefined = (...values: unknown[]): any =>
  values.find((value) => value !== null && value !== undefined);

const toNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toString = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

const uniqueByPolicyId = <T>(
  items: T[],
  getId: (item: T) => number,
): T[] => {
  const seen = new Set<number>();

  return items.filter((item) => {
    const id = getId(item);

    if (id <= 0 || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
};

export function mapAgentPolicies(
  items: PolicyRecord[],
): BrokerPolicy[] {
  return uniqueByPolicyId(items, (p) =>
    toNumber(firstDefined(p.PolicyId, p.policyId)),
  ).map((p) => ({
    polId: toNumber(firstDefined(p.PolicyId, p.policyId)),
    polNo: toString(firstDefined(p.PolicyNumber, p.policyNumber)),
    planName: toString(
      firstDefined(
        p.PlanName,
        p.planName,
        p.PolicyType,
        p.policyType,
      ),
    ),
    polHolderName: toString(
      firstDefined(
        p.PolicyHolderName,
        p.policyHolderName,
        p.PolHldrName,
      ),
    ),
    startDate: firstDefined(
      p.StartDate,
      p.startDate,
      p.polStartDate,
      p.PolStartDate,
      '',
    ),
    endDate: firstDefined(
      p.EndDate,
      p.endDate,
      p.polEndDate,
      p.PolEndDate,
      '',
    ),
    dbType: toString(firstDefined(p.DBType, p.dbType)),
    corpId: toNumber(
      firstDefined(p.CorporateId, p.corporateId),
    ),
  }));
}

export function mapFallbackPolicies(
  items: PolicyRecord[],
): BrokerPolicy[] {
  return uniqueByPolicyId(items, (p) =>
    toNumber(firstDefined(p.polID, p.polId)),
  ).map((p) => ({
    polId: toNumber(firstDefined(p.polID, p.polId)),
    polNo: toString(
      firstDefined(p.polInsurerPolNo, p.policyNumber),
    ),
    planName: toString(
      firstDefined(
        p.planName,
        p.PlanName,
        p.planType,
      ),
    ),
    polHolderName: toString(
      firstDefined(
        p.polHolderName,
        p.PolicyHolderName,
        p.PolHldrName,
      ),
    ),
    startDate: firstDefined(
      p.startDate,
      p.StartDate,
      p.polStartDate,
      p.PolStartDate,
      '',
    ),
    endDate: firstDefined(
      p.endDate,
      p.EndDate,
      p.polEndDate,
      p.PolEndDate,
      '',
    ),
    dbType: toString(
      firstDefined(p.dbType, p.sourceDBType),
    ),
    corpId: toNumber(
      firstDefined(
        p.pol_CorporateId,
        p.CorporateId,
        p.corporateId,
        p.CorpId,
        p.corpId,
      ),
    ),
  }));
}
