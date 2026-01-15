import { NextRequest, NextResponse } from 'next/server';
import { storeBulkPosters } from '../../lib/topmate-share';
import { fetchTopmateProfile } from '../../lib/topmate';
import { updateProgress } from '../../lib/bulk-progress';

// Helper function to convert data URL to Blob
function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Helper function to check if S3 is configured
function isS3Configured(): boolean {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

// Upload image (to S3 or local)
async function uploadImage(dataUrl: string, filename: string): Promise<string> {
  const blob = dataURLtoBlob(dataUrl);
  const formData = new FormData();
  formData.append('file', blob, filename);

  // Construct absolute URL for server-side fetch
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (isS3Configured()) {
    console.log('    📤 Uploading to S3...');
    const response = await fetch(`${baseUrl}/api/upload-s3`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`S3 upload failed: ${errorText}`);
    }
    const data = await response.json();
    return data.url;
  } else {
    console.log('    💾 Saving locally (via S3)...');
    const response = await fetch(`${baseUrl}/api/save-local`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local save failed: ${errorText}`);
    }
    const data = await response.json();
    // save-local now returns full S3 URL in 'path' field, don't prepend baseUrl
    return data.path;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { posters, posterName, jobId } = body as {
      posters: Array<{
        userId?: string;
        username: string;
        posterUrl: string;
      }>;
      posterName: string;
      jobId?: string;
    };

    console.log(`💾 [SAVE-BULK] Saving ${posters.length} posters to database...`);

    // Update progress to storing phase
    if (jobId) {
      updateProgress(jobId, {
        phase: 'storing',
        completed: 0,
        failed: 0,
        currentItem: 'Starting database storage...'
      });
    }

    // Upload all images and get real URLs
    const uploadedPosters = [];

    // Process in smaller batches to avoid rate limiting
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches
    const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds between individual requests

    for (let i = 0; i < posters.length; i += BATCH_SIZE) {
      const batch = posters.slice(i, i + BATCH_SIZE);
      console.log(`📦 [SAVE-BULK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(posters.length / BATCH_SIZE)}`);

      for (const poster of batch) {
        try {
          console.log(`  📤 Processing ${poster.username}...`);

          // Lookup user_id from username if not provided
          let userId: number | null = null;

          if (poster.userId) {
            // Already have userId (from HTML + API mode)
            userId = parseInt(poster.userId);
            console.log(`    ✅ Using provided userId: ${userId}`);
          } else {
            // Need to lookup userId from username (CSV mode) with retry logic
            console.log(`    🔍 Looking up userId for username: ${poster.username}`);

            const MAX_RETRIES = 5;
            let retryCount = 0;
            let success = false;

            while (retryCount < MAX_RETRIES && !success) {
              try {
                const profile = await fetchTopmateProfile(poster.username);
                if (profile && profile.user_id) {
                  userId = parseInt(profile.user_id);
                  console.log(`    ✅ Found userId: ${userId}`);
                  success = true;
                } else {
                  console.error(`    ❌ No profile found for username: ${poster.username}`);
                  break;
                }
              } catch (lookupError: any) {
                retryCount++;

                // Check if it's a rate limit error (429)
                if (lookupError.message?.includes('429')) {
                  const backoffDelay = Math.min(30000, 5000 * Math.pow(2, retryCount)); // Exponential backoff, max 30s
                  console.warn(`    ⚠️ Rate limited (429). Retry ${retryCount}/${MAX_RETRIES} after ${backoffDelay}ms delay...`);
                  await new Promise(r => setTimeout(r, backoffDelay));
                } else {
                  console.error(`    ❌ Failed to lookup ${poster.username}:`, lookupError);
                  break;
                }
              }
            }

            if (!success) {
              console.error(`    ❌ Skipping ${poster.username} after ${MAX_RETRIES} retries`);
              continue; // Skip this poster
            }

            // Add delay after successful lookup to avoid rate limiting
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_REQUESTS));
          }

        // Check if posterUrl is a data URL (starts with data:image/)
        let finalUrl = poster.posterUrl;

        if (poster.posterUrl.startsWith('data:image/')) {
          // Upload the data URL to get a real URL
          console.log(`    📤 Uploading image...`);
          const filename = `${poster.username}-${Date.now()}.png`;
          finalUrl = await uploadImage(poster.posterUrl, filename);
          console.log(`    ✅ Uploaded: ${finalUrl}`);
        } else {
          console.log(`    ℹ️ Already a URL: ${finalUrl}`);
        }

        uploadedPosters.push({
          userId: userId,
          posterUrl: finalUrl,
          posterName: posterName || `bulk-poster-${Date.now()}`,
        });

        // Update progress tracking
        if (jobId) {
          const currentCompleted = uploadedPosters.length;
          const currentFailed = (i + batch.indexOf(poster) + 1) - currentCompleted;
          updateProgress(jobId, {
            phase: 'storing',
            completed: currentCompleted,
            failed: currentFailed,
            currentItem: `${poster.username} (${currentCompleted}/${posters.length})`
          });
        }
      } catch (uploadError) {
        console.error(`    ❌ Processing failed for ${poster.username}:`, uploadError);
        // Skip this poster if processing fails
      }
    } // End of batch loop

    // Delay between batches to avoid overwhelming Topmate API
    if (i + BATCH_SIZE < posters.length) {
      console.log(`⏸️ [SAVE-BULK] Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  } // End of main loop

    if (uploadedPosters.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'All image uploads failed',
      }, { status: 500 });
    }

    console.log(`📦 [SAVE-BULK] Uploaded ${uploadedPosters.length}/${posters.length} images`);

    // Store to Django database
    const storageResults = await storeBulkPosters(uploadedPosters);
    const successCount = storageResults.filter(r => r.success).length;
    const failureCount = storageResults.length - successCount;

    console.log(`✅ [SAVE-BULK] Saved ${successCount}/${uploadedPosters.length} posters to database`);

    return NextResponse.json({
      success: true,
      results: storageResults,
      successCount,
      failureCount,
    });

  } catch (error) {
    console.error('❌ [SAVE-BULK] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save posters'
    }, { status: 500 });
  }
}
