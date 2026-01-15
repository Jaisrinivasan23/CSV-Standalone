'use client';

import { useState, ChangeEvent } from 'react';
import Papa from 'papaparse';

export default function CSVBulkUpload() {
  // CSV file and data states
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvTemplate, setCsvTemplate] = useState('');
  const [csvPreview, setCsvPreview] = useState('');
  const [csvCampaignName, setCsvCampaignName] = useState('');
  const [csvCustomWidth, setCsvCustomWidth] = useState(1080);
  const [csvCustomHeight, setCsvCustomHeight] = useState(1350);
  const [csvSkipOverlays, setCsvSkipOverlays] = useState(true);

  // Generation states
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvGeneratedResults, setCsvGeneratedResults] = useState<any[]>([]);

  // Progress tracking
  const [csvJobId, setCsvJobId] = useState<string | null>(null);
  const [csvProgress, setCsvProgress] = useState<{
    phase: string;
    total: number;
    completed: number;
    failed: number;
    currentItem: string;
    percentComplete: number;
    elapsedMs: number;
    estimatedTimeRemainingMs: number;
  } | null>(null);

  // Saved results states
  const [csvSaveSuccess, setCsvSaveSuccess] = useState(false);
  const [csvSavedConfig, setCsvSavedConfig] = useState<{campaign: string, content_type: string} | null>(null);
  const [csvSaveResults, setCsvSaveResults] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Handle CSV file upload and parsing
  const handleCsvFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    setCsvFile(file);

    // Parse CSV using Papa Parse
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setError('CSV file must have at least one data row');
          return;
        }

        const data = results.data as any[];
        const columns = Object.keys(data[0] || {});

        setCsvData(data);
        setCsvColumns(columns);
        setError(null);

        console.log('📊 [CSV] Parsed CSV:', {
          rows: data.length,
          columns: columns.length,
          columnNames: columns
        });
      },
      error: (error) => {
        console.error('❌ [CSV] Parse error:', error);
        setError(`Failed to parse CSV: ${error.message}`);
      }
    });
  };

  // Handle bulk generation
  const handleCsvGeneration = async () => {
    if (!csvData || csvData.length === 0) {
      setError('Please upload a CSV file first');
      return;
    }

    if (!csvTemplate) {
      setError('Please enter an HTML template');
      return;
    }

    if (!csvCampaignName.trim()) {
      setError('Please enter a campaign name');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setCsvGeneratedResults([]);
    setCsvProgress(null);

    // Generate jobId on frontend BEFORE making request
    const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setCsvJobId(jobId);

    let pollInterval: NodeJS.Timeout | null = null;

    try {
      // Start polling IMMEDIATELY (before request completes)
      pollInterval = setInterval(async () => {
        try {
          const progressRes = await fetch(`/api/bulk-progress/${jobId}`);
          const progressData = await progressRes.json();

          if (progressData.success) {
            setCsvProgress({
              phase: progressData.phase,
              total: progressData.total,
              completed: progressData.completed,
              failed: progressData.failed,
              currentItem: progressData.currentItem || '',
              percentComplete: progressData.percentComplete,
              elapsedMs: progressData.elapsedMs,
              estimatedTimeRemainingMs: progressData.estimatedTimeRemainingMs,
            });

            if (progressData.phase === 'complete' || progressData.phase === 'error') {
              if (pollInterval) clearInterval(pollInterval);
            }
          }
        } catch (pollError) {
          console.error('Progress polling error:', pollError);
        }
      }, 1000); // Poll every 1 second

      const response = await fetch('/api/generate-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId,
          bulkMethod: 'csv',
          csvTemplate: csvTemplate,
          csvData: csvData,
          csvColumns: csvColumns,
          posterName: csvCampaignName.trim(),
          size: 'custom',
          customWidth: csvCustomWidth,
          customHeight: csvCustomHeight,
          skipOverlays: csvSkipOverlays,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCsvGeneratedResults(data.results || []);
        console.log('✅ [CSV] Generation complete:', data);
      } else {
        setError(data.error || 'Bulk generation failed');
        console.error('❌ [CSV] Generation failed:', data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate posters');
      console.error('❌ [CSV] Error:', err);
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsGenerating(false);
    }
  };

  // Handle saving generated posters to database
  const handleSaveToDatabase = async () => {
    if (csvGeneratedResults.length === 0) {
      setError('No results to save');
      return;
    }

    setIsSaving(true);
    setCsvSaveSuccess(false);
    setCsvProgress(null);
    setCsvSaveResults([]);

    let pollInterval: NodeJS.Timeout | null = null;

    try {
      // Start polling for storage progress if we have a jobId
      if (csvJobId) {
        pollInterval = setInterval(async () => {
          try {
            const progressRes = await fetch(`/api/bulk-progress/${csvJobId}`);
            const progressData = await progressRes.json();

            if (progressData.success && progressData.phase === 'storing') {
              setCsvProgress({
                phase: progressData.phase,
                total: progressData.total,
                completed: progressData.completed,
                failed: progressData.failed,
                currentItem: progressData.currentItem || '',
                percentComplete: progressData.percentComplete,
                elapsedMs: progressData.elapsedMs,
                estimatedTimeRemainingMs: progressData.estimatedTimeRemainingMs,
              });
            }
          } catch (pollError) {
            console.error('Storage progress polling error:', pollError);
          }
        }, 1000);
      }

      const successfulResults = csvGeneratedResults.filter(r => r.success);

      const response = await fetch('/api/save-bulk-posters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: csvJobId,
          posters: successfulResults,
          posterName: csvCampaignName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCsvSaveSuccess(true);
        setCsvSavedConfig({
          campaign: csvCampaignName,
          content_type: 'poster'
        });
        setCsvSaveResults(data.results || []);
        console.log('✅ [CSV] Saved to database:', data);
      } else {
        setError(data.error || 'Failed to save to database');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save results');
      console.error('❌ [CSV] Save error:', err);
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsSaving(false);
      setCsvProgress(null);
    }
  };

  return (
    <div>
      {/* Info Banner */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Bulk Generation Flow</h3>
            <p className="mt-1 text-sm text-blue-700">
              <strong>Step 1:</strong> Upload CSV file with your data (must include "username" column).<br />
              <strong>Step 2:</strong> Create HTML template using CSV column names as placeholders.<br />
              <strong>Step 3:</strong> Preview, name your campaign, and generate posters for all rows.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Upload CSV File */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Step 1: Upload CSV File
        </label>
        <p className="text-xs text-slate-500 mb-3">
          CSV must include a "username" column. Other columns will be mapped to template placeholders.
        </p>

        <label className="flex items-center gap-3 w-full p-4 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors">
          <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="flex-1">
            {csvFile ? (
              <div>
                <span className="text-sm font-medium text-green-700">✅ {csvFile.name}</span>
                <p className="text-xs text-slate-500 mt-1">
                  {csvData.length} rows, {csvColumns.length} columns: {csvColumns.join(', ')}
                </p>
              </div>
            ) : (
              <span className="text-sm text-slate-600">Click to upload CSV file</span>
            )}
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={handleCsvFileChange}
            className="hidden"
          />
        </label>
      </div>

      {/* Step 2: HTML Template */}
      {csvFile && csvData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Step 2: HTML Template with Placeholders
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Use <code className="bg-slate-100 px-1 py-0.5 rounded">{`{column_name}`}</code> syntax. Available columns: {csvColumns.map(col => <code key={col} className="bg-slate-100 px-1 py-0.5 rounded mx-1">{`{${col}}`}</code>)}
          </p>

          {/* Custom Dimensions */}
          <div className="mb-3 flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Width (px)</label>
              <input
                type="number"
                value={csvCustomWidth}
                onChange={(e) => setCsvCustomWidth(parseInt(e.target.value) || 1080)}
                className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Height (px)</label>
              <input
                type="number"
                value={csvCustomHeight}
                onChange={(e) => setCsvCustomHeight(parseInt(e.target.value) || 1350)}
                className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Skip Overlays Option */}
          <div className="mb-3 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              type="checkbox"
              id="csvSkipOverlays"
              checked={csvSkipOverlays}
              onChange={(e) => setCsvSkipOverlays(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="csvSkipOverlays" className="text-xs text-slate-700 cursor-pointer">
              <strong>Skip automatic logo/profile overlays</strong> - Check this if your template already includes logo and profile images
            </label>
          </div>

          <textarea
            value={csvTemplate}
            onChange={(e) => setCsvTemplate(e.target.value)}
            placeholder={`<!DOCTYPE html>
<html>
<head>
  <style>
    .poster { width: 1080px; height: 1080px; padding: 40px; background: #667eea; color: white; font-family: Arial; }
    .profile-img { width: 100px; height: 100px; border-radius: 50%; }
    .name { font-size: 48px; font-weight: bold; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="poster">
    <img class="profile-img" src="{profile_pic}" alt="Profile">
    <div class="name">{name}</div>
    <div>{email}</div>
    <div>📊 {total_sales} Sales</div>
  </div>
</body>
</html>`}
            rows={12}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono text-xs"
          />

          {/* Auto-conversion info */}
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-xs text-blue-800">
                <strong>Auto-Conversion:</strong> Your HTML will be automatically processed to remove JavaScript and convert dynamic image loading to CSV placeholders. You can paste HTML with <code className="bg-blue-100 px-1 rounded">id="profilePic"</code> and it will work!
              </div>
            </div>
          </div>

          {csvTemplate.trim() && (
            <>
              <button
                onClick={() => {
                  // Preview with first row data
                  const firstRow = csvData[0];
                  let preview = csvTemplate;
                  csvColumns.forEach(col => {
                    const regex = new RegExp(`\\{${col}\\}`, 'g');
                    preview = preview.replace(regex, firstRow[col] || '');
                  });
                  setCsvPreview(preview);
                }}
                className="mt-3 w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {csvPreview ? 'Update Preview' : 'Preview with First Row'}
              </button>

              {csvPreview && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Template Preview (First Row Data)</label>
                    <button
                      onClick={() => setCsvPreview('')}
                      className="text-xs text-red-500 hover:text-red-600 font-medium"
                    >
                      Hide Preview
                    </button>
                  </div>
                  <div className="border-2 border-slate-300 rounded-lg overflow-hidden bg-slate-50 p-4 flex justify-center">
                    <div style={{
                      width: `${csvCustomWidth * 0.5}px`,
                      height: `${csvCustomHeight * 0.5}px`,
                      transform: 'scale(0.5)',
                      transformOrigin: 'top left',
                      border: '1px solid #e2e8f0'
                    }}>
                      <iframe
                        srcDoc={csvPreview}
                        className="w-full h-full border-0"
                        style={{ width: `${csvCustomWidth}px`, height: `${csvCustomHeight}px`, pointerEvents: 'none' }}
                        title="CSV Preview"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 text-center">
                    Preview with first row data. Will generate for all {csvData.length} rows.
                  </p>

                  {/* Campaign Name */}
                  <div className="mt-6 p-4 bg-slate-50 rounded-lg border-2 border-slate-200">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Step 3: Campaign Name
                    </label>
                    <input
                      type="text"
                      value={csvCampaignName}
                      onChange={(e) => setCsvCampaignName(e.target.value)}
                      placeholder="e.g., Q4 Sales Campaign"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>

                  {/* Error Display */}
                  {error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  )}

                  {/* Generate Button */}
                  <button
                    onClick={handleCsvGeneration}
                    disabled={isGenerating || !csvCampaignName.trim()}
                    className="mt-4 w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating for {csvData.length} rows...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate {csvData.length} Posters from CSV
                      </>
                    )}
                  </button>

                  {/* Real-time Progress Display */}
                  {isGenerating && csvProgress && (
                    <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-blue-900">
                          {csvProgress.phase === 'generating' ? '🎨 Generating Images' :
                           csvProgress.phase === 'storing' ? '💾 Storing to Database' :
                           '✅ Complete'}
                        </h4>
                        <span className="text-xs font-mono text-blue-700">
                          {Math.floor(csvProgress.elapsedMs / 1000)}s elapsed
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-blue-200 rounded-full h-3 mb-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-1"
                          style={{ width: `${csvProgress.percentComplete}%` }}
                        >
                          {csvProgress.percentComplete > 10 && (
                            <span className="text-xs font-bold text-white">{csvProgress.percentComplete}%</span>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center justify-between text-xs text-blue-800 mb-1">
                        <div className="flex gap-3">
                          <span>✅ {csvProgress.completed} completed</span>
                          {csvProgress.failed > 0 && <span className="text-red-600">❌ {csvProgress.failed} failed</span>}
                        </div>
                        <span className="font-mono">{csvProgress.completed + csvProgress.failed}/{csvProgress.total}</span>
                      </div>

                      {/* Current Item */}
                      {csvProgress.currentItem && (
                        <div className="text-xs text-blue-700 italic truncate">
                          Processing: {csvProgress.currentItem}
                        </div>
                      )}

                      {/* ETA */}
                      {csvProgress.estimatedTimeRemainingMs > 0 && csvProgress.phase !== 'complete' && (
                        <div className="text-xs text-blue-600 mt-1">
                          ⏱️ Est. {Math.ceil(csvProgress.estimatedTimeRemainingMs / 1000)}s remaining
                        </div>
                      )}
                    </div>
                  )}

                  {/* CSV Generated Results */}
                  {csvGeneratedResults.length > 0 && (
                    <div className="mt-6 p-4 bg-white rounded-lg border-2 border-green-200">
                      <h3 className="text-sm font-medium text-slate-700 mb-4">
                        Generated Posters ({csvGeneratedResults.filter(r => r.success).length} successful, {csvGeneratedResults.filter(r => !r.success).length} failed)
                      </h3>

                      {/* Failed Usernames Summary */}
                      {csvGeneratedResults.filter(r => !r.success).length > 0 && (
                        <div className="mb-4 p-4 bg-red-50 border-2 border-red-300 rounded-lg">
                          <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h4 className="text-sm font-semibold text-red-900">
                              Failed to Generate ({csvGeneratedResults.filter(r => !r.success).length} items)
                            </h4>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {csvGeneratedResults.filter(r => !r.success).map((result, idx) => (
                              <div key={idx} className="bg-white border border-red-200 rounded p-2">
                                <div className="flex items-start gap-2">
                                  <span className="text-red-600 font-medium text-xs flex-shrink-0">❌</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-red-800 truncate">
                                      {result.username}
                                    </p>
                                    <p className="text-xs text-red-600 mt-0.5 break-words">
                                      {result.error || 'Unknown error'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4 max-h-96 overflow-y-auto mb-4">
                        {csvGeneratedResults.map((result, idx) => (
                          <div key={idx} className="border rounded-lg p-2">
                            {result.success ? (
                              <>
                                <img
                                  src={result.posterUrl}
                                  alt={result.username}
                                  className="w-full rounded"
                                />
                                <p className="text-xs font-medium mt-2">✅ {result.username}</p>
                              </>
                            ) : (
                              <div className="p-4 text-center">
                                <p className="text-xs font-medium text-red-600">❌ {result.username}</p>
                                <p className="text-xs text-red-500 mt-1">{result.error}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Save to Database */}
                      {!csvSaveSuccess && (
                        <button
                          onClick={handleSaveToDatabase}
                          disabled={isSaving}
                          className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {isSaving ? (
                            <>
                              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Saving to Database...
                            </>
                          ) : (
                            <>💾 Save to Database</>
                          )}
                        </button>
                      )}

                      {/* Database Save Progress */}
                      {isSaving && csvProgress && csvProgress.phase === 'storing' && (
                        <div className="mt-4 p-4 bg-green-50 border-2 border-green-200 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-green-900">
                              💾 Storing to Database
                            </h4>
                            <span className="text-xs font-mono text-green-700">
                              {Math.floor(csvProgress.elapsedMs / 1000)}s elapsed
                            </span>
                          </div>

                          {/* Progress Bar */}
                          <div className="w-full bg-green-200 rounded-full h-3 mb-2 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-green-500 to-emerald-500 h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-1"
                              style={{ width: `${csvProgress.percentComplete}%` }}
                            >
                              {csvProgress.percentComplete > 10 && (
                                <span className="text-xs font-bold text-white">{csvProgress.percentComplete}%</span>
                              )}
                            </div>
                          </div>

                          {/* Stats */}
                          <div className="flex items-center justify-between text-xs text-green-800 mb-1">
                            <div className="flex gap-3">
                              <span>✅ {csvProgress.completed} saved</span>
                              {csvProgress.failed > 0 && <span className="text-red-600">❌ {csvProgress.failed} failed</span>}
                            </div>
                            <span className="font-mono">{csvProgress.completed + csvProgress.failed}/{csvProgress.total}</span>
                          </div>

                          {/* Current Item */}
                          {csvProgress.currentItem && (
                            <div className="text-xs text-green-700 italic truncate">
                              Processing: {csvProgress.currentItem}
                            </div>
                          )}

                          {/* ETA */}
                          {csvProgress.estimatedTimeRemainingMs > 0 && (
                            <div className="text-xs text-green-600 mt-1">
                              ⏱️ Est. {Math.ceil(csvProgress.estimatedTimeRemainingMs / 1000)}s remaining
                            </div>
                          )}
                        </div>
                      )}

                      {/* Failed Database Saves */}
                      {csvSaveSuccess && csvSaveResults.filter(r => !r.success).length > 0 && (
                        <div className="mt-4 p-4 bg-red-50 border-2 border-red-300 rounded-lg">
                          <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h4 className="text-sm font-semibold text-red-900">
                              Failed to Save to Database ({csvSaveResults.filter(r => !r.success).length} items)
                            </h4>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {csvSaveResults.filter(r => !r.success).map((result, idx) => (
                              <div key={idx} className="bg-white border border-red-200 rounded p-2">
                                <div className="flex items-start gap-2">
                                  <span className="text-red-600 font-medium text-xs flex-shrink-0">❌</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-red-800 truncate">
                                      User ID: {result.userId || 'Unknown'}
                                    </p>
                                    <p className="text-xs text-red-600 mt-0.5 break-words">
                                      {result.error || 'Failed to save to database'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {csvSaveSuccess && (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-sm text-green-800">
                            ✅ Successfully saved {csvSaveResults.filter(r => r.success).length}/{csvSaveResults.length} posters to database!
                            <br />
                            <span className="text-xs">Campaign: {csvSavedConfig?.campaign}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
