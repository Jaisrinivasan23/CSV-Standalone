import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate S3 configuration - supports both local and Lambda deployment
    // Prefer server-side env vars (Lambda), fall back to NEXT_PUBLIC_ (local dev)
    const bucket = process.env.AWS_S3_BUCKET || process.env.NEXT_PUBLIC_AWS_S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
    const s3BaseUrl = process.env.S3_BASE_URL || process.env.NEXT_PUBLIC_S3_BASE_URL;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      return NextResponse.json(
        { error: 'S3 configuration missing' },
        { status: 500 }
      );
    }

    // Initialize S3 client
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name;
    const key = `posters/${Date.now()}-${filename}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      ACL: 'public-read', // Make file publicly accessible
    });

    await s3Client.send(command);

    // Construct the public URL
    const url = s3BaseUrl
      ? `${s3BaseUrl}/${key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error('S3 upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
