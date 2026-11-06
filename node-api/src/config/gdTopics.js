// Group-discussion topic bank. Categories x difficulty. Kept in code (not the DB) so it is
// versioned and reviewable; `random` picks from whatever filter the student chose.
const TOPICS = [
  // current affairs
  { category: 'current_affairs', difficulty: 'easy', topic: 'Should social media be banned for children under 16?' },
  { category: 'current_affairs', difficulty: 'easy', topic: 'Is the four-day work week a good idea for India?' },
  { category: 'current_affairs', difficulty: 'medium', topic: 'Will UPI-style digital public infrastructure help India lead the global economy?' },
  { category: 'current_affairs', difficulty: 'medium', topic: 'Should India switch fully to electric vehicles by 2035?' },
  { category: 'current_affairs', difficulty: 'hard', topic: 'One Nation, One Election: boon or threat to Indian federalism?' },
  { category: 'current_affairs', difficulty: 'hard', topic: 'Should AI-generated content be regulated by law in India?' },
  // abstract
  { category: 'abstract', difficulty: 'easy', topic: 'Zero is more powerful than one.' },
  { category: 'abstract', difficulty: 'easy', topic: 'A smooth sea never made a skilled sailor.' },
  { category: 'abstract', difficulty: 'medium', topic: 'Is silence louder than words?' },
  { category: 'abstract', difficulty: 'medium', topic: 'The glass is neither half full nor half empty.' },
  { category: 'abstract', difficulty: 'hard', topic: 'Freedom is the freedom to make mistakes.' },
  { category: 'abstract', difficulty: 'hard', topic: 'Is a shortcut ever the shortest path?' },
  // case study
  { category: 'case_study', difficulty: 'easy', topic: 'A college canteen is losing money. Should it cut the menu, raise prices, or add delivery?' },
  { category: 'case_study', difficulty: 'easy', topic: 'A student club has a small budget. Should it host one big fest or many small events?' },
  { category: 'case_study', difficulty: 'medium', topic: 'A startup has funds for either hiring five engineers or running a big marketing campaign. What should it choose?' },
  { category: 'case_study', difficulty: 'medium', topic: 'A bank branch has long queues. Should it add staff, add kiosks, or push mobile banking?' },
  { category: 'case_study', difficulty: 'hard', topic: 'Your company has a data breach affecting 50,000 users. Disclose immediately or investigate first?' },
  { category: 'case_study', difficulty: 'hard', topic: 'A profitable product line harms the environment. Should the company shut it down?' },
  // tech and business
  { category: 'tech_business', difficulty: 'easy', topic: 'Will AI tools make software engineers more or less valuable?' },
  { category: 'tech_business', difficulty: 'easy', topic: 'Is working from home better than working from the office for freshers?' },
  { category: 'tech_business', difficulty: 'medium', topic: 'Open source versus proprietary software: which is better for a startup?' },
  { category: 'tech_business', difficulty: 'medium', topic: 'Should companies track employee productivity with software?' },
  { category: 'tech_business', difficulty: 'hard', topic: 'Is the gig economy a path to opportunity or to insecurity?' },
  { category: 'tech_business', difficulty: 'hard', topic: 'Should big tech companies be broken up?' },
];

const CATEGORIES = ['current_affairs', 'abstract', 'case_study', 'tech_business'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function pickTopic({ category, difficulty } = {}, rng = Math.random) {
  const pool = TOPICS.filter((t) => (!category || t.category === category) && (!difficulty || t.difficulty === difficulty));
  const from = pool.length ? pool : TOPICS;
  return from[Math.floor(rng() * from.length)];
}

module.exports = { TOPICS, CATEGORIES, DIFFICULTIES, pickTopic };
