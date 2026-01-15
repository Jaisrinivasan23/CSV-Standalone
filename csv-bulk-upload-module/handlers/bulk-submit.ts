import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const sqsClient = new SQSClient({ region: process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || 'us-east-1' });

// Configuration for micro-batch processing
const BATCH_SIZE = 50; // Process 50 images per batch (optimized for 15min Lambda timeout)

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Bulk job submission started');

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { userIdentifiers, userId, ...jobData } = body;

    if (!userIdentifiers) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing userIdentifiers parameter',
        }),
      };
    }

    // Generate unique job ID
    const jobId = uuidv4();
    const submittedBy = userId || 'anonymous';
    const createdAt = Date.now();

    // Parse user identifiers (comma-separated or array)
    const userList = Array.isArray(userIdentifiers)
      ? userIdentifiers
      : userIdentifiers.split(',').map((u: string) => u.trim()).filter((u: string) => u);

    const totalUsers = userList.length;

    if (totalUsers === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'No valid user identifiers provided',
        }),
      };
    }

    // Split users into micro-batches
    const batches: string[][] = [];
    for (let i = 0; i < userList.length; i += BATCH_SIZE) {
      batches.push(userList.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;

    console.log(`Job ${jobId}: Processing ${totalUsers} users in ${totalBatches} batches of ${BATCH_SIZE}`);

    // Store job metadata in DynamoDB
    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.DYNAMODB_JOBS_TABLE!,
      Item: {
        jobId: { S: jobId },
        userId: { S: submittedBy },
        status: { S: 'queued' },
        totalUsers: { N: totalUsers.toString() },
        totalBatches: { N: totalBatches.toString() },
        completedBatches: { N: '0' },
        successCount: { N: '0' },
        failureCount: { N: '0' },
        createdAt: { N: createdAt.toString() },
        updatedAt: { N: createdAt.toString() },
        ttl: { N: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000).toString() }, // 7 days
        jobData: { S: JSON.stringify(jobData) },
      },
    }));

    console.log(`Job ${jobId}: Metadata stored in DynamoDB`);

    // Send each batch to SQS queue
    const queueUrl = process.env.SQS_QUEUE_URL!;
    for (let i = 0; i < batches.length; i++) {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          jobId,
          batchIndex: i,
          totalBatches,
          users: batches[i],
          ...jobData,
        }),
        MessageAttributes: {
          jobId: { StringValue: jobId, DataType: 'String' },
          batchIndex: { StringValue: i.toString(), DataType: 'Number' },
        },
      }));
    }

    console.log(`Job ${jobId}: ${totalBatches} batches sent to SQS`);

    // Calculate estimated completion time
    const avgTimePerImage = 30; // seconds
    const concurrentWorkers = Math.min(totalBatches, 100); // Max 100 workers
    const estimatedMinutes = Math.ceil((totalUsers * avgTimePerImage) / (concurrentWorkers * 60));

    return {
      statusCode: 202, // Accepted
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId,
        status: 'queued',
        totalUsers,
        totalBatches,
        batchSize: BATCH_SIZE,
        estimatedCompletionMinutes: estimatedMinutes,
        message: `Bulk generation job queued. Use GET /api/job-status/${jobId} to check progress.`,
        pollUrl: `/api/job-status/${jobId}`,
      }),
    };
  } catch (error) {
    console.error('Bulk job submission error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit bulk job',
      }),
    };
  }
}
