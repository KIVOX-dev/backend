const placementApplicationRepository = require('../repositories/placementApplication.repository');
const hrInterviewRepository = require('../repositories/hrInterview.repository');
const institutionRepository = require('../repositories/institution.repository');
const { ownedPlacements } = require('../utils/hrScope');
const { highestStageReached, STAGE_ORDER } = require('../utils/hrPipeline');
const ApiError = require('../utils/ApiError');

const DAY = 24 * 60 * 60 * 1000;
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);
const avg = (nums) => (nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null);
const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

const REACHED = { shortlisted: STAGE_ORDER.shortlisted, interview: STAGE_ORDER.interview, selected: STAGE_ORDER.selected, hired: STAGE_ORDER.hired };

// Metric definitions, echoed back in every response so a UI (or a reader of
// the JSON) never has to guess what a percentage is a percentage *of*.
const DEFINITIONS = {
  shortlisted: 'Candidates who reached Shortlisted or any later stage (even if later rejected).',
  interview_conversion_rate: 'Of candidates who reached Interview, the % who went on to be Selected or Hired.',
  shortlist_to_interview_rate: 'Of Shortlisted candidates, the % who reached Interview.',
  hiring_rate: 'Hired ÷ total applications, %.',
  time_to_hire_days: 'Days from the application being created to the Hired timestamp (hired candidates only).',
};

class HrAnalyticsService {
  async overview(actor, { placement_id: placementId, from, to } = {}) {
    const placements = await ownedPlacements(actor);
    let scoped = placements;
    if (placementId) {
      scoped = placements.filter((p) => p.id === placementId);
      if (scoped.length === 0) throw ApiError.forbidden('That vacancy is not yours');
    }
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lt = new Date(to);
    const ids = scoped.map((p) => p.id);
    const filter = { placement_id: { $in: ids }, ...(Object.keys(range).length ? { created_at: range } : {}) };
    const docs = ids.length ? await placementApplicationRepository.collection.find(filter).limit(50000).toArray() : [];
    const apps = docs.map((d) => placementApplicationRepository._toEntity(d));

    const interviewDocs = ids.length
      ? await hrInterviewRepository.collection.find({ placement_id: { $in: ids }, ...(Object.keys(range).length ? { scheduled_at: range } : {}) }).project({ status: 1, placement_id: 1 }).limit(50000).toArray()
      : [];

    const totals = this._funnel(apps);
    const byVacancy = scoped.map((p) => {
      const own = apps.filter((a) => a.placement_id === p.id);
      return {
        placement_id: p.id, title: p.title, company_name: p.company_name || null, status: p.status, openings: p.openings || null, posted_at: p.created_at,
        ...this._funnel(own),
        interviews_scheduled: interviewDocs.filter((i) => i.placement_id === p.id).length,
      };
    }).sort((a, b) => b.applications - a.applications);

    return {
      definitions: DEFINITIONS,
      range: { from: from || null, to: to || null },
      totals: {
        ...totals,
        vacancies: scoped.length,
        interviews_scheduled: interviewDocs.length,
        interviews_completed: interviewDocs.filter((i) => i.status === 'completed').length,
        interviews_cancelled: interviewDocs.filter((i) => i.status === 'cancelled').length,
        interviews_no_show: interviewDocs.filter((i) => i.status === 'no_show').length,
      },
      by_vacancy: byVacancy,
      funnel: this._funnelStages(apps),
      sources: this._sources(apps),
      rejection_reasons: this._rejectionReasons(apps),
      monthly_trend: this._monthly(apps),
      institutions: await this._institutions(apps),
    };
  }

  _funnel(apps) {
    const reached = (stage) => apps.filter((a) => highestStageReached(a) >= REACHED[stage]).length;
    const shortlisted = reached('shortlisted');
    const interviewed = reached('interview');
    const selected = reached('selected');
    const hired = apps.filter((a) => a.status === 'hired').length;
    const hireDays = apps.filter((a) => a.status === 'hired' && a.hired_at).map((a) => (new Date(a.hired_at) - new Date(a.created_at)) / DAY).filter((d) => d >= 0);
    return {
      applications: apps.length,
      shortlisted,
      interviewed,
      selected,
      hired,
      rejected: apps.filter((a) => a.status === 'rejected').length,
      withdrawn: apps.filter((a) => a.status === 'withdrawn').length,
      shortlist_to_interview_rate: pct(interviewed, shortlisted),
      interview_conversion_rate: pct(selected, interviewed),
      hiring_rate: pct(hired, apps.length),
      time_to_hire_days: { average: avg(hireDays), median: median(hireDays), fastest: hireDays.length ? Math.round(Math.min(...hireDays) * 10) / 10 : null, slowest: hireDays.length ? Math.round(Math.max(...hireDays) * 10) / 10 : null, sample_size: hireDays.length },
    };
  }

  _funnelStages(apps) {
    const stages = [
      ['applied', 0], ['screening', STAGE_ORDER.screening], ['shortlisted', STAGE_ORDER.shortlisted],
      ['interview', STAGE_ORDER.interview], ['selected', STAGE_ORDER.selected], ['hired', STAGE_ORDER.hired],
    ];
    const total = apps.length;
    const counts = stages.map(([, order]) => apps.filter((x) => highestStageReached(x) >= order).length);
    return stages.map(([stage], i) => ({
      stage,
      count: counts[i],
      percent_of_applicants: pct(counts[i], total),
      drop_off_from_previous: i === 0 ? null : pct(counts[i - 1] - counts[i], counts[i - 1]),
    }));
  }

  _sources(apps) {
    const map = new Map();
    for (const a of apps) {
      const key = a.source || 'direct_application';
      const row = map.get(key) || { source: key, applications: 0, shortlisted: 0, hired: 0 };
      row.applications += 1;
      if (highestStageReached(a) >= REACHED.shortlisted) row.shortlisted += 1;
      if (a.status === 'hired') row.hired += 1;
      map.set(key, row);
    }
    return [...map.values()].map((r) => ({ ...r, hire_rate: pct(r.hired, r.applications) })).sort((a, b) => b.applications - a.applications);
  }

  _rejectionReasons(apps) {
    const map = new Map();
    for (const a of apps.filter((x) => x.status === 'rejected')) map.set(a.rejection_reason || 'unspecified', (map.get(a.rejection_reason || 'unspecified') || 0) + 1);
    return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  }

  _monthly(apps) {
    const map = new Map();
    for (const a of apps) {
      const d = new Date(a.created_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = map.get(key) || { month: key, applications: 0, hired: 0 };
      row.applications += 1;
      if (a.status === 'hired') row.hired += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }

  // Where candidates come from, by college.
  async _institutions(apps) {
    const counts = new Map();
    for (const a of apps) if (a.institution_id) counts.set(a.institution_id, (counts.get(a.institution_id) || 0) + 1);
    if (counts.size === 0) return [];
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const insts = await institutionRepository.findByIds(top.map(([id]) => id));
    const nameById = new Map(insts.map((i) => [i.id, i.name]));
    return top.map(([id, count]) => ({ institution_id: id, name: nameById.get(id) || null, applications: count, hired: apps.filter((a) => a.institution_id === id && a.status === 'hired').length }));
  }
}

module.exports = new HrAnalyticsService();
