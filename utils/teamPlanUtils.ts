export const TEAM_PLAN_MIN = 1;
export const AD_TIER_MAX = 3;
export const TEAM_PLAN_MAX = 10;
export const PRICE_PER_USER = 1000;

const TEAM_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-sky-100 text-sky-700',
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-purple-100 text-purple-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-pink-100 text-pink-700',
  'bg-rose-100 text-rose-700',
];

export type PlanInfo = {
  key: string;
  label: string;
  max: number;
  price: number;
  color: string;
};

export const teamPlanKey = (count: number): string => `u${count}`;

export const parseTeamPlanMax = (plan?: string | null): number | null => {
  const match = String(plan || '').match(/^u(\d+)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
};

export const isTeamUserPlan = (plan?: string | null): boolean => parseTeamPlanMax(plan) !== null;

export const getPlanInfo = (plan?: string | null): PlanInfo => {
  const key = String(plan || 'ad').toLowerCase();

  if (key === 'ad' || key === 'free' || key === 'lite') {
    return { key: 'ad', label: '광고형', max: AD_TIER_MAX, price: 0, color: 'bg-gray-100 text-gray-600' };
  }
  if (key === 'service') {
    return { key: 'service', label: '무료 사용자', max: 999, price: 0, color: 'bg-amber-100 text-amber-700' };
  }

  const n = parseTeamPlanMax(key);
  if (n !== null && n >= 1) {
    const idx = Math.min(Math.max(n - TEAM_PLAN_MIN, 0), TEAM_COLORS.length - 1);
    return {
      key,
      label: `${n}인 사용`,
      max: n,
      price: n * PRICE_PER_USER,
      color: TEAM_COLORS[idx] || TEAM_COLORS[0],
    };
  }

  return { key: 'ad', label: '광고형', max: AD_TIER_MAX, price: 0, color: 'bg-gray-100 text-gray-600' };
};

export const buildTeamPlanOptions = (): PlanInfo[] => {
  const options: PlanInfo[] = [getPlanInfo('ad')];
  for (let n = TEAM_PLAN_MIN; n <= TEAM_PLAN_MAX; n++) {
    options.push(getPlanInfo(teamPlanKey(n)));
  }
  options.push(getPlanInfo('service'));
  return options;
};

export const isPaidTeamPlanCode = (plan?: string | null): boolean => {
  const key = String(plan || '').toLowerCase();
  if (['pro', 'pro_plus', 'service'].includes(key)) return true;
  return isTeamUserPlan(key);
};