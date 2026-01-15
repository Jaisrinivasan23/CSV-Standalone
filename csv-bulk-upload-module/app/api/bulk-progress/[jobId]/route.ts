import { NextRequest, NextResponse } from 'next/server';
import { getProgress } from '@/app/lib/bulk-progress';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const progress = getProgress(jobId);

    if (!progress) {
      return NextResponse.json({
        success: false,
        error: 'Job not found or expired',
      }, { status: 404 });
    }

    // Calculate metrics
    const elapsed = Date.now() - progress.startTime;
    const percentComplete = progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

    const avgTimePerItem = progress.completed > 0
      ? elapsed / progress.completed
      : 0;

    const remaining = progress.total - progress.completed - progress.failed;
    const estimatedTimeRemaining = remaining > 0 && avgTimePerItem > 0
      ? Math.ceil(avgTimePerItem * remaining)
      : 0;

    return NextResponse.json({
      success: true,
      ...progress,
      percentComplete,
      elapsedMs: elapsed,
      estimatedTimeRemainingMs: estimatedTimeRemaining,
    });

  } catch (error) {
    console.error('❌ [PROGRESS] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get progress',
    }, { status: 500 });
  }
}
