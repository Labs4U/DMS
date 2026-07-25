// src/components/DocumentDashboard.tsx
import React, { useState } from 'react';
import { StorageManager } from '@aws-amplify/ui-react-storage';
import '@aws-amplify/ui-react/styles.css';

interface DocStats {
  pdf: number;
  word: number;
  spreadsheet: number;
  text: number;
}

export default function DocumentDashboard() {
  // Initial baseline matching your current UI overview
  const [stats, setStats] = useState<DocStats>({
    pdf: 11,
    word: 11,
    spreadsheet: 3,
    text: 5,
  });

  // Dynamically increment categories upon upload
  const handleUploadSuccess = (event: { key?: string }) => {
    const fileName = event.key || '';
    const extension = fileName.split('.').pop()?.toLowerCase();

    setStats((prevStats) => {
      const updated = { ...prevStats };
      if (extension === 'pdf') {
        updated.pdf += 1;
      } else if (extension === 'docx' || extension === 'doc') {
        updated.word += 1;
      } else if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
        updated.spreadsheet += 1;
      } else {
        updated.text += 1;
      }
      return updated;
    });
  };

  return (
    <div className="dms-sidebar">
      <div>
        <h2>📚 Document Library Overview</h2>
      </div>

      {/* Dynamic Statistics Cards */}
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-number">{stats.pdf}</div>
          <div className="stat-label">PDFs</div>
        </div>
        <div className="stat-item">
          <div className="stat-number">{stats.word}</div>
          <div className="stat-label">Word (.docx)</div>
        </div>
        <div className="stat-item">
          <div className="stat-number">{stats.spreadsheet}</div>
          <div className="stat-label">Spreadsheets</div>
        </div>
        <div className="stat-item">
          <div className="stat-number">{stats.text}</div>
          <div className="stat-label">TXT / CSV</div>
        </div>
      </div>

      {/* Storage Uploader */}
      <div style={{ marginTop: '20px' }}>
        <h3>📥 Upload New Document</h3>
        <p style={{ fontSize: '0.85rem', color: '#888' }}>
          Drag and drop office files. The AI will chunk and index new paragraphs automatically.
        </p>
        <StorageManager
          acceptedFileTypes={['.pdf', '.docx', '.xlsx', '.csv', '.txt']}
          path="public/documents/"
          maxFileCount={5}
          isResumable
          onUploadSuccess={handleUploadSuccess}
        />
      </div>
    </div>
  );
}