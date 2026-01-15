# 🚀 Quick Start Guide - CSV Bulk Upload Module

## ⚡ Get Started in 3 Minutes

### Step 1: Install Dependencies (1 minute)

```bash
cd csv-bulk-upload-module
npm install
```

### Step 2: Run Development Server (30 seconds)

```bash
npm run dev
```

✅ Open [http://localhost:3001](http://localhost:3001)

**That's it! You're ready to use the module locally.**

---

## 🎯 Using the Module

### 1. Prepare Your CSV File

Create a CSV file with your data:

```csv
username,title,description
john_doe,Summer Sale,50% off everything
jane_smith,New Arrival,Latest collection
```

### 2. Create HTML Template

Use `{column_name}` placeholders:

```html
<div style="width:1080px; height:1350px; padding:40px; background:#fff;">
  <h1>{title}</h1>
  <p>{description}</p>
  <p>By @{username}</p>
</div>
```

### 3. Upload & Generate

1. Upload your CSV file
2. Paste HTML template
3. Enter campaign name
4. Click "Generate"
5. Watch real-time progress!

---

## ☁️ Deploy to AWS Lambda (Optional)

For **20-25x faster processing** with parallel workers:

### Quick Deploy (15 minutes)

```bash
# 1. Configure AWS CLI
aws configure

# 2. Create Sharp layer
mkdir -p layers/sharp/nodejs && cd layers/sharp/nodejs
echo '{"dependencies":{"sharp":"^0.33.0","@sparticuz/chromium":"^126.0.0"}}' > package.json
npm install --arch=x64 --platform=linux
cd .. && mkdir nodejs && move node_modules nodejs/
cd .. && powershell Compress-Archive -Path sharp/nodejs -DestinationPath sharp-layer.zip -Force
aws lambda publish-layer-version --layer-name csv-bulk-upload-sharp --compatible-runtimes nodejs20.x --region ap-south-1 --zip-file fileb://sharp-layer.zip

# 3. Copy Layer ARN to .env.local
# SHARP_LAYER_ARN=arn:aws:lambda:ap-south-1:YOUR_ACCOUNT_ID:layer:csv-bulk-upload-sharp:1

# 4. Deploy
npm run build
npm run deploy:prod
```

**Done!** Your module is live on AWS Lambda with parallel processing.

---

## 📊 Performance

| Environment | 200 Images | Time |
|-------------|-----------|------|
| Local | 200 images | 50 min |
| AWS Lambda | 200 images | **2-3 min** ⚡ |

---

## 💡 Tips

- **CSV Headers**: First row must have column names
- **Placeholders**: Use exact column names (case-sensitive)
- **Images**: Include image URLs in CSV for photos
- **Dimensions**: Default 1080x1350, customizable
- **Progress**: Real-time updates every second

---

## 🐛 Troubleshooting

**Issue: CSV not loading**
- Check file is .csv format
- Ensure first row has headers

**Issue: Placeholders not working**
- Use exact column names: `{column_name}`
- Check for typos

**Issue: Generation fails**
- Verify S3 credentials in `.env.local`
- Check Django API URL is accessible

---

## 📞 Need Help?

See full documentation: [README.md](./README.md)

---

**Ready to generate posters in bulk!** 🎨
