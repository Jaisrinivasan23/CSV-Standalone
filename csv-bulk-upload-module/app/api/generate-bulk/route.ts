import { NextRequest, NextResponse } from 'next/server';
import { fetchTopmateProfile, parseUserIdentifiers, fetchProfileByUserId } from '../../lib/topmate';
import { PosterSize, POSTER_SIZE_DIMENSIONS, TopmateProfile } from '../../types/poster';
import { overlayLogoAndProfile } from '../../lib/image-overlay';
import { createProgress, updateProgress, completeProgress } from '../../lib/bulk-progress';
import { v4 as uuidv4 } from 'uuid';

// Convert JavaScript-based dynamic HTML to placeholder-based HTML
function convertDynamicHtmlToPlaceholder(html: string, columns: string[]): string {
  console.log('🔄 [CONVERT] Converting dynamic HTML to placeholder-based HTML');

  // Remove all <script> tags and their content
  let converted = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Find images with id="profilePic" or similar and convert to placeholder
  // Pattern: <img id="profilePic" src="" ... style="display: none;">
  converted = converted.replace(
    /<img\s+[^>]*id=["']profilePic["'][^>]*>/gi,
    (match) => {
      // Extract the src attribute and replace it with placeholder
      const hasProfilePicColumn = columns.includes('profile_pic');
      const placeholder = hasProfilePicColumn ? '{profile_pic}' : '';

      // Remove style="display: none;" and set src to placeholder
      let newImg = match
        .replace(/src=["'][^"']*["']/i, `src="${placeholder}"`)
        .replace(/style=["'][^"']*["']/i, '')
        .replace(/style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']/i, '');

      return newImg;
    }
  );

  // Remove placeholder divs that show when image is not loaded
  // Pattern: <div id="placeholder" class="profile-placeholder-empty">?</div>
  converted = converted.replace(
    /<div\s+[^>]*id=["']placeholder["'][^>]*>.*?<\/div>/gi,
    ''
  );

  // Auto-detect and replace common image placeholder patterns for all CSV columns
  columns.forEach(col => {
    // Match patterns like: src="" or src='' and try to detect if it should be an image column
    if (col.toLowerCase().includes('pic') || col.toLowerCase().includes('image') || col.toLowerCase().includes('photo') || col.toLowerCase().includes('avatar')) {
      // Find empty src attributes near this column name (in comments or nearby text)
      const columnPattern = new RegExp(`<!--[^>]*${col}[^>]*-->\\s*<img[^>]*src=["']\\s*["']`, 'gi');
      converted = converted.replace(columnPattern, (match) => {
        return match.replace(/src=["']\s*["']/, `src="{${col}}"`);
      });
    }
  });

  // Fix any broken placeholders (like {profile_pic without closing })
  converted = converted.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\})/g, '{$1}');

  console.log('✅ [CONVERT] Conversion complete');
  return converted;
}

// Replace placeholders in HTML with actual data
function replacePlaceholders(html: string, data: any, columns: string[]): string {
  let result = html;
  columns.forEach(col => {
    const regex = new RegExp(`\\{${col}\\}`, 'g');
    result = result.replace(regex, data[col] || '');
  });
  return result;
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Image generation system prompt for bulk
const IMAGE_GENERATION_SYSTEM_PROMPT = `You are an expert image designer creating professional, visually stunning posters and graphics using Gemini's native image generation capabilities.

Key Requirements:
- Generate images directly (you have native image generation capability)
- Match the reference image's style, layout, colors, and typography EXACTLY
- Use the user's REAL data provided in the prompt
- Ensure all text is clearly readable and well-positioned
- Make designs professional, modern, and visually appealing
- Include profile pictures when provided

OUTPUT: Generate the image directly. Do not output HTML, code, or text descriptions.`;

// Fetch and convert image URL to base64 data URL
async function fetchImageAsDataUrl(imageUrl: string): Promise<string | null> {
  try {
    console.log('🔍 [BULK] Fetching image from URL:', imageUrl);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`❌ [BULK] Failed to fetch image: HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    console.log(`📦 [BULK] Image fetched, size: ${buffer.byteLength} bytes`);

    let contentType = response.headers.get('content-type');
    console.log('📋 [BULK] Original content-type:', contentType);

    // Detect from URL extension if needed
    if (!contentType || contentType === 'binary/octet-stream' || contentType === 'application/octet-stream') {
      if (imageUrl.toLowerCase().match(/\.(jpg|jpeg)($|\?)/)) {
        contentType = 'image/jpeg';
      } else if (imageUrl.toLowerCase().match(/\.(png)($|\?)/)) {
        contentType = 'image/png';
      } else if (imageUrl.toLowerCase().match(/\.(gif)($|\?)/)) {
        contentType = 'image/gif';
      } else if (imageUrl.toLowerCase().match(/\.(webp)($|\?)/)) {
        contentType = 'image/webp';
      } else {
        contentType = 'image/png';
      }
      console.log('🔧 [BULK] Detected content-type from extension:', contentType);
    }

    if (!contentType.startsWith('image/')) {
      console.warn('⚠️ [BULK] Invalid content-type, defaulting to image/png');
      contentType = 'image/png';
    }

    console.log(`✅ [BULK] Image converted to data URL with type: ${contentType}`);
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('❌ [BULK] Failed to fetch image:', error);
    return null;
  }
}

// Call OpenRouter for image generation with Gemini 2.5 Flash Image (Nano Banana)
async function callOpenRouterForImage(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  dimensions: { width: number; height: number },
  referenceImage?: string
): Promise<{ imageUrl: string; imageData?: string }> {
  console.log('🎨 [BULK] Calling OpenRouter for image generation with Gemini 2.5 Flash Image');

  // Build message content
  type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  const content: ContentPart[] = [];

  // Add reference image (template style)
  if (referenceImage && referenceImage.startsWith('data:image/')) {
    console.log('🖼️ [BULK] Adding reference template image');
    content.push({
      type: 'image_url',
      image_url: { url: referenceImage }
    });
    userPrompt += `\n\nReference image provided - match this style EXACTLY.`;
  }

  // Add text prompt
  content.push({
    type: 'text',
    text: userPrompt
  });

  // Calculate aspect ratio
  const aspectRatio = dimensions.width === dimensions.height ? '1:1' :
    dimensions.width > dimensions.height ? `${Math.round(dimensions.width / dimensions.height * 10) / 10}:1` :
    `1:${Math.round(dimensions.height / dimensions.width * 10) / 10}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
      'X-Title': 'Email Forge - Bulk Image Generation',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      max_tokens: 2000,
      temperature: 0.7,
      image_config: {
        aspect_ratio: aspectRatio,
        output_format: 'image/png'
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [BULK] OpenRouter image generation error:', response.status, errorText);
    throw new Error(`OpenRouter image generation error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const message = data.choices[0]?.message;

  console.log('📦 [BULK] Message keys:', Object.keys(message || {}));
  console.log('📦 [BULK] Has images?:', 'images' in (message || {}));

  // Check message.images array (OpenRouter format for Gemini image generation)
  if (message?.images && Array.isArray(message.images)) {
    const imageItem = message.images[0];
    if (imageItem?.image_url?.url) {
      const imageUrl = imageItem.image_url.url;
      console.log('✅ [BULK] Successfully extracted image from message.images');
      console.log(`📊 [BULK] Image URL length: ${imageUrl.length} chars`);
      return { imageUrl };
    }
  }

  // Fallback: Gemini returns image data in message.parts[].inline_data (direct API format)
  if (message?.parts && Array.isArray(message.parts)) {
    for (const part of message.parts) {
      if (part.inline_data?.data && part.inline_data?.mime_type) {
        const mimeType = part.inline_data.mime_type;
        const base64Data = part.inline_data.data;
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        console.log('✅ [BULK] Successfully extracted image from parts.inline_data');
        console.log(`📊 [BULK] Image size: ${base64Data.length} chars, type: ${mimeType}`);
        return { imageUrl: dataUrl };
      }
    }
  }

  // Fallback: check message.content
  if (message?.content) {
    if (typeof message.content === 'string') {
      if (message.content.startsWith('data:image/')) {
        console.log('✅ [BULK] Found data URL in content string');
        return { imageUrl: message.content };
      }
      if (message.content.startsWith('http://') || message.content.startsWith('https://')) {
        console.log('✅ [BULK] Found HTTP URL in content string');
        return { imageUrl: message.content };
      }
    }
    if (Array.isArray(message.content)) {
      const imageContent = message.content.find((c: any) => c.type === 'image_url' || c.type === 'image');
      if (imageContent?.image_url?.url) {
        console.log('✅ [BULK] Found image URL in content array');
        return { imageUrl: imageContent.image_url.url };
      }
      if (imageContent?.inline_data?.data) {
        const mimeType = imageContent.inline_data.mime_type || 'image/png';
        const dataUrl = `data:${mimeType};base64,${imageContent.inline_data.data}`;
        console.log('✅ [BULK] Found inline_data in content array');
        return { imageUrl: dataUrl };
      }
    }
  }

  console.error('❌ [BULK] No image found in response');
  console.error('❌ [BULK] Message structure:', JSON.stringify(message, null, 2));
  throw new Error('No image URL found in OpenRouter response');
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Use jobId from frontend if provided, otherwise generate one
    const jobId = body.jobId || uuidv4();

    console.log('📥 [BULK] Received request body:', {
      jobId,
      bulkMethod: body.bulkMethod,
      hasTemplateImageUrl: !!body.selectedTemplateImageUrl,
      hasHtmlTemplate: !!body.htmlTemplate,
      hasUserIdentifiers: !!body.userIdentifiers,
      hasPosterName: !!body.posterName,
      hasPrompt: !!body.originalPrompt,
      hasSize: !!body.size,
    });

    const {
      bulkMethod,
      htmlTemplate,
      csvTemplate,
      csvData,
      csvColumns,
      selectedTemplateImageUrl,
      userIdentifiers,
      posterName,
      originalPrompt,
      size,
      customWidth,
      customHeight,
      skipOverlays,
      model: selectedModel,
      topmateLogo
    } = body as {
      bulkMethod?: 'prompt' | 'html' | 'csv';
      htmlTemplate?: string;
      csvTemplate?: string;
      csvData?: any[];
      csvColumns?: string[];
      selectedTemplateImageUrl?: string;
      userIdentifiers?: string;
      posterName: string;
      originalPrompt?: string;
      size: PosterSize;
      customWidth?: number;
      customHeight?: number;
      skipOverlays?: boolean;
      model?: 'pro' | 'flash';
      topmateLogo?: string;
    };

    // Validation based on bulk method
    if (bulkMethod === 'html') {
      if (!htmlTemplate) {
        console.error('❌ [BULK] Missing htmlTemplate for HTML mode');
        return NextResponse.json({
          success: false,
          error: 'Missing HTML template'
        }, { status: 400 });
      }
      if (!userIdentifiers) {
        console.error('❌ [BULK] Missing userIdentifiers');
        return NextResponse.json({
          success: false,
          error: 'Missing user identifiers'
        }, { status: 400 });
      }
    } else if (bulkMethod === 'csv') {
      if (!csvTemplate || !csvData || !csvColumns) {
        console.error('❌ [BULK] Missing CSV data for CSV mode');
        return NextResponse.json({
          success: false,
          error: 'Missing CSV template or data'
        }, { status: 400 });
      }
      if (!csvData.length) {
        console.error('❌ [BULK] Empty CSV data');
        return NextResponse.json({
          success: false,
          error: 'CSV data is empty'
        }, { status: 400 });
      }
    } else {
      if (!selectedTemplateImageUrl) {
        console.error('❌ [BULK] Missing selectedTemplateImageUrl');
        return NextResponse.json({
          success: false,
          error: 'Missing template image URL'
        }, { status: 400 });
      }
      if (!userIdentifiers) {
        console.error('❌ [BULK] Missing userIdentifiers');
        return NextResponse.json({
          success: false,
          error: 'Missing user identifiers'
        }, { status: 400 });
      }
    }

    if (!posterName) {
      console.error('❌ [BULK] Missing posterName');
      return NextResponse.json({
        success: false,
        error: 'Missing poster name'
      }, { status: 400 });
    }

    if (!size) {
      console.error('❌ [BULK] Missing size');
      return NextResponse.json({
        success: false,
        error: 'Missing poster size'
      }, { status: 400 });
    }

    console.log('🚀 [BULK] Starting bulk generation for', posterName);

    // Skip profile fetching for CSV mode
    let profiles: TopmateProfile[] = [];

    if (bulkMethod !== 'csv') {
      // Parse user identifiers
      const { usernames, userIds } = parseUserIdentifiers(userIdentifiers!);
      console.log(`📋 [BULK] Parsed identifiers: ${usernames.length} usernames, ${userIds.length} user IDs`);

    // User ID lookups via MCP removed - use direct API calls only

    // Fetch all profiles in parallel
    const usernameProfilePromises = usernames.map(u => fetchTopmateProfile(u).catch(err => {
      console.error(`❌ [BULK] Failed to fetch ${u}:`, err);
      return null;
    }));

    const userIdProfilePromises = userIds.map(id => fetchProfileByUserId(id).catch(err => {
      console.error(`❌ [BULK] Failed to fetch user ${id}:`, err);
      return null;
    }));

      const allProfileResults = await Promise.all([...usernameProfilePromises, ...userIdProfilePromises]);
      profiles = allProfileResults.filter((p): p is TopmateProfile => p !== null);
      console.log(`✅ [BULK] Fetched ${profiles.length} valid profiles`);

      if (profiles.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'No valid profiles found'
        }, { status: 400 });
      }
    }

    // Get dimensions - use custom dimensions if provided
    const dimensions = size === 'custom' && customWidth && customHeight
      ? { width: customWidth, height: customHeight }
      : size === 'custom'
      ? { width: 1080, height: 1080 }
      : POSTER_SIZE_DIMENSIONS[size as Exclude<PosterSize, 'custom'>] || POSTER_SIZE_DIMENSIONS['instagram-square'];
    console.log(`📐 [BULK] Using dimensions: ${dimensions.width}x${dimensions.height}`);

    // Setup API
    const apiKey = body.openRouterApiKey || OPENROUTER_API_KEY;

    const results = [];

    // CSV MODE: Use CSV data directly, no API calls
    if (bulkMethod === 'csv' && csvTemplate && csvData && csvColumns) {
      console.log('📊 [CSV] Using CSV mode with', csvData.length, 'rows');

      // Initialize progress tracking
      createProgress(jobId, csvData.length);
      console.log(`📊 [CSV] Progress tracking initialized for job ${jobId}`);

      // Convert dynamic HTML to placeholder-based HTML (removes JavaScript, fixes image placeholders)
      const convertedTemplate = convertDynamicHtmlToPlaceholder(csvTemplate, csvColumns);
      console.log('📝 [CSV] Template converted to placeholder-based format');

      const BATCH_SIZE = 8; // Process 8 images concurrently for faster generation
      console.log(`📦 [CSV] Processing ${csvData.length} rows in batches of ${BATCH_SIZE}`);

      for (let i = 0; i < csvData.length; i += BATCH_SIZE) {
        const batch = csvData.slice(i, i + BATCH_SIZE);
        console.log(`📦 [CSV] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(csvData.length / BATCH_SIZE)}`);

        await Promise.all(batch.map(async (row, batchIndex) => {
        try {
          const username = row.username || row.Username || 'unknown';
          console.log(`🎨 [CSV] Generating for ${username}...`);

          // Replace placeholders with CSV row data
          const filledHtml = replacePlaceholders(convertedTemplate, row, csvColumns);

          // Convert HTML to JPEG (faster than PNG, smaller file size)
          const exportResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/export-poster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: filledHtml,
              format: 'jpeg',
              quality: 75, // Good balance between quality and speed (0-100)
              width: dimensions.width,
              height: dimensions.height,
              scale: 1, // 1x resolution for faster processing
            }),
          });

          if (!exportResponse.ok) {
            throw new Error(`Failed to export HTML to image: ${exportResponse.status}`);
          }

          const imageBuffer = await exportResponse.arrayBuffer();
          const base64Image = Buffer.from(imageBuffer).toString('base64');
          const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

          console.log(`✅ [CSV] Converted HTML to JPEG for ${username}`);

          let finalImageUrl = imageDataUrl;

          // Apply logo overlay only if not skipped (no profile pic for CSV mode)
          if (!skipOverlays) {
            console.log(`🎨 [CSV] Applying logo overlay for ${username}...`);
            finalImageUrl = await overlayLogoAndProfile(
              imageDataUrl,
              topmateLogo || null,
              null, // No profile pic for CSV mode
              dimensions
            );
            console.log(`✅ [CSV] Completed image with overlays for ${username}`);
          } else {
            console.log(`⏭️ [CSV] Skipping overlays for ${username} (as requested)`);
          }

          // Upload to S3 with retry logic - DON'T store data URL in results to avoid JSON string length error
          // Stagger uploads to avoid overwhelming S3
          await new Promise(r => setTimeout(r, batchIndex * 800)); // 0ms, 800ms, 1600ms, 2400ms...

          let uploadSuccess = false;
          let uploadedUrl = '';
          const MAX_RETRIES = 3;

          for (let retryCount = 0; retryCount < MAX_RETRIES && !uploadSuccess; retryCount++) {
            try {
              if (retryCount > 0) {
                console.log(`🔄 [CSV] Retry ${retryCount}/${MAX_RETRIES} for ${username}`);
                await new Promise(r => setTimeout(r, 2000 * retryCount)); // Exponential backoff
              }

              const blob = await (await fetch(finalImageUrl)).blob();
              const formData = new FormData();
              formData.append('file', blob, `${username}-${Date.now()}.jpg`);

              const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
              const uploadResponse = await fetch(`${baseUrl}/api/upload-s3`, {
                method: 'POST',
                body: formData,
              });

              if (uploadResponse.ok) {
                const uploadData = await uploadResponse.json();
                uploadedUrl = uploadData.url;
                uploadSuccess = true;
                console.log(`✅ [CSV] Uploaded to S3: ${uploadedUrl}`);
              } else {
                throw new Error(`S3 upload failed with status ${uploadResponse.status}`);
              }
            } catch (uploadError) {
              console.error(`❌ [CSV] Upload attempt ${retryCount + 1} failed for ${username}:`, uploadError);
              if (retryCount === MAX_RETRIES - 1) {
                // Final retry failed
                results.push({
                  username: username,
                  imageUrl: '',
                  posterUrl: '',
                  success: false,
                  error: 'Failed to upload image after 3 retries'
                });
              }
            }
          }

          if (uploadSuccess) {
            results.push({
              username: username,
              imageUrl: uploadedUrl,
              posterUrl: uploadedUrl,
              success: true
            });
          }

        } catch (error) {
          const username = row.username || row.Username || 'unknown';
          console.error(`❌ [CSV] Failed for ${username}:`, error);
          results.push({
            username: username,
            imageUrl: '',
            posterUrl: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        })); // Close Promise.all and map

        // Progress update
        const currentCompleted = results.filter(r => r.success).length;
        const currentFailed = results.filter(r => !r.success).length;
        console.log(`📊 Progress: ${currentCompleted} completed, ${currentFailed} failed out of ${profiles?.length || csvData?.length || 0} total`);

        // Update progress tracking
        const username = batch[batch.length - 1]?.username || batch[batch.length - 1]?.Username || 'batch';
        updateProgress(jobId, {
          phase: 'generating',
          completed: currentCompleted,
          failed: currentFailed,
          currentItem: `${username} (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(csvData.length / BATCH_SIZE)})`
        });

        // Brief delay between batches
        await new Promise(r => setTimeout(r, 1000));
      } // Close batch for loop
    }
    // HTML TEMPLATE MODE: Replace placeholders and convert to PNG
    else if (bulkMethod === 'html' && htmlTemplate) {
      console.log('📝 [BULK] Using HTML template mode');

      const BATCH_SIZE = 8;
      console.log(`📦 [BULK] Processing ${profiles.length} users in batches of ${BATCH_SIZE}`);

      for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
        const batch = profiles.slice(i, i + BATCH_SIZE);
        console.log(`📦 [BULK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(profiles.length / BATCH_SIZE)}`);

        await Promise.all(batch.map(async (profile) => {
        try {
          console.log(`🎨 [BULK] Generating for ${profile.username} (ID: ${profile.user_id}) using HTML...`);

          // Replace placeholders with real profile data
          const filledHtml = htmlTemplate
            .replace(/{display_name}/g, profile.display_name || '')
            .replace(/{username}/g, profile.username || '')
            .replace(/{profile_pic}/g, profile.profile_pic || '')
            .replace(/{bio}/g, profile.bio || '')
            .replace(/{total_bookings}/g, String(profile.total_bookings || 0))
            .replace(/{average_rating}/g, String(profile.average_rating || 0))
            .replace(/{first_name}/g, profile.first_name || '')
            .replace(/{last_name}/g, profile.last_name || '')
            .replace(/{total_reviews}/g, String(profile.total_reviews || 0))
            .replace(/{expertise_category}/g, profile.expertise_category || '');

          // Convert HTML to JPEG using export API (faster than PNG)
          const exportResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/export-poster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: filledHtml,
              format: 'jpeg',
              quality: 75, // Good balance between quality and speed
              width: dimensions.width,
              height: dimensions.height,
              scale: 1, // 1x resolution for faster processing
            }),
          });

          if (!exportResponse.ok) {
            throw new Error(`Failed to export HTML to image: ${exportResponse.status}`);
          }

          // Get JPEG as buffer
          const imageBuffer = await exportResponse.arrayBuffer();
          const base64Image = Buffer.from(imageBuffer).toString('base64');
          const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

          console.log(`✅ [BULK] Converted HTML to JPEG for ${profile.username}`);

          // Overlay logo and profile picture
          console.log(`🎨 [BULK] Applying logo and profile overlays for ${profile.username}...`);
          const finalImageUrl = await overlayLogoAndProfile(
            imageDataUrl,
            topmateLogo || null,
            profile.profile_pic,
            dimensions
          );

          console.log(`✅ [BULK] Completed image with overlays for ${profile.username}`);

          // Upload to S3 - DON'T store data URL in results to avoid JSON string length error
          try {
            const blob = await (await fetch(finalImageUrl)).blob();
            const formData = new FormData();
            formData.append('file', blob, `${profile.username}-${Date.now()}.jpg`);

            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
            const uploadResponse = await fetch(`${baseUrl}/api/upload-s3`, {
              method: 'POST',
              body: formData,
            });

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              console.log(`✅ [BULK] Uploaded to S3: ${uploadData.url}`);

              // Store only metadata, not the image data URL
              results.push({
                userId: profile.user_id,
                username: profile.username,
                imageUrl: uploadData.url,
                posterUrl: uploadData.url,
                success: true
              });
            } else {
              throw new Error('S3 upload failed');
            }
          } catch (uploadError) {
            console.error(`❌ [BULK] Upload failed for ${profile.username}:`, uploadError);
            results.push({
              userId: profile.user_id,
              username: profile.username,
              imageUrl: '',
              posterUrl: '',
              success: false,
              error: 'Failed to upload image'
            });
          }

        } catch (error) {
          console.error(`❌ [BULK] Failed for ${profile.username}:`, error);
          results.push({
            userId: profile.user_id,
            username: profile.username,
            imageUrl: '',
            posterUrl: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        })); // Close Promise.all and map

        // Progress update
        const currentCompleted = results.filter(r => r.success).length;
        const currentFailed = results.filter(r => !r.success).length;
        console.log(`📊 Progress: ${currentCompleted} completed, ${currentFailed} failed out of ${profiles?.length || csvData?.length || 0} total`);

        // Brief delay between batches
        await new Promise(r => setTimeout(r, 1000));
      } // Close batch for loop
    }
    // IMAGE-BASED MODE: Use AI to generate with reference template
    else {
      // Convert template image URL to data URL for reference
      console.log('🖼️ [BULK] Fetching template image as reference');
      const templateDataUrl = await fetchImageAsDataUrl(selectedTemplateImageUrl!);

      if (!templateDataUrl) {
        return NextResponse.json({
          success: false,
          error: 'Failed to fetch template image'
        }, { status: 400 });
      }

      // Generate images for each profile using nano banana with batch processing
      const BATCH_SIZE = 8; // Process 10 users concurrently
      console.log(`📦 [BULK] Processing ${profiles.length} users in batches of ${BATCH_SIZE}`);

      for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
        const batch = profiles.slice(i, i + BATCH_SIZE);
        console.log(`📦 [BULK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(profiles.length / BATCH_SIZE)}`);

        // Process batch concurrently
        await Promise.all(batch.map(async (profile) => {
        try {
          console.log(`🎨 [BULK] Generating for ${profile.username} (ID: ${profile.user_id})...`);

          // Build prompt with real profile data
          const promptText = `Create a poster matching the reference template's EXACT style, layout, colors, and typography.

Use this user's REAL data:
- Name: ${profile.display_name}
- Username: @${profile.username}
- Bio: ${profile.bio || 'Professional creator'}
- Total Bookings: ${profile.total_bookings}
- Rating: ${profile.average_rating}/5 ⭐
- Profile Picture: Provided as second image

Original Context: ${originalPrompt || ''}

CRITICAL: Match the reference design's visual style EXACTLY, but replace all text and data with this user's information.`;

          // Generate image using nano banana (without logo/profile - will overlay later)
          const imageResult = await callOpenRouterForImage(
            apiKey,
            IMAGE_GENERATION_SYSTEM_PROMPT,
            promptText,
            dimensions,
            templateDataUrl // Reference template only
          );

          console.log(`✅ [BULK] Generated base image for ${profile.username}`);

          // Overlay logo and profile picture for reliability
          console.log(`🎨 [BULK] Applying logo and profile overlays for ${profile.username}...`);
          const finalImageUrl = await overlayLogoAndProfile(
            imageResult.imageUrl,
            topmateLogo || null,
            profile.profile_pic,
            dimensions
          );

          console.log(`✅ [BULK] Completed image with overlays for ${profile.username}`);

          // Upload to S3 - DON'T store data URL in results to avoid JSON string length error
          try {
            const blob = await (await fetch(finalImageUrl)).blob();
            const formData = new FormData();
            formData.append('file', blob, `${profile.username}-${Date.now()}.jpg`);

            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
            const uploadResponse = await fetch(`${baseUrl}/api/upload-s3`, {
              method: 'POST',
              body: formData,
            });

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              console.log(`✅ [BULK] Uploaded to S3: ${uploadData.url}`);

              // Store only metadata, not the image data URL
              results.push({
                userId: profile.user_id,
                username: profile.username,
                imageUrl: uploadData.url,
                posterUrl: uploadData.url,
                success: true
              });
            } else {
              throw new Error('S3 upload failed');
            }
          } catch (uploadError) {
            console.error(`❌ [BULK] Upload failed for ${profile.username}:`, uploadError);
            results.push({
              userId: profile.user_id,
              username: profile.username,
              imageUrl: '',
              posterUrl: '',
              success: false,
              error: 'Failed to upload image'
            });
          }

        } catch (error) {
          console.error(`❌ [BULK] Failed for ${profile.username}:`, error);
          results.push({
            userId: profile.user_id,
            username: profile.username,
            imageUrl: '',
            posterUrl: '',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        })); // Close Promise.all and map

        // Progress update
        const currentCompleted = results.filter(r => r.success).length;
        const currentFailed = results.filter(r => !r.success).length;
        console.log(`📊 Progress: ${currentCompleted} completed, ${currentFailed} failed out of ${profiles?.length || csvData?.length || 0} total`);

        // Brief delay between batches
        await new Promise(r => setTimeout(r, 1000));
      } // Close batch for loop
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    console.log(`🎉 [BULK] Completed: ${successCount} succeeded, ${failureCount} failed`);

    // Mark progress as complete
    completeProgress(jobId);

    return NextResponse.json({
      success: true,
      jobId,
      results,
      successCount,
      failureCount
    });

  } catch (error) {
    console.error('❌ [BULK] Bulk generation error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate bulk posters'
    }, { status: 500 });
  }
}
