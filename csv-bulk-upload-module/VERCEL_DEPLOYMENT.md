# CSV Bulk Upload - Deployment Guide

## ✅ Code Pushed to GitHub
Repository: https://github.com/Jaisrinivasan23/CSV-Standalone.git

## 🚀 Deploy to Vercel (Free Tier)

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Go to Vercel**: https://vercel.com/
2. **Sign in** with your GitHub account
3. **Click "Add New"** → **"Project"**
4. **Import** your repository: `Jaisrinivasan23/CSV-Standalone`
5. **Configure Project**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `csv-bulk-upload-module`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`
6. **Add Environment Variables**:
   - Click "Environment Variables"
   - Add these from your `.env.local` file:
     ```
     # Django API
     NEXT_PUBLIC_DJANGO_API_URL=https://gcp.galactus.run
     
     # AWS S3
     AWS_S3_BUCKET=topmate-staging
     AWS_ACCESS_KEY_ID=your-key
     AWS_SECRET_ACCESS_KEY=your-secret
     AWS_REGION=ap-south-1
     AWS_REGION_CUSTOM=ap-south-1
     S3_BASE_URL=https://topmate-staging.s3.ap-south-1.amazonaws.com
     
     # Base URL (LEAVE BLANK - will auto-set after deployment)
     NEXT_PUBLIC_BASE_URL=
     
     # Optional - if using Lambda
     SQS_QUEUE_URL=your-queue-url
     DYNAMODB_JOBS_TABLE=your-table
     
     # Next.js
     NODE_ENV=production
     DISABLE_IMAGE_OPTIMIZATION=true
     ```
7. **Click "Deploy"**
8. **After First Deployment**:
   - Copy your Vercel URL (e.g., `https://csv-standalone.vercel.app`)
   - Go to **Settings** → **Environment Variables**
   - Update `NEXT_PUBLIC_BASE_URL` to your Vercel URL
   - **Redeploy** the project

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy from the csv-bulk-upload-module directory
cd csv-bulk-upload-module
vercel

# Follow the prompts:
# - Set up and deploy? Y
# - Which scope? (select your account)
# - Link to existing project? N
# - What's your project's name? csv-bulk-upload
# - In which directory is your code located? ./
# - Want to override the settings? N
```

## 📋 Important Notes for Vercel Free Tier

### Limitations:
- **Serverless Function Timeout**: 10 seconds max
- **Max Function Size**: 50MB
- **Build Time**: 45 minutes max per month
- **Bandwidth**: 100GB per month

### Recommendations:
1. **Remove Puppeteer dependencies** from the frontend (they're too large)
2. **Use external APIs** for heavy processing
3. **Keep AWS Lambda** for the actual poster generation
4. **Use Vercel** only for the UI and API routes

### Updated package.json (Optional - for smaller deployment):

If you face size issues, remove these from `package.json`:
```json
"@sparticuz/chromium-min": "^143.0.0",
"puppeteer": "^24.34.0",
"puppeteer-core": "^24.34.0",
```

The poster generation should happen via AWS Lambda (handlers folder).

## 🔧 Post-Deployment

1. **Test the deployed URL**: https://your-project.vercel.app
2. **Check Environment Variables** in Vercel dashboard
3. **Monitor Build Logs** for any errors
4. **Set up Custom Domain** (optional, free on Vercel)

## 🐛 Troubleshooting

### Build Fails:
- Check build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Verify environment variables are set

### Function Timeout:
- Move heavy processing to AWS Lambda
- Use background jobs for bulk operations

### Size Limit Exceeded:
- Remove unused dependencies
- Use external CDNs for large assets
- Optimize images with Next.js Image component

## 📊 Architecture

```
User → Vercel (UI) → AWS API Gateway → Lambda (Processing) → S3/DynamoDB
```

The Vercel deployment handles:
- Frontend UI (clean light theme)
- API routes that trigger AWS Lambda
- Real-time progress updates

AWS Lambda handles:
- Heavy poster generation
- Puppeteer/Chromium processing
- Parallel processing of CSV rows
