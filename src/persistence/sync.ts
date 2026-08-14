import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type {
  AppSettings,
  LearnerProgress,
  LearnerSyncSnapshotV1,
  LearnerSyncSnapshotV2,
  SavedSentenceRecord,
  SessionCompletionRecord,
  SyncedLessonPack,
  SyncValue,
} from './contracts.ts'

export type LearnerSyncMergeConflictCode =
  | 'learner-mismatch'
  | 'lesson-pack-content'
  | 'progress-concurrent-update'
  | 'active-session-concurrent-update'
  | 'session-history-content'

export interface LearnerSyncMergeConflict {
  readonly code: LearnerSyncMergeConflictCode
  readonly identity: string
  readonly message: string
}

export type LearnerSyncMergeResult =
  | { readonly ok: true; readonly value: LearnerSyncSnapshotV2 }
  | { readonly ok: false; readonly conflicts: readonly LearnerSyncMergeConflict[] }

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`
  }
  const record = value as Readonly<Record<string, unknown>>
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${members.join(',')}}`
}

/** Stable, non-security identity; merge safety also compares canonical content. */
export function createLessonPackContentHash(pack: LessonPack): string {
  const content = canonicalJson(pack)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < content.length; index += 1) {
    hash ^= BigInt(content.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `canonical-fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function createSyncedLessonPack(pack: LessonPack): SyncedLessonPack {
  return { pack, contentHash: createLessonPackContentHash(pack) }
}

/** Lossless for V1-owned data; V1 had no lesson content to carry forward. */
export function upgradeLearnerSyncSnapshotV1(
  snapshot: LearnerSyncSnapshotV1,
): LearnerSyncSnapshotV2 {
  return {
    schemaVersion: 2,
    learnerId: snapshot.learnerId,
    capturedAt: snapshot.capturedAt,
    lessonPacks: [],
    progress: { value: snapshot.progress, updatedAt: snapshot.capturedAt },
    activeSession: {
      value: snapshot.activeSession,
      updatedAt: snapshot.activeSession?.updatedAt ?? snapshot.capturedAt,
    },
    settings: { value: snapshot.settings, updatedAt: snapshot.capturedAt },
    savedSentences: snapshot.savedSentences,
    sessionHistory: snapshot.sessionHistory,
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function compareIsoDateTimes(left: string, right: string): number {
  const difference = Date.parse(left) - Date.parse(right)
  return difference !== 0 ? difference : left.localeCompare(right)
}

function newer<T>(left: SyncValue<T>, right: SyncValue<T>): SyncValue<T> {
  const timeOrder = compareIsoDateTimes(left.updatedAt, right.updatedAt)
  if (timeOrder !== 0) {
    return timeOrder > 0 ? left : right
  }
  return canonicalJson(left.value) >= canonicalJson(right.value) ? left : right
}

function mergeProgress(
  local: SyncValue<LearnerProgress | null>,
  remote: SyncValue<LearnerProgress | null>,
  base: SyncValue<LearnerProgress | null> | undefined,
  conflicts: LearnerSyncMergeConflict[],
): SyncValue<LearnerProgress | null> {
  if (valuesEqual(local.value, remote.value)) return newer(local, remote)
  if (base) {
    const localChanged = !valuesEqual(local.value, base.value)
    const remoteChanged = !valuesEqual(remote.value, base.value)
    if (localChanged && !remoteChanged) return local
    if (!localChanged && remoteChanged) return remote
    if (localChanged && remoteChanged) {
      conflicts.push({
        code: 'progress-concurrent-update',
        identity: 'progress',
        message: 'Progress changed independently on both sides',
      })
      return local
    }
  }
  if (Date.parse(local.updatedAt) === Date.parse(remote.updatedAt)) {
    conflicts.push({
      code: 'progress-concurrent-update',
      identity: 'progress',
      message: 'Different progress values have the same mutation time',
    })
    return local
  }
  return newer(local, remote)
}

function mergeActiveSession<T>(
  local: SyncValue<T>,
  remote: SyncValue<T>,
  base: SyncValue<T> | undefined,
  conflicts: LearnerSyncMergeConflict[],
): SyncValue<T> {
  if (valuesEqual(local.value, remote.value)) return newer(local, remote)
  if (base) {
    const localChanged = !valuesEqual(local.value, base.value)
    const remoteChanged = !valuesEqual(remote.value, base.value)
    if (localChanged && !remoteChanged) return local
    if (!localChanged && remoteChanged) return remote
  }
  conflicts.push({
    code: 'active-session-concurrent-update',
    identity: 'activeSession',
    message: 'Active session differs and requires an explicit choice',
  })
  return local
}

function mergeLessonPacks(
  local: readonly SyncedLessonPack[],
  remote: readonly SyncedLessonPack[],
  conflicts: LearnerSyncMergeConflict[],
): readonly SyncedLessonPack[] {
  const merged = new Map<string, SyncedLessonPack>()
  for (const record of [...local, ...remote]) {
    const normalized = createSyncedLessonPack(record.pack)
    const existing = merged.get(record.pack.id)
    if (!existing) {
      merged.set(record.pack.id, normalized)
      continue
    }
    if (existing.pack.version === record.pack.version) {
      if (!valuesEqual(existing.pack, record.pack)) {
        conflicts.push({
          code: 'lesson-pack-content',
          identity: `${record.pack.id}@${record.pack.version}`,
          message: 'The same pack id and version contain different content',
        })
      }
      continue
    }
    if (compareSemanticVersions(record.pack.version, existing.pack.version) > 0) {
      merged.set(record.pack.id, normalized)
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.pack.id.localeCompare(right.pack.id),
  )
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function savedKey(record: SavedSentenceRecord): string {
  return `${record.learnerId}::${record.packId}::${record.sentenceId}`
}

function mergeSavedSentences(
  local: readonly SavedSentenceRecord[],
  remote: readonly SavedSentenceRecord[],
): readonly SavedSentenceRecord[] {
  const merged = new Map<string, SavedSentenceRecord>()
  for (const record of [...local, ...remote]) {
    const key = savedKey(record)
    const existing = merged.get(key)
    if (!existing || compareIsoDateTimes(record.savedAt, existing.savedAt) > 0) {
      merged.set(key, record)
    }
  }
  return [...merged.values()].sort((left, right) =>
    savedKey(left).localeCompare(savedKey(right)),
  )
}

function mergeSessionHistory(
  local: readonly SessionCompletionRecord[],
  remote: readonly SessionCompletionRecord[],
  conflicts: LearnerSyncMergeConflict[],
): readonly SessionCompletionRecord[] {
  const merged = new Map<string, SessionCompletionRecord>()
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.sessionId)
    if (existing && !valuesEqual(existing, record)) {
      conflicts.push({
        code: 'session-history-content',
        identity: record.sessionId,
        message: 'An append-only session id has different immutable content',
      })
      continue
    }
    merged.set(record.sessionId, record)
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.completedAt.localeCompare(right.completedAt) ||
      left.sessionId.localeCompare(right.sessionId),
  )
}

function mergeSettings(
  local: SyncValue<AppSettings | null>,
  remote: SyncValue<AppSettings | null>,
): SyncValue<AppSettings | null> {
  return newer(local, remote)
}

export function mergeLearnerSyncSnapshots(
  local: LearnerSyncSnapshotV2,
  remote: LearnerSyncSnapshotV2,
  base?: LearnerSyncSnapshotV2,
): LearnerSyncMergeResult {
  if (
    local.learnerId !== remote.learnerId ||
    (base !== undefined && base.learnerId !== local.learnerId)
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'learner-mismatch',
        identity: `${local.learnerId}::${remote.learnerId}`,
        message: 'Snapshots belong to different learners',
      }],
    }
  }

  const conflicts: LearnerSyncMergeConflict[] = []
  const lessonPacks = mergeLessonPacks(local.lessonPacks, remote.lessonPacks, conflicts)
  const progress = mergeProgress(local.progress, remote.progress, base?.progress, conflicts)
  const activeSession = mergeActiveSession(
    local.activeSession,
    remote.activeSession,
    base?.activeSession,
    conflicts,
  )
  const sessionHistory = mergeSessionHistory(
    local.sessionHistory,
    remote.sessionHistory,
    conflicts,
  )
  if (conflicts.length > 0) return { ok: false, conflicts }

  return {
    ok: true,
    value: {
      schemaVersion: 2,
      learnerId: local.learnerId,
      capturedAt: compareIsoDateTimes(local.capturedAt, remote.capturedAt) > 0
        ? local.capturedAt
        : remote.capturedAt,
      lessonPacks,
      progress,
      activeSession,
      settings: mergeSettings(local.settings, remote.settings),
      savedSentences: mergeSavedSentences(
        local.savedSentences,
        remote.savedSentences,
      ),
      sessionHistory,
    },
  }
}
