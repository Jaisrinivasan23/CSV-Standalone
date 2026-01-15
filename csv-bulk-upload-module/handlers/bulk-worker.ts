import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || 'us-east-1' });

// Import the bulk generation logic
// This will need to be extracted from app/api/generate-bulk/route.ts
// For now, this is a placeholder that shows the structure

export async function handler(event: SQSEvent): Promise<void> {
  console.log(`Processing ${event.Records.length} SQS messages`);

  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { jobId, batchIndex, totalBatches, users, ...jobData } = message;

  console.log(`[Job ${jobId}] Processing batch ${batchIndex + 1}/${totalBatches} with ${users.length} users`);

  try {
    // Update job status to "processing" on first batch
    if (batchIndex === 0) {
      await updateJobField(jobId, 'status', 'processing');
      await updateJobField(jobId, 'startedAt', Date.now().toString());
    }

    // Process this batch of users
    // TODO: This needs to call the actual bulk generation logic
    // For now, this is a placeholder that simulates processing
    const results = await processBatch(users, jobData);

    // Update job progress atomically
    await updateJobProgress(jobId, results.successCount, results.failureCount);

    // Check if this was the last batch
    const job = await getJob(jobId);
    const completedBatches = parseInt(job.completedBatches) || 0;

    console.log(`[Job ${jobId}] Batch ${batchIndex + 1} complete. Total progress: ${completedBatches}/${totalBatches}`);

    if (completedBatches >= totalBatches) {
      // Mark job as completed
      await dynamoClient.send(new UpdateItemCommand({
        TableName: process.env.DYNAMODB_JOBS_TABLE!,
        Key: { jobId: { S: jobId } },
        UpdateExpression: 'SET #status = :completed, completedAt = :now, updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':completed': { S: 'completed' },
          ':now': { N: Date.now().toString() },
        },
      }));

      console.log(`[Job ${jobId}] ✅ COMPLETED! Total: ${job.successCount} succeeded, ${job.failureCount} failed`);
    }
  } catch (error) {
    console.error(`[Job ${jobId}] Batch ${batchIndex} failed:`, error);

    // Update job with error
    await dynamoClient.send(new UpdateItemCommand({
      TableName: process.env.DYNAMODB_JOBS_TABLE!,
      Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :failed, #error = :error, failedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
      },
      ExpressionAttributeValues: {
        ':failed': { S: 'failed' },
        ':error': { S: error instanceof Error ? error.message : 'Unknown error' },
        ':now': { N: Date.now().toString() },
      },
    }));

    // Re-throw to trigger SQS retry (will go to DLQ after 3 attempts)
    throw error;
  }
}

async function processBatch(users: string[], jobData: any): Promise<{ successCount: number; failureCount: number }> {
  console.log(`Processing ${users.length} users in parallel`);

  // Process users in parallel (not sequentially!)
  const results = await Promise.allSettled(
    users.map(user => generatePosterForUser(user, jobData))
  );

  const successCount = results.filter(r => r.status === 'fulfilled').length;
  const failureCount = results.filter(r => r.status === 'rejected').length;

  console.log(`Batch complete: ${successCount} succeeded, ${failureCount} failed`);

  return { successCount, failureCount };
}

async function generatePosterForUser(user: string, jobData: any): Promise<any> {
  // TODO: Extract this logic from app/api/generate-bulk/route.ts
  // This should:
  // 1. Fetch user profile data (from Topmate API or database)
  // 2. Generate poster using AI model
  // 3. Apply overlays (logo, profile picture)
  // 4. Upload to S3
  // 5. Save metadata to database

  console.log(`Generating poster for user: ${user}`);

  // Placeholder: simulate generation time
  await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

  // Return generated poster data
  return {
    user,
    success: true,
    url: `https://example.com/posters/${user}.png`,
  };
}

async function updateJobProgress(jobId: string, successCount: number, failureCount: number): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
    TableName: process.env.DYNAMODB_JOBS_TABLE!,
    Key: { jobId: { S: jobId } },
    UpdateExpression: `
      ADD completedBatches :inc,
          successCount :success,
          failureCount :failure
      SET updatedAt = :now
    `,
    ExpressionAttributeValues: {
      ':inc': { N: '1' },
      ':success': { N: successCount.toString() },
      ':failure': { N: failureCount.toString() },
      ':now': { N: Date.now().toString() },
    },
  }));
}

async function updateJobField(jobId: string, field: string, value: string): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
    TableName: process.env.DYNAMODB_JOBS_TABLE!,
    Key: { jobId: { S: jobId } },
    UpdateExpression: `SET #field = :value, updatedAt = :now`,
    ExpressionAttributeNames: {
      '#field': field,
    },
    ExpressionAttributeValues: {
      ':value': { S: value },
      ':now': { N: Date.now().toString() },
    },
  }));
}

async function getJob(jobId: string): Promise<any> {
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: process.env.DYNAMODB_JOBS_TABLE!,
    Key: { jobId: { S: jobId } },
  }));

  if (!result.Item) {
    throw new Error(`Job ${jobId} not found`);
  }

  return unmarshall(result.Item);
}
