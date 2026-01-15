'use client';

import CSVBulkUpload from './components/CSVBulkUpload';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            📊 CSV Bulk Upload
          </h1>
          <p className="text-slate-600 max-w-2xl mx-auto">
            Generate posters in bulk with parallel processing on AWS Lambda
          </p>
        </div>

        <CSVBulkUpload />
      </div>
    </div>
  );
}
