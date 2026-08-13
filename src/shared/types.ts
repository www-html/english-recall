/** ISO-8601 timestamp serialized at persistence and engine boundaries. */
export type IsoDateTime = string

export type EntityId = string
export type LessonPackId = EntityId
export type LessonId = EntityId
export type LearningItemId = EntityId
export type SessionId = EntityId

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export type Unsubscribe = () => void
