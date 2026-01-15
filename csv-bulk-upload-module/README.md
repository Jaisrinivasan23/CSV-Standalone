# 📊 CSV Bulk Upload Module

Standalone module for generating posters in bulk from CSV data with AWS Lambda parallel processing.

## 🎯 Features

- ✅ **CSV Upload**: Upload CSV files with custom data
- ✅ **HTML Templates**: Use placeholder-based HTML templates
- ✅ **Real-time Progress**: Live progress tracking during generation
- ✅ **Parallel Processing**: AWS Lambda processes batches in parallel
- ✅ **S3 Storage**: Automatic upload to AWS S3
- ✅ **Database Storage**: Save results to Django backend
- ✅ **Error Handling**: Display failed items with error messages

## 📦 What's Included

```
csv-bulk-upload-module/
├── app/
│   ├── api/                     # Backend API routes
│   │   ├── generate-bulk/       # Bulk generation endpoint
│   │   ├── bulk-progress/       # Progress tracking endpoint
│   │   ├── save-bulk-posters/   # Database storage endpoint
│   │   └── upload-s3/           # S3 upload endpoint
│   ├── components/              # React components
│   │   └── CSVBulkUpload.tsx   # Main CSV upload UI
│   ├── lib/                     # Utility libraries
│   │   ├── topmate.ts           # Topmate API integration
│   │   ├── image-overlay.ts     # Image processing
│   │   ├── bulk-progress.ts     # Progress tracking
│   │   └── ...
│   ├── types/                   # TypeScript types
│   ├── page.tsx                 # Main page
│   └── layout.tsx               # App layout
├── handlers/                    # AWS Lambda handlers
│   ├── bulk-submit.ts           # Job submission handler
│   ├── bulk-worker.ts           # Batch processing worker
│   └── job-status.ts            # Job status handler
├── package.json                 # Dependencies
├── next.config.ts               # Next.js configuration
├── serverless.yml               # AWS Lambda configuration
├── .env.example                 # Environment variables template
└── README.md                    # This file
```

---

## 🚀 Quick Start (Local Development)

### Step 1: Install Dependencies

```bash
cd csv-bulk-upload-module
npm install
```

### Step 2: Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```bash
# Django API
NEXT_PUBLIC_DJANGO_API_URL=https://gcp.galactus.run

# AWS S3 (get from AWS Console)
AWS_S3_BUCKET=topmate-staging
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=ap-south-1
S3_BASE_URL=https://topmate-staging.s3.ap-south-1.amazonaws.com

# Base URL
NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

### Step 3: Run Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser!

---

## 📝 How to Use

### 1. Upload CSV File

Upload a CSV file with your data. For example:

```csv
username,title,description,image_url
john_doe,Summer Sale,50% off all items,https://example.com/image1.jpg
jane_smith,New Arrival,Check out our latest,https://example.com/image2.jpg
```

### 2. Create HTML Template

Use placeholders like `{column_name}` to insert CSV data:

```html
<div style="width:1080px; height:1350px; background:#fff; padding:40px;">
  <h1 style="font-size:48px; color:#333;">{title}</h1>
  <p style="font-size:24px; color:#666;">{description}</p>
  <img src="{image_url}" style="width:100%; height:auto;" />
  <p style="font-size:18px; color:#999;">@{username}</p>
</div>
```

### 3. Configure & Generate

- Enter campaign name
- Set custom dimensions (default: 1080x1350)
- Click **Generate**
- Watch real-time progress!

### 4. Save to Database

After generation completes, click **Save to Database** to store results.

---

## ☁️ AWS Lambda Deployment

Deploy to AWS Lambda for **parallel processing** and **20-25x faster generation**!

### Performance Comparison

| Environment | 200 Images | Workers |
|-------------|-----------|---------|
| **Local** | 50 minutes | 1 laptop |
| **AWS Lambda** | **2-3 minutes** | 4 parallel workers |

### Deployment Steps

#### 1. Configure AWS CLI

```bash
aws configure
# AWS Access Key ID: your-key
# AWS Secret Access Key: your-secret
# Default region: ap-south-1
# Output format: json
```

#### 2. Install Serverless Framework

```bash
npm install -g serverless
```

#### 3. Create Sharp Lambda Layer

Sharp needs Linux binaries for Lambda:

```bash
# Create layer directory
mkdir -p layers/sharp/nodejs
cd layers/sharp/nodejs

# Create package.json
echo '{"dependencies":{"sharp":"^0.33.0","@sparticuz/chromium":"^126.0.0"}}' > package.json

# Install for Linux
npm install --arch=x64 --platform=linux

# Create layer structure
cd ..
mkdir nodejs
move node_modules nodejs/

# Zip the layer
cd ..
powershell Compress-Archive -Path sharp/nodejs -DestinationPath sharp-layer.zip -Force

# Upload to AWS (ap-south-1 region)
aws lambda publish-layer-version \
  --layer-name csv-bulk-upload-sharp-layer \
  --description "Sharp and Chromium for CSV Bulk Upload" \
  --compatible-runtimes nodejs20.x \
  --region ap-south-1 \
  --zip-file fileb://sharp-layer.zip
```

**Copy the Layer ARN** from output and add to `.env.local`:

```bash
SHARP_LAYER_ARN=arn:aws:lambda:ap-south-1:YOUR_ACCOUNT_ID:layer:csv-bulk-upload-sharp-layer:1
```

#### 4. Build & Deploy

```bash
# Build Next.js app
npm run build

# Deploy to AWS Lambda
npm run deploy:prod
```

Wait 5-7 minutes for deployment to complete.

#### 5. Update Base URL

After deployment, copy the **API URL** from output:

```
Stack Outputs:
  ApiUrl: https://abc123xyz.execute-api.ap-south-1.amazonaws.com
```

Update `.env.local`:

```bash
NEXT_PUBLIC_BASE_URL=https://abc123xyz.execute-api.ap-south-1.amazonaws.com
```

Redeploy:

```bash
npm run build
npm run deploy:prod
```

#### 6. Test Deployment

1. Open the Lambda URL in browser
2. Upload CSV with 5 rows
3. Generate posters
4. Should complete in ~30 seconds!
5. Test with 200 rows (should complete in 2-3 minutes)

---

## 🔧 Configuration

### Micro-Batch Settings

In `serverless.yml`:

```yaml
bulkWorker:
  timeout: 900              # 15 minutes max
  memorySize: 2048          # 2GB RAM
  reservedConcurrency: 10   # 10 parallel workers
```

In `handlers/bulk-submit.ts`:

```typescript
const BATCH_SIZE = 50; // 50 images per batch
```

### Performance Tuning

**For faster processing** (increases cost by 30%):

```typescript
// In handlers/bulk-submit.ts
const BATCH_SIZE = 25; // Smaller batches = more parallelism
```

```yaml
# In serverless.yml
reservedConcurrency: 20  # More workers
```

---

## 📊 Monitoring

### View Lambda Logs

```bash
# Bulk worker logs
npm run logs:bulk

# Job submission logs
npm run logs:submit
```

### Check Job Status

```bash
# Get job status by ID
curl https://your-api-url/api/job-status/your-job-id
```

### DynamoDB Jobs

```bash
# List recent jobs
aws dynamodb scan \
  --table-name csv-bulk-upload-jobs-prod \
  --limit 10 \
  --region ap-south-1
```

### SQS Queue Stats

```bash
# Get queue attributes
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-south-1.amazonaws.com/.../csv-bulk-upload-queue-prod \
  --attribute-names All \
  --region ap-south-1
```

---

## 💰 Cost Estimation

### Per 200 Image Generation:

| Service | Usage | Cost |
|---------|-------|------|
| Lambda invocations | 4 workers × 2 min | $0.02 |
| Lambda memory | 4 × 2GB × 2 min | $0.03 |
| DynamoDB | 200 writes + 400 reads | $0.0003 |
| SQS | 4 messages | $0.000002 |
| S3 uploads | 200 images | $0.001 |
| **Total** | | **~$0.05** |

### Monthly (100 runs of 200 images):

```
100 runs × $0.05 = $5/month
+ CloudWatch Logs: $2/month
+ DynamoDB storage: $1/month
─────────────────────────────
Total: ~$8-10/month
```

**AWS Free Tier covers most of this for the first year!**

---

## 🐛 Troubleshooting

### Issue: CSV not parsing

**Solution**: Ensure CSV is properly formatted with headers in first row.

### Issue: Template placeholders not working

**Solution**: Use exact column names from CSV: `{column_name}` (case-sensitive).

### Issue: Images not generating

**Check**:
1. S3 credentials are correct
2. S3 bucket exists and has proper permissions
3. Django API is accessible

### Issue: Lambda deployment fails

**Solution**:
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check if Sharp layer exists
aws lambda list-layers --region ap-south-1

# Verify .env.local has SHARP_LAYER_ARN
```

### Issue: Timeout after 15 minutes

**Solution**: Reduce batch size in `handlers/bulk-submit.ts`:

```typescript
const BATCH_SIZE = 40; // Reduce from 50 to 40
```

---

## 🔄 Updating After Changes

```bash
# After code changes
npm run build
npm run deploy:prod
```

---

## 🗑️ Removing Deployment

```bash
# Remove all AWS resources
npm run remove:prod
```

This will delete:
- Lambda functions
- SQS queues
- DynamoDB table
- API Gateway

(S3 bucket and Sharp layer are not auto-deleted)

---

## 📞 Support

### Useful Commands

```bash
# Check deployment info
npx serverless info --stage prod

# View function logs
npx serverless logs -f bulkWorker --stage prod --tail

# Invoke function manually
npx serverless invoke -f submitBulkJob --stage prod --data '{"test": true}'
```

### Common Scripts

```bash
npm run dev          # Start local development server
npm run build        # Build Next.js app
npm run deploy       # Deploy to dev stage
npm run deploy:prod  # Deploy to production
npm run remove:prod  # Remove production deployment
npm run logs:bulk    # View bulk worker logs
```

---

## 📜 License

Private internal use only.

---

## 🎉 Summary

This standalone module provides:

- ✅ **Independent Operation**: Run separately from main app
- ✅ **Fast Local Development**: `npm run dev` on port 3001
- ✅ **AWS Lambda Deployment**: 20-25x faster with parallel processing
- ✅ **Real-time Progress**: Live updates during generation
- ✅ **Production-Ready**: Handles 200+ images in 2-3 minutes
- ✅ **Low Cost**: ~$8-10/month for internal use

**Ready to use!** 🚀
