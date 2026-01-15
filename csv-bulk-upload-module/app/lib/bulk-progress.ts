// In-memory progress tracking for bulk operations
// Lightweight solution without Redis/DB dependencies

export interface BulkProgress {
  jobId: string;
  phase: 'generating' | 'uploading' | 'storing' | 'complete' | 'error';
  total: number;
  completed: number;
  failed: number;
  startTime: number;
  currentItem?: string;
  error?: string;
}

// Store progress in memory (resets on server restart)
const progressStore = new Map<string, BulkProgress>();

export function createProgress(jobId: string, total: number): void {
  progressStore.set(jobId, {
    jobId,
    phase: 'generating',
    total,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
  });

  // Auto-cleanup after 1 hour
  setTimeout(() => {
    progressStore.delete(jobId);
  }, 3600000);
}

export function updateProgress(
  jobId: string,
  updates: Partial<BulkProgress>
): void {
  const progress = progressStore.get(jobId);
  if (progress) {
    Object.assign(progress, updates);
    progressStore.set(jobId, progress);
  }
}

export function getProgress(jobId: string): BulkProgress | null {
  return progressStore.get(jobId) || null;
}

export function deleteProgress(jobId: string): void {
  progressStore.delete(jobId);
}

export function completeProgress(jobId: string): void {
  const progress = progressStore.get(jobId);
  if (progress) {
    progress.phase = 'complete';
    progressStore.set(jobId, progress);
  }
}
