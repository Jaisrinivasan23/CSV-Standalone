import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || 'us-east-1' });

// Get job status by jobId
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const jobId = event.pathParameters?.jobId;

    if (!jobId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing jobId parameter' }),
      };
    }

    const result = await dynamoClient.send(new GetItemCommand({
      TableName: process.env.DYNAMODB_JOBS_TABLE!,
      Key: { jobId: { S: jobId } },
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Job not found',
          jobId,
        }),
      };
    }

    // Parse DynamoDB item
    const item = unmarshall(result.Item);

    // Calculate progress percentage
    const completedBatches = parseInt(item.completedBatches) || 0;
    const totalBatches = parseInt(item.totalBatches) || 1;
    const percentComplete = Math.round((completedBatches / totalBatches) * 100);

    // Calculate estimated time remaining
    const successCount = parseInt(item.successCount) || 0;
    const failureCount = parseInt(item.failureCount) || 0;
    const totalUsers = parseInt(item.totalUsers) || 0;
    const processedUsers = successCount + failureCount;
    const remainingUsers = totalUsers - processedUsers;

    let estimatedTimeRemaining = null;
    if (item.status === 'processing' && processedUsers > 0) {
      const elapsedTime = Date.now() - parseInt(item.startedAt || item.createdAt);
      const avgTimePerUser = elapsedTime / processedUsers;
      const remainingMs = avgTimePerUser * remainingUsers;
      estimatedTimeRemaining = Math.ceil(remainingMs / 60000); // Convert to minutes
    }

    // Build response with progress metrics
    const response = {
      jobId: item.jobId,
      userId: item.userId,
      status: item.status,

      // Progress metrics
      totalUsers,
      processedUsers,
      remainingUsers,
      successCount,
      failureCount,

      // Batch metrics
      totalBatches,
      completedBatches,
      remainingBatches: totalBatches - completedBatches,

      // Progress visualization
      percentComplete,
      progressBar: '█'.repeat(Math.floor(percentComplete / 5)) + '░'.repeat(20 - Math.floor(percentComplete / 5)),

      // Time estimates
      estimatedTimeRemainingMinutes: estimatedTimeRemaining,

      // Timestamps
      createdAt: parseInt(item.createdAt),
      startedAt: item.startedAt ? parseInt(item.startedAt) : null,
      completedAt: item.completedAt ? parseInt(item.completedAt) : null,
      failedAt: item.failedAt ? parseInt(item.failedAt) : null,
      updatedAt: item.updatedAt ? parseInt(item.updatedAt) : parseInt(item.createdAt),

      // Error info (if failed)
      error: item.error || null,

      // Results (if completed)
      results: item.results ? JSON.parse(item.results) : null,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Job status error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to retrieve job status',
      }),
    };
  }
}

// List all jobs for a user (optional endpoint)
export async function listJobs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const userId = event.queryStringParameters?.userId || 'anonymous';
    const limit = parseInt(event.queryStringParameters?.limit || '10');

    const result = await dynamoClient.send(new QueryCommand({
      TableName: process.env.DYNAMODB_JOBS_TABLE!,
      IndexName: 'UserIdCreatedAtIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': { S: userId },
      },
      ScanIndexForward: false, // Sort by createdAt DESC (newest first)
      Limit: limit,
    }));

    const jobs = (result.Items || []).map(item => {
      const job = unmarshall(item);
      const completedBatches = parseInt(job.completedBatches) || 0;
      const totalBatches = parseInt(job.totalBatches) || 1;

      return {
        jobId: job.jobId,
        status: job.status,
        totalUsers: parseInt(job.totalUsers),
        successCount: parseInt(job.successCount) || 0,
        failureCount: parseInt(job.failureCount) || 0,
        percentComplete: Math.round((completedBatches / totalBatches) * 100),
        createdAt: parseInt(job.createdAt),
        completedAt: job.completedAt ? parseInt(job.completedAt) : null,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        jobs,
        count: jobs.length,
      }),
    };
  } catch (error) {
    console.error('List jobs error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to list jobs',
      }),
    };
  }
}
