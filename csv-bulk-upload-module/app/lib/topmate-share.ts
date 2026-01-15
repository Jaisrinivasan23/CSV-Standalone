// app/lib/topmate-share.ts

export interface SharePosterPayload {
  posterHtml: string;
  posterName: string;
  userIds: number[];
  dimensions?: { width: number; height: number };
}

export interface ShareResult {
  success: boolean;
  posterUrl?: string;
  posterName?: string;
  userId?: number;
  error?: string;
}

// Check if S3 is configured
function isS3Configured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_AWS_S3_BUCKET &&
    process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID
  );
}

// Save poster locally
async function saveLocally(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, filename);

  const response = await fetch('/api/save-local', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error('Local save failed');

  const data = await response.json();
  return `${process.env.NEXT_PUBLIC_BASE_URL}${data.path}`;
}

// Upload to S3 (if configured)
async function uploadToS3(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, filename);

  const response = await fetch('/api/upload-s3', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error('S3 upload failed');

  const data = await response.json();
  return data.url;
}

// Upload poster (S3 or local)
async function uploadPoster(blob: Blob, filename: string): Promise<string> {
  if (isS3Configured()) {
    console.log('📤 Uploading to S3...');
    return await uploadToS3(blob, filename);
  } else {
    console.log('💾 Saving locally...');
    return await saveLocally(blob, filename);
  }
}

// Generate PNG from HTML
async function generatePosterImage(
  html: string,
  dimensions: { width: number; height: number }
): Promise<Blob> {
  const response = await fetch('/api/export-poster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      format: 'png',
      width: dimensions.width,
      height: dimensions.height,
      scale: 2, // High-res export
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate poster');
  }

  return await response.blob();
}

// Share poster to single user
async function sharePosterToSingleUser(
  posterUrl: string,
  posterName: string,
  userId: number
): Promise<ShareResult> {
  try {
    const djangoUrl = process.env.NEXT_PUBLIC_DJANGO_API_URL;
    const externalId = `${posterName}-${userId}-${Date.now()}`;

    console.log(`  👤 User ${userId}:`);

    // Step 1: Create Video entry
    console.log(`    📹 Creating Video entry...`);
    const videoPayload = {
      external_id: externalId,
      url: posterUrl,
      status: 'COMPLETED',
      user: userId,
    };
    console.log(`    📤 Video payload:`, JSON.stringify(videoPayload));

    const videoResponse = await fetch(`${djangoUrl}/create-video/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoPayload),
    });

    const videoResponseText = await videoResponse.text();
    console.log(`    📥 Video response (${videoResponse.status}):`, videoResponseText);

    if (!videoResponse.ok) {
      throw new Error(`Video API failed: ${videoResponse.statusText} - ${videoResponseText}`);
    }

    console.log(`    ✅ Video created`);

    // Step 2: Trigger webhook (using existing monthly_stat_handler via '-ms-' tag)
    console.log(`    🔗 Triggering webhook...`);
    const webhookPayload = {
      id: externalId,
      status: 'succeeded',
      output_format: 'jpg',
      template_tags: [`-ms-${posterName}`], // Triggers monthly_stat_handler
      template_id: `email-forge-${posterName}`,
      modifications: {
        campaign: posterName,
        title: posterName.replace(/-/g, ' ').toUpperCase(),
        description: `Poster: ${posterName}`,
        tag: 'custom',
      },
      metadata: `email-forge-${userId}-${Date.now()}`,
    };
    console.log(`    📤 Webhook payload:`, JSON.stringify(webhookPayload));

    const webhookResponse = await fetch(`${djangoUrl}/creatomate-webhook/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });

    const webhookResponseText = await webhookResponse.text();
    console.log(`    📥 Webhook response (${webhookResponse.status}):`, webhookResponseText);

    if (!webhookResponse.ok) {
      throw new Error(`Webhook failed: ${webhookResponse.statusText} - ${webhookResponseText}`);
    }

    console.log(`    ✅ UserShareContent created (webhook returned success)`);

    return {
      success: true,
      posterUrl,
      posterName,
      userId,
    };
  } catch (error) {
    console.error(`    ❌ Error:`, error);
    return {
      success: false,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// MAIN FUNCTION: Share poster to multiple users
export async function sharePosterToMultipleUsers(
  payload: SharePosterPayload
): Promise<ShareResult[]> {
  try {
    console.log(`🚀 Starting share: "${payload.posterName}"`);
    console.log(`👥 Target users: [${payload.userIds.join(', ')}]`);

    // Generate PNG once
    console.log('🎨 Generating PNG...');
    const dimensions = payload.dimensions || { width: 1080, height: 1080 };
    const posterBlob = await generatePosterImage(payload.posterHtml, dimensions);
    console.log('✅ PNG generated');

    // Upload once (reuse for all users)
    const filename = `${payload.posterName}-${Date.now()}.png`;
    console.log(`📤 Uploading: ${filename}`);
    const posterUrl = await uploadPoster(posterBlob, filename);
    console.log(`✅ Uploaded: ${posterUrl}`);

    // Share to each user
    console.log(`\n📤 Sharing to ${payload.userIds.length} user(s):\n`);
    const results: ShareResult[] = [];

    for (const userId of payload.userIds) {
      const result = await sharePosterToSingleUser(posterUrl, payload.posterName, userId);
      results.push(result);

      // Small delay to avoid overwhelming server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✅ Completed!`);
    return results;

  } catch (error) {
    console.error('❌ Failed:', error);
    return payload.userIds.map(userId => ({
      success: false,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Store multiple posters to Django Video + UserShareContent
 * Used for bulk generation workflow
 */
export async function storeBulkPosters(
  posters: Array<{
    userId: number;
    posterUrl: string;
    posterName: string;
  }>
): Promise<ShareResult[]> {
  console.log(`📦 Storing ${posters.length} posters to Django...`);

  const results: ShareResult[] = [];

  for (const poster of posters) {
    console.log(`  💾 Storing for user ${poster.userId}...`);

    const result = await sharePosterToSingleUser(
      poster.posterUrl,
      poster.posterName,
      poster.userId
    );

    results.push(result);

    // 100ms delay to avoid overwhelming Django API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`✅ Successfully stored ${successCount}/${posters.length} posters`);

  return results;
}
