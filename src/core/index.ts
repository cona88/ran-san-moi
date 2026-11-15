/** Public API of the pure open-world game core. */
export { SNAKE_FORMS } from './types';
export type {
  AbsorbedBotPower,
  BoosterKind,
  BoosterSlot,
  BoostersState,
  BotSkin,
  BotSnake,
  BrainQuest,
  Cell,
  Difficulty,
  Direction,
  FormMetadata,
  GameAction,
  GameConfig,
  GameEvent,
  GameEventKind,
  GameMode,
  GamePhase,
  GameState,
  Hazard,
  HazardKind,
  LeaderboardEntry,
  Projectile,
  QuestKind,
  QuestOrb,
  RngState,
  SnakeForm,
  Vec2,
  VisualTheme,
  WorldOrb,
} from './types';

export {
  createInitialBoosters,
  createInitialState,
  getMagnetRadius,
  reduce,
  type NewGameOptions,
} from './game';
export { configFor, DEFAULT_CONFIG, FORM_METADATA } from './config';
export { delta, isOpposite, perpendicularDirections } from './direction';
export {
  advanceSpineFollowLeader,
  buildStraightSpine,
  enqueueTurn,
  matchSpineLength,
  SEGMENT_SPACING,
  targetPlayerLength,
} from './movement';
export {
  activeSize,
  angleDiff,
  angleToDirection,
  chebyshevDistance,
  clamp,
  directionToAngle,
  distanceSq,
  euclideanDistance,
  innerBounds,
  manhattanDistance,
  normalizeAngle,
  wallBounds,
  wrapCell,
} from './systems/arena';
export {
  allInsideWalls,
  distancePointToSegment,
  hitsBody,
  hitsWall,
  minDistanceToChain,
} from './systems/collision';
export {
  collectOccupiedCells,
  freeCells,
  LOOT_ORB_COLORS,
  nearestOrbPos,
  pickFood,
  pickOptionalCell,
  replenishWorldOrbs,
  sampleWorldPos,
  scatterLootOrbs,
  WORLD_ORB_COLORS,
} from './systems/food';
export { canTransition, isValidTransition } from './stateMachine';
export { createRng, nextFloat, nextInt, nextRandom } from './rng';
export { createHazard, maxHazardsFor, pickSafeDirection, stepHazards } from './hazards';
export {
  applyQuestOrbHit,
  applyXpAndScore,
  computeLevel,
  grantBoosterCharge,
  spawnQuest,
  tickQuest,
  xpThresholdForLevel,
} from './quests';
export {
  PROJECTILE_STEP_DIST,
  shootCooldownForForm,
  spawnProjectilesForForm,
  SPIRIT_EXPLOSION_RADIUS,
  stepProjectiles,
} from './projectiles';
export {
  absorbedPowerTitle,
  BOT_NAMES,
  BOT_SKINS,
  botCollisionRadius,
  computeLeaderboard,
  createInitialBots,
  powerFormForSkin,
  repelBotFrom,
  replenishBots,
  resolveBotDefeated,
  spawnBossBot,
  stepBots,
  targetBotSpineLength,
} from './bots';
