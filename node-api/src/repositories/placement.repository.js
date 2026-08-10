const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/placement.model');

class PlacementRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // Backs PlacementService#list for every non-super-admin actor. A plain
  // `institution_id` equality filter (BaseRepository._buildFilter's usual
  // path) would hide every HR/recruiter-posted job — those rows never carry
  // an institution_id at all (see PlacementService#create: only
  // institution_admin postings set it) — so callers browsing the general
  // list would see nothing but their own college's drives. This keeps both
  // halves of "placements relevant to them" visible: their own
  // institution's drives, plus every institution-agnostic open posting.
  async findAllForActorInstitution({ page, limit, sort, institutionId }) {
    const filter = {
      $or: [{ institution_id: institutionId }, { institution_id: { $exists: false } }, { institution_id: null }],
    };
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.collection.find(filter).sort(sort || this.defaultSort).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { rows: docs.map((d) => this._toEntity(d)), total };
  }
}

module.exports = new PlacementRepository();
