import type {
  DiagnosticEvent,
  DiagnosticRepository,
} from './contracts.ts'
import { IndexedDbPersistenceProvider } from './indexed-db.ts'

export type DiagnosticInput = Omit<DiagnosticEvent, 'timestamp' | 'appVersion'>

export function createDiagnosticRecorder(
  repository: Pick<DiagnosticRepository, 'append'>,
  appVersion: string,
  now: () => string = () => new Date().toISOString(),
): (input: DiagnosticInput) => void {
  return (input) => {
    try {
      void repository
        .append({ ...input, timestamp: now(), appVersion })
        .catch(() => undefined)
    } catch {
      // Diagnostics are best-effort and must never affect product behavior.
    }
  }
}

const globalDiagnosticProvider = new IndexedDbPersistenceProvider()

export const recordLocalDiagnostic = createDiagnosticRecorder(
  globalDiagnosticProvider.diagnostics,
  __APP_VERSION__,
)
